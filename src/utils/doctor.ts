/**
 * CursorFlow Doctor - environment and preflight checks
 *
 * This module provides actionable diagnostics for common run failures:
 * - Not inside a Git work tree
 * - Missing `origin` remote (required for pushing lane branches)
 * - Missing Git worktree support
 * - Missing base branch referenced by lane task files
 * - Missing/invalid tasks directory
 * - Missing Cursor Agent setup (optional)
 */

import * as fs from 'fs';
import * as path from 'path';

import * as git from './git';
import { checkCursorAgentInstalled, checkCursorAuth } from './cursor-agent';
import { areCommandsInstalled } from '../cli/setup-commands';

export type DoctorSeverity = 'error' | 'warn';

export interface DoctorIssue {
  /**
   * Stable identifier for machines (NOCC) and tests.
   */
  id: string;
  severity: DoctorSeverity;
  title: string;
  message: string;
  /**
   * Suggested commands or steps to fix the issue.
   */
  fixes?: string[];
  /**
   * Optional technical details (stderr, stdout, etc.)
   */
  details?: string;
}

export interface DoctorContext {
  cwd: string;
  repoRoot?: string;
  tasksDir?: string;
  executor?: string;
}

export interface DoctorReport {
  ok: boolean;
  issues: DoctorIssue[];
  context: DoctorContext;
}

export interface DoctorOptions {
  cwd?: string;
  /**
   * Optional tasks directory (used for `cursorflow run` preflight).
   */
  tasksDir?: string;
  /**
   * Executor type ('cursor-agent' | 'cloud' | ...).
   */
  executor?: string;
  /**
   * When true (default), include Cursor Agent install/auth checks.
   */
  includeCursorAgentChecks?: boolean;
}

function addIssue(issues: DoctorIssue[], issue: DoctorIssue): void {
  issues.push(issue);
}

function resolveRepoRoot(cwd: string): string | null {
  const res = git.runGitResult(['rev-parse', '--show-toplevel'], { cwd });
  if (!res.success || !res.stdout) return null;
  return res.stdout;
}

function isInsideGitWorktree(cwd: string): boolean {
  const res = git.runGitResult(['rev-parse', '--is-inside-work-tree'], { cwd });
  return res.success && res.stdout.trim() === 'true';
}

function hasAtLeastOneCommit(repoRoot: string): boolean {
  const res = git.runGitResult(['rev-parse', '--verify', 'HEAD'], { cwd: repoRoot });
  return res.success;
}

function hasOriginRemote(repoRoot: string): boolean {
  const res = git.runGitResult(['remote', 'get-url', 'origin'], { cwd: repoRoot });
  return res.success && !!res.stdout;
}

function hasWorktreeSupport(repoRoot: string): { ok: boolean; details?: string } {
  const res = git.runGitResult(['worktree', 'list'], { cwd: repoRoot });
  if (res.success) return { ok: true };
  return { ok: false, details: res.stderr || res.stdout || 'git worktree failed' };
}

function branchExists(repoRoot: string, branchName: string): boolean {
  // rev-parse --verify works for both branches and tags; restrict to heads first.
  const headRes = git.runGitResult(['show-ref', '--verify', `refs/heads/${branchName}`], { cwd: repoRoot });
  if (headRes.success) return true;
  const anyRes = git.runGitResult(['rev-parse', '--verify', branchName], { cwd: repoRoot });
  return anyRes.success;
}

function readLaneJsonFiles(tasksDir: string): { path: string; json: any }[] {
  const files = fs
    .readdirSync(tasksDir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => path.join(tasksDir, f));

  return files.map(p => {
    const raw = fs.readFileSync(p, 'utf8');
    const json = JSON.parse(raw);
    return { path: p, json };
  });
}

function collectBaseBranchesFromLanes(lanes: { path: string; json: any }[], defaultBaseBranch: string): string[] {
  const set = new Set<string>();
  for (const lane of lanes) {
    const baseBranch = String(lane.json?.baseBranch || defaultBaseBranch || 'main').trim();
    if (baseBranch) set.add(baseBranch);
  }
  return Array.from(set);
}

/**
 * Run doctor checks.
 *
 * If `tasksDir` is provided, additional preflight checks are performed:
 * - tasks directory existence and JSON validity
 * - baseBranch referenced by lanes exists locally
 */
export function runDoctor(options: DoctorOptions = {}): DoctorReport {
  const cwd = options.cwd || process.cwd();
  const issues: DoctorIssue[] = [];

  const context: DoctorContext = {
    cwd,
    executor: options.executor,
  };

  // 1) Git repository checks
  if (!isInsideGitWorktree(cwd)) {
    addIssue(issues, {
      id: 'git.not_repo',
      severity: 'error',
      title: 'Not a Git repository',
      message: 'Current directory is not inside a Git work tree. CursorFlow requires Git to create worktrees and branches.',
      fixes: [
        'cd into your repository root (or any subdirectory inside it)',
        'If this is a new project: git init && git commit --allow-empty -m "chore: initial commit"',
      ],
    });

    return { ok: false, issues, context };
  }

  const repoRoot = resolveRepoRoot(cwd) || undefined;
  context.repoRoot = repoRoot;
  const gitCwd = repoRoot || cwd;

  if (!hasAtLeastOneCommit(gitCwd)) {
    addIssue(issues, {
      id: 'git.no_commits',
      severity: 'error',
      title: 'Repository has no commits',
      message: 'CursorFlow needs at least one commit (HEAD) to create worktrees and new branches.',
      fixes: ['git commit --allow-empty -m "chore: initial commit"'],
    });
  }

  if (!hasOriginRemote(gitCwd)) {
    addIssue(issues, {
      id: 'git.no_origin',
      severity: 'error',
      title: "Missing remote 'origin'",
      message: "Remote 'origin' is not configured. CursorFlow pushes lane branches to 'origin' during execution.",
      fixes: [
        'git remote add origin <your-repo-url>',
        'git remote -v  # verify remotes',
      ],
    });
  }

  const wt = hasWorktreeSupport(gitCwd);
  if (!wt.ok) {
    addIssue(issues, {
      id: 'git.worktree_unavailable',
      severity: 'error',
      title: 'Git worktree not available',
      message: 'Git worktree support is required, but `git worktree` failed.',
      fixes: [
        'Upgrade Git (worktrees require Git >= 2.5)',
        'Ensure the repository is not corrupted',
      ],
      details: wt.details,
    });
  }

  // 2) Tasks-dir checks (optional; used by `cursorflow run` preflight)
  if (options.tasksDir) {
    const tasksDirAbs = path.isAbsolute(options.tasksDir)
      ? options.tasksDir
      : path.resolve(cwd, options.tasksDir);
    context.tasksDir = tasksDirAbs;

    if (!fs.existsSync(tasksDirAbs)) {
      addIssue(issues, {
        id: 'tasks.missing_dir',
        severity: 'error',
        title: 'Tasks directory not found',
        message: `Tasks directory does not exist: ${tasksDirAbs}`,
        fixes: [
          'Double-check the path you passed to `cursorflow run`',
          'If needed, run: cursorflow init --example',
        ],
      });
    } else {
      let lanes: { path: string; json: any }[] = [];
      try {
        lanes = readLaneJsonFiles(tasksDirAbs);
      } catch (error: any) {
        addIssue(issues, {
          id: 'tasks.invalid_json',
          severity: 'error',
          title: 'Invalid lane JSON file',
          message: `Failed to read/parse lane JSON files in: ${tasksDirAbs}`,
          details: error?.message ? String(error.message) : String(error),
          fixes: ['Validate JSON syntax for each lane file (*.json)'],
        });
        lanes = [];
      }

      if (lanes.length === 0) {
        addIssue(issues, {
          id: 'tasks.no_lanes',
          severity: 'error',
          title: 'No lane files found',
          message: `No lane task files (*.json) found in: ${tasksDirAbs}`,
          fixes: ['Ensure the tasks directory contains one or more lane JSON files'],
        });
      } else {
        const baseBranches = collectBaseBranchesFromLanes(lanes, 'main');
        for (const baseBranch of baseBranches) {
          if (!branchExists(gitCwd, baseBranch)) {
            addIssue(issues, {
              id: `git.missing_base_branch.${baseBranch}`,
              severity: 'error',
              title: `Missing base branch: ${baseBranch}`,
              message: `Lane files reference baseBranch "${baseBranch}", but it does not exist locally.`,
              fixes: [
                'git fetch origin --prune',
                `Or update lane JSON baseBranch to an existing branch`,
              ],
            });
          }
        }
      }
    }
  }

  // 3) Cursor Agent checks (optional)
  const includeCursor = options.includeCursorAgentChecks !== false;
  if (includeCursor && (options.executor || 'cursor-agent') === 'cursor-agent') {
    if (!checkCursorAgentInstalled()) {
      addIssue(issues, {
        id: 'cursor_agent.missing',
        severity: 'error',
        title: 'cursor-agent CLI not installed',
        message: 'cursor-agent is required for local execution.',
        fixes: ['npm install -g @cursor/agent', 'cursor-agent --version'],
      });
    } else {
      const auth = checkCursorAuth();
      if (!auth.authenticated) {
        addIssue(issues, {
          id: 'cursor_agent.not_authenticated',
          severity: 'error',
          title: 'Cursor authentication required',
          message: auth.message,
          details: auth.details || auth.error,
          fixes: [
            'Open Cursor IDE and sign in',
            'Verify AI features work in the IDE',
            'Re-run: cursorflow doctor',
          ],
        });
      }
    }
  }

  // 4) IDE Integration checks
  if (!areCommandsInstalled()) {
    addIssue(issues, {
      id: 'ide.commands_missing',
      severity: 'warn',
      title: 'Cursor IDE commands not installed',
      message: 'CursorFlow slash commands (e.g., /cursorflow-run) are missing or outdated.',
      fixes: ['cursorflow-setup --force', 'or run `cursorflow run` to auto-install'],
    });
  }

  const ok = issues.every(i => i.severity !== 'error');
  return { ok, issues, context };
}



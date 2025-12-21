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

function checkGitUserConfig(repoRoot: string): { name?: string; email?: string } {
  const nameRes = git.runGitResult(['config', 'user.name'], { cwd: repoRoot });
  const emailRes = git.runGitResult(['config', 'user.email'], { cwd: repoRoot });
  return {
    name: nameRes.success ? nameRes.stdout.trim() : undefined,
    email: emailRes.success ? emailRes.stdout.trim() : undefined,
  };
}

function checkGitPushPermission(repoRoot: string): { ok: boolean; details?: string } {
  // Use dry-run to check if we can push to origin.
  // We try pushing current HEAD to a non-existent temporary branch on origin to avoid side effects.
  const tempBranch = `cursorflow-doctor-test-${Date.now()}`;
  const res = git.runGitResult(['push', '--dry-run', 'origin', `HEAD:refs/heads/${tempBranch}`], { cwd: repoRoot });
  if (res.success) return { ok: true };
  return { ok: false, details: res.stderr || res.stdout || 'git push --dry-run failed' };
}

function checkRemoteConnectivity(repoRoot: string): { ok: boolean; details?: string } {
  const res = git.runGitResult(['fetch', '--dry-run', 'origin'], { cwd: repoRoot });
  if (res.success) return { ok: true };
  return { ok: false, details: res.stderr || res.stdout || 'git fetch --dry-run failed' };
}

function getVersions(): { node: string; git: string } {
  let gitVer = 'unknown';
  try {
    const res = git.runGitResult(['--version']);
    gitVer = res.stdout.replace('git version ', '').trim();
  } catch {}

  return {
    node: process.version,
    git: gitVer,
  };
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

function checkPackageManager(): { name: string; ok: boolean } {
  const { spawnSync } = require('child_process');
  
  // Try pnpm first as it's the default in prompts
  try {
    const pnpmRes = spawnSync('pnpm', ['--version'], { encoding: 'utf8' });
    if (pnpmRes.status === 0) return { name: 'pnpm', ok: true };
  } catch {}
  
  try {
    const npmRes = spawnSync('npm', ['--version'], { encoding: 'utf8' });
    if (npmRes.status === 0) return { name: 'npm', ok: true };
  } catch {}
  
  return { name: 'unknown', ok: false };
}

function checkDiskSpace(dir: string): { ok: boolean; freeBytes?: number; error?: string } {
  const { execSync } = require('child_process');
  try {
    // df -B1 returns bytes. We look for the line corresponding to our directory.
    const output = execSync(`df -B1 "${dir}"`, { encoding: 'utf8' });
    const lines = output.trim().split('\n');
    if (lines.length < 2) return { ok: false, error: 'Could not parse df output' };
    
    const parts = lines[1]!.trim().split(/\s+/);
    // df output: Filesystem 1B-blocks Used Available Use% Mounted on
    // Available is index 3
    const available = parseInt(parts[3]!);
    if (isNaN(available)) return { ok: false, error: 'Could not parse available bytes' };
    
    return { ok: true, freeBytes: available };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/**
 * Status file to track when doctor was last run successfully.
 */
const DOCTOR_STATUS_FILE = '.cursorflow/doctor-status.json';

export function saveDoctorStatus(repoRoot: string, report: DoctorReport): void {
  const statusPath = path.join(repoRoot, DOCTOR_STATUS_FILE);
  const statusDir = path.dirname(statusPath);
  
  if (!fs.existsSync(statusDir)) {
    fs.mkdirSync(statusDir, { recursive: true });
  }

  const status = {
    lastRun: Date.now(),
    ok: report.ok,
    issueCount: report.issues.length,
    nodeVersion: process.version,
  };

  fs.writeFileSync(statusPath, JSON.stringify(status, null, 2), 'utf8');
}

export function getDoctorStatus(repoRoot: string): { lastRun: number; ok: boolean; issueCount: number } | null {
  const statusPath = path.join(repoRoot, DOCTOR_STATUS_FILE);
  if (!fs.existsSync(statusPath)) return null;

  try {
    return JSON.parse(fs.readFileSync(statusPath, 'utf8'));
  } catch {
    return null;
  }
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

  // 0) System and environment checks
  const versions = getVersions();
  const nodeMajor = parseInt(versions.node.slice(1).split('.')[0] || '0');
  if (nodeMajor < 18) {
    addIssue(issues, {
      id: 'env.node_version',
      severity: 'error',
      title: 'Node.js version too old',
      message: `CursorFlow requires Node.js >= 18.0.0. Current version: ${versions.node}`,
      fixes: ['Upgrade Node.js to a supported version (e.g., using nvm or from nodejs.org)'],
    });
  }

  const gitVerMatch = versions.git.match(/^(\d+)\.(\d+)/);
  if (gitVerMatch) {
    const major = parseInt(gitVerMatch[1]!);
    const minor = parseInt(gitVerMatch[2]!);
    if (major < 2 || (major === 2 && minor < 5)) {
      addIssue(issues, {
        id: 'env.git_version',
        severity: 'error',
        title: 'Git version too old',
        message: `CursorFlow requires Git >= 2.5 for worktree support. Current version: ${versions.git}`,
        fixes: ['Upgrade Git to a version >= 2.5'],
      });
    }
  }

  const pkgManager = checkPackageManager();
  if (!pkgManager.ok) {
    addIssue(issues, {
      id: 'env.package_manager',
      severity: 'warn',
      title: 'No standard package manager found',
      message: 'Neither pnpm nor npm was found in your PATH. CursorFlow tasks often rely on these for dependency management.',
      fixes: ['Install pnpm (recommended): npm install -g pnpm', 'Or ensure npm is in your PATH'],
    });
  }

  const diskSpace = checkDiskSpace(cwd);
  if (diskSpace.ok && diskSpace.freeBytes !== undefined) {
    const freeGB = diskSpace.freeBytes / (1024 * 1024 * 1024);
    if (freeGB < 1) {
      addIssue(issues, {
        id: 'env.low_disk_space',
        severity: 'warn',
        title: 'Low disk space',
        message: `Low disk space detected: ${freeGB.toFixed(2)} GB available. CursorFlow creates Git worktrees which can consume significant space.`,
        fixes: ['Free up disk space before running large orchestration tasks'],
      });
    }
  }

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
  } else {
    // Advanced check: remote connectivity
    const connectivity = checkRemoteConnectivity(gitCwd);
    if (!connectivity.ok) {
      addIssue(issues, {
        id: 'git.remote_connectivity',
        severity: 'error',
        title: "Cannot connect to 'origin'",
        message: "Failed to communicate with the remote 'origin'. Check your internet connection or SSH/HTTPS credentials.",
        details: connectivity.details,
        fixes: [
          'git fetch origin',
          'Verify your SSH keys or authentication tokens are configured correctly',
        ],
      });
    }

    // Advanced check: push permission
    const pushPerm = checkGitPushPermission(gitCwd);
    if (!pushPerm.ok) {
      addIssue(issues, {
        id: 'git.push_permission',
        severity: 'warn',
        title: 'Push permission check failed',
        message: "CursorFlow might not be able to push branches to 'origin'. A dry-run push failed.",
        details: pushPerm.details,
        fixes: [
          'Verify you have write access to the repository on GitHub/GitLab',
          'Check if the branch naming policy on the remote permits `cursorflow/*` branches',
        ],
      });
    }

    // Advanced check: current branch upstream
    const currentBranch = git.getCurrentBranch(gitCwd);
    const upstreamRes = git.runGitResult(['rev-parse', '--abbrev-ref', `${currentBranch}@{u}`], { cwd: gitCwd });
    if (!upstreamRes.success && currentBranch !== 'main' && currentBranch !== 'master') {
      addIssue(issues, {
        id: 'git.no_upstream',
        severity: 'warn',
        title: 'Current branch has no upstream',
        message: `The current branch "${currentBranch}" is not tracking a remote branch.`,
        fixes: [
          `git push -u origin ${currentBranch}`,
        ],
      });
    }
  }

  const gitUser = checkGitUserConfig(gitCwd);
  if (!gitUser.name || !gitUser.email) {
    addIssue(issues, {
      id: 'git.user_config',
      severity: 'error',
      title: 'Git user not configured',
      message: 'Git user name or email is not set. CursorFlow cannot create commits without these.',
      fixes: [
        `git config --global user.name "Your Name"`,
        `git config --global user.email "you@example.com"`,
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
  } else {
    // Advanced check: .gitignore check for worktrees
    const gitignorePath = path.join(gitCwd, '.gitignore');
    const worktreeDirName = '_cursorflow'; // Default directory name
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf8');
      if (!content.includes(worktreeDirName)) {
        addIssue(issues, {
          id: 'git.gitignore_missing_worktree',
          severity: 'warn',
          title: 'Worktree directory not ignored',
          message: `The directory "${worktreeDirName}" is not in your .gitignore. This could lead to accidentally committing temporary worktrees or logs.`,
          fixes: [
            `Add "${worktreeDirName}/" to your .gitignore`,
            'Run `cursorflow init` to set up recommended ignores',
          ],
        });
      }
    }
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



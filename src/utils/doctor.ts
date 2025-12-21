/**
 * CursorFlow Doctor - environment and preflight checks
 *
 * This module provides actionable diagnostics for common run failures:
 * - Not inside a Git work tree
 * - Missing `origin` remote (required for pushing lane branches)
 * - Missing Git worktree support
 * - Missing base branch referenced by lane task files
 * - Missing/invalid tasks directory
 * - Task validation (name, prompt, structure)
 * - Circular dependency detection (DAG validation)
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

function readLaneJsonFiles(tasksDir: string): { path: string; json: any; fileName: string }[] {
  const files = fs
    .readdirSync(tasksDir)
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => path.join(tasksDir, f));

  return files.map(p => {
    const raw = fs.readFileSync(p, 'utf8');
    const json = JSON.parse(raw);
    return { path: p, json, fileName: path.basename(p, '.json') };
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
 * Validate task structure within a lane
 */
function validateTaskStructure(
  issues: DoctorIssue[],
  laneFile: string,
  json: any
): void {
  const laneName = path.basename(laneFile, '.json');
  
  // Check if tasks array exists
  if (!json.tasks) {
    addIssue(issues, {
      id: `tasks.${laneName}.missing_tasks`,
      severity: 'error',
      title: `Missing tasks array in ${laneName}`,
      message: `Lane "${laneName}" does not have a "tasks" array.`,
      fixes: ['Add a "tasks" array with at least one task object'],
    });
    return;
  }
  
  if (!Array.isArray(json.tasks)) {
    addIssue(issues, {
      id: `tasks.${laneName}.invalid_tasks`,
      severity: 'error',
      title: `Invalid tasks in ${laneName}`,
      message: `Lane "${laneName}" has "tasks" but it's not an array.`,
      fixes: ['Ensure "tasks" is an array of task objects'],
    });
    return;
  }
  
  if (json.tasks.length === 0) {
    addIssue(issues, {
      id: `tasks.${laneName}.empty_tasks`,
      severity: 'error',
      title: `No tasks in ${laneName}`,
      message: `Lane "${laneName}" has an empty tasks array.`,
      fixes: ['Add at least one task with "name" and "prompt" fields'],
    });
    return;
  }
  
  // Validate each task
  const taskNamePattern = /^[a-zA-Z0-9_-]+$/;
  const seenNames = new Set<string>();
  
  json.tasks.forEach((task: any, index: number) => {
    const taskId = task.name || `task[${index}]`;
    
    // Check name
    if (!task.name) {
      addIssue(issues, {
        id: `tasks.${laneName}.${index}.missing_name`,
        severity: 'error',
        title: `Missing task name in ${laneName}`,
        message: `Task at index ${index} in "${laneName}" is missing the "name" field.`,
        fixes: ['Add a "name" field to the task (e.g., "implement", "test")'],
      });
    } else if (typeof task.name !== 'string') {
      addIssue(issues, {
        id: `tasks.${laneName}.${index}.invalid_name_type`,
        severity: 'error',
        title: `Invalid task name type in ${laneName}`,
        message: `Task at index ${index} in "${laneName}" has a non-string "name" field.`,
        fixes: ['Ensure "name" is a string'],
      });
    } else if (!taskNamePattern.test(task.name)) {
      addIssue(issues, {
        id: `tasks.${laneName}.${taskId}.invalid_name_format`,
        severity: 'error',
        title: `Invalid task name format in ${laneName}`,
        message: `Task "${task.name}" in "${laneName}" has invalid characters. Only alphanumeric, "-", and "_" are allowed.`,
        fixes: [`Rename task to use only alphanumeric characters, "-", or "_"`],
      });
    } else if (seenNames.has(task.name)) {
      addIssue(issues, {
        id: `tasks.${laneName}.${taskId}.duplicate_name`,
        severity: 'error',
        title: `Duplicate task name in ${laneName}`,
        message: `Task name "${task.name}" appears multiple times in "${laneName}".`,
        fixes: ['Ensure each task has a unique name within the lane'],
      });
    } else {
      seenNames.add(task.name);
    }
    
    // Check prompt
    if (!task.prompt) {
      addIssue(issues, {
        id: `tasks.${laneName}.${taskId}.missing_prompt`,
        severity: 'error',
        title: `Missing task prompt in ${laneName}`,
        message: `Task "${taskId}" in "${laneName}" is missing the "prompt" field.`,
        fixes: ['Add a "prompt" field with instructions for the AI'],
      });
    } else if (typeof task.prompt !== 'string') {
      addIssue(issues, {
        id: `tasks.${laneName}.${taskId}.invalid_prompt_type`,
        severity: 'error',
        title: `Invalid task prompt type in ${laneName}`,
        message: `Task "${taskId}" in "${laneName}" has a non-string "prompt" field.`,
        fixes: ['Ensure "prompt" is a string'],
      });
    } else if (task.prompt.trim().length < 10) {
      addIssue(issues, {
        id: `tasks.${laneName}.${taskId}.short_prompt`,
        severity: 'warn',
        title: `Short task prompt in ${laneName}`,
        message: `Task "${taskId}" in "${laneName}" has a very short prompt (${task.prompt.trim().length} chars). Consider providing more detailed instructions.`,
        fixes: ['Provide clearer, more detailed instructions in the prompt'],
      });
    }
    
    // Check acceptanceCriteria if present
    if (task.acceptanceCriteria !== undefined) {
      if (!Array.isArray(task.acceptanceCriteria)) {
        addIssue(issues, {
          id: `tasks.${laneName}.${taskId}.invalid_criteria_type`,
          severity: 'error',
          title: `Invalid acceptanceCriteria in ${laneName}`,
          message: `Task "${taskId}" in "${laneName}" has "acceptanceCriteria" but it's not an array.`,
          fixes: ['Ensure "acceptanceCriteria" is an array of strings'],
        });
      } else if (task.acceptanceCriteria.length === 0) {
        addIssue(issues, {
          id: `tasks.${laneName}.${taskId}.empty_criteria`,
          severity: 'warn',
          title: `Empty acceptanceCriteria in ${laneName}`,
          message: `Task "${taskId}" in "${laneName}" has an empty "acceptanceCriteria" array.`,
          fixes: ['Add acceptance criteria or remove the empty array'],
        });
      }
    }
    
    // Check model if present
    if (task.model !== undefined && typeof task.model !== 'string') {
      addIssue(issues, {
        id: `tasks.${laneName}.${taskId}.invalid_model_type`,
        severity: 'error',
        title: `Invalid model type in ${laneName}`,
        message: `Task "${taskId}" in "${laneName}" has a non-string "model" field.`,
        fixes: ['Ensure "model" is a string (e.g., "sonnet-4.5")'],
      });
    }
  });
}

/**
 * Detect circular dependencies in the lane dependency graph (DAG validation)
 */
function detectCircularDependencies(
  issues: DoctorIssue[],
  lanes: { path: string; json: any; fileName: string }[]
): void {
  // Build adjacency list
  const graph = new Map<string, string[]>();
  const allLaneNames = new Set<string>();
  
  for (const lane of lanes) {
    allLaneNames.add(lane.fileName);
    const deps = lane.json.dependsOn || [];
    graph.set(lane.fileName, Array.isArray(deps) ? deps : []);
  }
  
  // Check for unknown dependencies
  for (const lane of lanes) {
    const deps = lane.json.dependsOn || [];
    if (!Array.isArray(deps)) continue;
    
    for (const dep of deps) {
      if (!allLaneNames.has(dep)) {
        addIssue(issues, {
          id: `tasks.${lane.fileName}.unknown_dependency`,
          severity: 'error',
          title: `Unknown dependency in ${lane.fileName}`,
          message: `Lane "${lane.fileName}" depends on "${dep}" which does not exist.`,
          fixes: [
            `Verify the dependency name matches an existing lane file (without .json extension)`,
            `Available lanes: ${Array.from(allLaneNames).join(', ')}`,
          ],
        });
      }
    }
  }
  
  // Detect cycles using DFS
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const cyclePath: string[] = [];
  
  function hasCycle(node: string, path: string[]): boolean {
    if (recursionStack.has(node)) {
      // Found a cycle
      const cycleStart = path.indexOf(node);
      cyclePath.push(...path.slice(cycleStart), node);
      return true;
    }
    
    if (visited.has(node)) {
      return false;
    }
    
    visited.add(node);
    recursionStack.add(node);
    
    const deps = graph.get(node) || [];
    for (const dep of deps) {
      if (hasCycle(dep, [...path, node])) {
        return true;
      }
    }
    
    recursionStack.delete(node);
    return false;
  }
  
  for (const laneName of allLaneNames) {
    cyclePath.length = 0;
    visited.clear();
    recursionStack.clear();
    
    if (hasCycle(laneName, [])) {
      addIssue(issues, {
        id: 'tasks.circular_dependency',
        severity: 'error',
        title: 'Circular dependency detected',
        message: `Circular dependency found: ${cyclePath.join(' → ')}`,
        details: 'Lane dependencies must form a DAG (Directed Acyclic Graph). Circular dependencies will cause a deadlock.',
        fixes: [
          'Review the "dependsOn" fields in your lane files',
          'Remove one of the dependencies to break the cycle',
        ],
      });
      return; // Report only one cycle
    }
  }
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
  const { spawnSync } = require('child_process');
  try {
    // Validate and normalize the directory path to prevent command injection
    const safePath = path.resolve(dir);
    
    // Use spawnSync instead of execSync to avoid shell interpolation vulnerabilities
    // df -B1 returns bytes. We look for the line corresponding to our directory.
    const result = spawnSync('df', ['-B1', safePath], { encoding: 'utf8' });
    
    if (result.status !== 0) {
      return { ok: false, error: result.stderr || 'df command failed' };
    }
    
    const output = result.stdout;
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
 * Get all local branch names
 */
function getAllLocalBranches(repoRoot: string): string[] {
  const res = git.runGitResult(['branch', '--list', '--format=%(refname:short)'], { cwd: repoRoot });
  if (!res.success) return [];
  return res.stdout.split('\n').map(b => b.trim()).filter(b => b);
}

/**
 * Get all remote branch names
 */
function getAllRemoteBranches(repoRoot: string): string[] {
  const res = git.runGitResult(['branch', '-r', '--list', '--format=%(refname:short)'], { cwd: repoRoot });
  if (!res.success) return [];
  return res.stdout.split('\n')
    .map(b => b.trim().replace(/^origin\//, ''))
    .filter(b => b && !b.includes('HEAD'));
}

/**
 * Validate branch names for conflicts and issues
 */
function validateBranchNames(
  issues: DoctorIssue[],
  lanes: { path: string; json: any; fileName: string }[],
  repoRoot: string
): void {
  const localBranches = getAllLocalBranches(repoRoot);
  const remoteBranches = getAllRemoteBranches(repoRoot);
  const allExistingBranches = new Set([...localBranches, ...remoteBranches]);
  
  // Collect branch prefixes and pipeline branches from lanes
  const branchPrefixes: { laneName: string; prefix: string }[] = [];
  const pipelineBranches: { laneName: string; branch: string }[] = [];
  
  for (const lane of lanes) {
    const branchPrefix = lane.json?.branchPrefix;
    if (branchPrefix) {
      branchPrefixes.push({ laneName: lane.fileName, prefix: branchPrefix });
    }
    
    const pipelineBranch = lane.json?.pipelineBranch;
    if (pipelineBranch) {
      pipelineBranches.push({ laneName: lane.fileName, branch: pipelineBranch });
    }
  }
  
  // Check for pipeline branch collisions
  const pipeMap = new Map<string, string[]>();
  for (const { laneName, branch } of pipelineBranches) {
    const existing = pipeMap.get(branch) || [];
    existing.push(laneName);
    pipeMap.set(branch, existing);
  }
  
  for (const [branch, laneNames] of pipeMap) {
    if (laneNames.length > 1) {
      addIssue(issues, {
        id: 'branch.pipeline_collision',
        severity: 'error',
        title: 'Pipeline branch collision',
        message: `Multiple lanes use the same pipelineBranch "${branch}": ${laneNames.join(', ')}`,
        details: 'Each lane should have a unique pipelineBranch to avoid worktree conflicts during parallel execution.',
        fixes: [
          'Update the pipelineBranch in each lane JSON file to be unique',
          'Or remove pipelineBranch to let CursorFlow generate unique ones',
        ],
      });
    }
  }

  // Check for branch prefix collisions between lanes
  const prefixMap = new Map<string, string[]>();
  for (const { laneName, prefix } of branchPrefixes) {
    const existing = prefixMap.get(prefix) || [];
    existing.push(laneName);
    prefixMap.set(prefix, existing);
  }
  
  for (const [prefix, laneNames] of prefixMap) {
    if (laneNames.length > 1) {
      addIssue(issues, {
        id: 'branch.prefix_collision',
        severity: 'error',
        title: 'Branch prefix collision',
        message: `Multiple lanes use the same branchPrefix "${prefix}": ${laneNames.join(', ')}`,
        details: 'Each lane should have a unique branchPrefix to avoid conflicts.',
        fixes: [
          'Update the branchPrefix in each lane JSON file to be unique',
          'Example: "featurename/lane-1-", "featurename/lane-2-"',
        ],
      });
    }
  }
  
  // Check for existing branches that match lane prefixes
  for (const { laneName, prefix } of branchPrefixes) {
    const conflictingBranches: string[] = [];
    
    for (const branch of allExistingBranches) {
      if (branch.startsWith(prefix)) {
        conflictingBranches.push(branch);
      }
    }
    
    if (conflictingBranches.length > 0) {
      addIssue(issues, {
        id: `branch.existing_conflict.${laneName}`,
        severity: 'warn',
        title: `Existing branches may conflict with ${laneName}`,
        message: `Found ${conflictingBranches.length} existing branch(es) matching prefix "${prefix}": ${conflictingBranches.slice(0, 3).join(', ')}${conflictingBranches.length > 3 ? '...' : ''}`,
        details: 'These branches may cause issues if the lane tries to create a new branch with the same name.',
        fixes: [
          `Delete conflicting branches: git branch -D ${conflictingBranches[0]}`,
          `Or change the branchPrefix in ${laneName}.json`,
          'Run: cursorflow clean branches --dry-run to see all CursorFlow branches',
        ],
      });
    }
  }
  
  // Check for duplicate lane file names (which would cause branch issues)
  const laneFileNames = lanes.map(l => l.fileName);
  const duplicateNames = laneFileNames.filter((name, index) => laneFileNames.indexOf(name) !== index);
  
  if (duplicateNames.length > 0) {
    addIssue(issues, {
      id: 'tasks.duplicate_lane_files',
      severity: 'error',
      title: 'Duplicate lane file names',
      message: `Found duplicate lane names: ${[...new Set(duplicateNames)].join(', ')}`,
      fixes: ['Ensure each lane file has a unique name'],
    });
  }
  
  // Suggest unique branch naming convention
  const hasNumericPrefix = branchPrefixes.some(({ prefix }) => /\/lane-\d+-$/.test(prefix));
  if (!hasNumericPrefix && branchPrefixes.length > 1) {
    addIssue(issues, {
      id: 'branch.naming_suggestion',
      severity: 'warn',
      title: 'Consider using lane numbers in branch prefix',
      message: 'Using consistent lane numbers in branch prefixes helps avoid conflicts.',
      fixes: [
        'Use pattern: "feature-name/lane-{N}-" where N is the lane number',
        'Example: "auth-system/lane-1-", "auth-system/lane-2-"',
      ],
    });
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
 * - Task structure validation (name, prompt, etc.)
 * - Circular dependency detection (DAG validation)
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
          'Verify your SSH keys or credentials are configured correctly',
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
      let lanes: { path: string; json: any; fileName: string }[] = [];
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
        // Validate base branches
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
        
        // Validate task structure in each lane
        for (const lane of lanes) {
          validateTaskStructure(issues, lane.fileName, lane.json);
        }
        
        // Detect circular dependencies
        detectCircularDependencies(issues, lanes);
        
        // Validate branch names - check for conflicts
        validateBranchNames(issues, lanes, gitCwd);
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

      // MCP/Permissions potential hang check
      addIssue(issues, {
        id: 'cursor_agent.mcp_priming',
        severity: 'warn',
        title: 'Agent may require interactive approval',
        message: 'Non-interactive execution (with --print) can hang if MCP permissions or user approvals are required.',
        fixes: [
          'Run once interactively to prime permissions: cursorflow doctor --test-agent',
        ],
      });
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

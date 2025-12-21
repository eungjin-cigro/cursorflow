/**
 * Git utilities for CursorFlow
 */

import { execSync, spawnSync } from 'child_process';

export interface GitRunOptions {
  cwd?: string;
  silent?: boolean;
}

export interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  success: boolean;
}

export interface WorktreeInfo {
  path: string;
  branch?: string;
  head?: string;
}

export interface ChangedFile {
  status: string;
  file: string;
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  author: string;
  authorEmail: string;
  timestamp: number;
  subject: string;
}

/**
 * Run git command and return output
 */
export function runGit(args: string[], options: GitRunOptions = {}): string {
  const { cwd, silent = false } = options;
  
  try {
    const result = spawnSync('git', args, {
      cwd: cwd || process.cwd(),
      encoding: 'utf8',
      stdio: silent ? 'pipe' : 'inherit',
    });
    
    if (result.status !== 0 && !silent) {
      throw new Error(`Git command failed: git ${args.join(' ')}\n${result.stderr || ''}`);
    }
    
    return result.stdout ? result.stdout.trim() : '';
  } catch (error) {
    if (silent) {
      return '';
    }
    throw error;
  }
}

/**
 * Run git command and return result object
 */
export function runGitResult(args: string[], options: GitRunOptions = {}): GitResult {
  const { cwd } = options;
  
  const result = spawnSync('git', args, {
    cwd: cwd || process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
  });
  
  return {
    exitCode: result.status ?? 1,
    stdout: (result.stdout || '').toString().trim(),
    stderr: (result.stderr || '').toString().trim(),
    success: result.status === 0,
  };
}

/**
 * Get current branch name
 */
export function getCurrentBranch(cwd?: string): string {
  return runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, silent: true });
}

/**
 * Get repository root directory
 */
export function getRepoRoot(cwd?: string): string {
  return runGit(['rev-parse', '--show-toplevel'], { cwd, silent: true });
}

/**
 * Check if directory is a git repository
 */
export function isGitRepo(cwd?: string): boolean {
  const result = runGitResult(['rev-parse', '--git-dir'], { cwd });
  return result.success;
}

/**
 * Check if worktree exists
 */
export function worktreeExists(worktreePath: string, cwd?: string): boolean {
  const result = runGitResult(['worktree', 'list'], { cwd });
  if (!result.success) return false;
  
  return result.stdout.includes(worktreePath);
}

/**
 * Create worktree
 */
export function createWorktree(worktreePath: string, branchName: string, options: { cwd?: string; baseBranch?: string } = {}): string {
  const { cwd, baseBranch = 'main' } = options;
  
  // Check if branch already exists
  const branchExists = runGitResult(['rev-parse', '--verify', branchName], { cwd }).success;
  
  if (branchExists) {
    // Branch exists, checkout to worktree
    runGit(['worktree', 'add', worktreePath, branchName], { cwd });
  } else {
    // Create new branch from base
    runGit(['worktree', 'add', '-b', branchName, worktreePath, baseBranch], { cwd });
  }
  
  return worktreePath;
}

/**
 * Remove worktree
 */
export function removeWorktree(worktreePath: string, options: { cwd?: string; force?: boolean } = {}): void {
  const { cwd, force = false } = options;
  
  const args = ['worktree', 'remove', worktreePath];
  if (force) {
    args.push('--force');
  }
  
  runGit(args, { cwd });
}

/**
 * List all worktrees
 */
export function listWorktrees(cwd?: string): WorktreeInfo[] {
  const result = runGitResult(['worktree', 'list', '--porcelain'], { cwd });
  if (!result.success) return [];
  
  const worktrees: WorktreeInfo[] = [];
  const lines = result.stdout.split('\n');
  let current: Partial<WorktreeInfo> = {};
  
  for (const line of lines) {
    if (line.startsWith('worktree ')) {
      if (current.path) {
        worktrees.push(current as WorktreeInfo);
      }
      current = { path: line.slice(9) };
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice(7);
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice(5);
    }
  }
  
  if (current.path) {
    worktrees.push(current as WorktreeInfo);
  }
  
  return worktrees;
}

/**
 * Check if there are uncommitted changes
 */
export function hasUncommittedChanges(cwd?: string): boolean {
  const result = runGitResult(['status', '--porcelain'], { cwd });
  return result.success && result.stdout.length > 0;
}

/**
 * Get list of changed files
 */
export function getChangedFiles(cwd?: string): ChangedFile[] {
  const result = runGitResult(['status', '--porcelain'], { cwd });
  if (!result.success) return [];
  
  return result.stdout
    .split('\n')
    .filter(line => line.trim())
    .map(line => {
      const status = line.slice(0, 2);
      const file = line.slice(3);
      return { status, file };
    });
}

/**
 * Create commit
 */
export function commit(message: string, options: { cwd?: string; addAll?: boolean } = {}): void {
  const { cwd, addAll = true } = options;
  
  if (addAll) {
    runGit(['add', '-A'], { cwd });
  }
  
  runGit(['commit', '-m', message], { cwd });
}

/**
 * Check if a remote exists
 */
export function remoteExists(remoteName = 'origin', options: { cwd?: string } = {}): boolean {
  const result = runGitResult(['remote'], { cwd: options.cwd });
  if (!result.success) return false;
  return result.stdout.split('\n').map(r => r.trim()).includes(remoteName);
}

/**
 * Push to remote
 */
export function push(branchName: string, options: { cwd?: string; force?: boolean; setUpstream?: boolean } = {}): void {
  const { cwd, force = false, setUpstream = false } = options;
  
  // Check if origin exists before pushing
  if (!remoteExists('origin', { cwd })) {
    // If no origin, just skip pushing (useful for local tests)
    return;
  }

  const args = ['push'];
  
  if (force) {
    args.push('--force');
  }
  
  if (setUpstream) {
    args.push('-u', 'origin', branchName);
  } else {
    args.push('origin', branchName);
  }
  
  runGit(args, { cwd });
}

/**
 * Fetch from remote
 */
export function fetch(options: { cwd?: string; prune?: boolean } = {}): void {
  const { cwd, prune = true } = options;
  
  const args = ['fetch', 'origin'];
  if (prune) {
    args.push('--prune');
  }
  
  runGit(args, { cwd });
}

/**
 * Check if branch exists (local or remote)
 */
export function branchExists(branchName: string, options: { cwd?: string; remote?: boolean } = {}): boolean {
  const { cwd, remote = false } = options;
  
  if (remote) {
    const result = runGitResult(['ls-remote', '--heads', 'origin', branchName], { cwd });
    return result.success && result.stdout.length > 0;
  } else {
    const result = runGitResult(['rev-parse', '--verify', branchName], { cwd });
    return result.success;
  }
}

/**
 * Delete branch
 */
export function deleteBranch(branchName: string, options: { cwd?: string; force?: boolean; remote?: boolean } = {}): void {
  const { cwd, force = false, remote = false } = options;
  
  if (remote) {
    runGit(['push', 'origin', '--delete', branchName], { cwd });
  } else {
    const args = ['branch', force ? '-D' : '-d', branchName];
    runGit(args, { cwd });
  }
}

/**
 * Merge branch
 */
export function merge(branchName: string, options: { cwd?: string; noFf?: boolean; message?: string | null } = {}): void {
  const { cwd, noFf = false, message = null } = options;
  
  const args = ['merge'];
  
  if (noFf) {
    args.push('--no-ff');
  }
  
  if (message) {
    args.push('-m', message);
  }
  
  args.push(branchName);
  
  runGit(args, { cwd });
}

/**
 * Get commit info
 */
export function getCommitInfo(commitHash: string, options: { cwd?: string } = {}): CommitInfo | null {
  const { cwd } = options;
  
  const format = '--format=%H%n%h%n%an%n%ae%n%at%n%s';
  const result = runGitResult(['show', '-s', format, commitHash], { cwd });
  
  if (!result.success) return null;
  
  const lines = result.stdout.split('\n');
  return {
    hash: lines[0] || '',
    shortHash: lines[1] || '',
    author: lines[2] || '',
    authorEmail: lines[3] || '',
    timestamp: parseInt(lines[4] || '0'),
    subject: lines[5] || '',
  };
}

/**
 * Get diff statistics for the last operation (commit or merge)
 * Comparing HEAD with its first parent
 */
export function getLastOperationStats(cwd?: string): string {
  try {
    // Check if there are any commits
    const hasCommits = runGitResult(['rev-parse', 'HEAD'], { cwd }).success;
    if (!hasCommits) return '';

    // Check if HEAD has a parent
    const hasParent = runGitResult(['rev-parse', 'HEAD^1'], { cwd }).success;
    if (!hasParent) {
      // If no parent, show stats for the first commit
      // Using an empty tree hash as the base
      const emptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
      return runGit(['diff', '--stat', emptyTree, 'HEAD'], { cwd, silent: true });
    }

    return runGit(['diff', '--stat', 'HEAD^1', 'HEAD'], { cwd, silent: true });
  } catch (e) {
    return '';
  }
}
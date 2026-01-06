/**
 * Git utilities for CursorFlow
 */

import { execSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { safeJoin } from './path';
import * as logger from './logger';

let verboseGitEnabled = true;

/**
 * Enable or disable verbose git logging
 */
export function setVerboseGit(enabled: boolean): void {
  verboseGitEnabled = enabled;
}

/**
 * Acquire a file-based lock for Git operations
 */
function acquireLock(lockName: string, cwd?: string): string | null {
  const repoRoot = cwd || getRepoRoot();
  const lockDir = safeJoin(repoRoot, '_cursorflow', 'locks');
  if (!fs.existsSync(lockDir)) {
    fs.mkdirSync(lockDir, { recursive: true });
  }
  
  const lockFile = safeJoin(lockDir, `${lockName}.lock`);
  
  try {
    // wx flag ensures atomic creation
    fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
    return lockFile;
  } catch {
    return null;
  }
}

/**
 * Release a file-based lock
 */
function releaseLock(lockFile: string | null): void {
  if (lockFile && fs.existsSync(lockFile)) {
    try {
      fs.unlinkSync(lockFile);
    } catch {
      // Ignore
    }
  }
}

/**
 * Run Git command with locking
 */
async function runGitWithLock<T>(
  lockName: string,
  fn: () => T,
  options: { cwd?: string; maxRetries?: number; retryDelay?: number } = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 10;
  const retryDelay = options.retryDelay ?? 500;
  
  let retries = 0;
  let lockFile = null;
  
  while (retries < maxRetries) {
    lockFile = acquireLock(lockName, options.cwd);
    if (lockFile) break;
    
    retries++;
    const delay = Math.floor(Math.random() * retryDelay) + retryDelay / 2;
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  
  if (!lockFile) {
    throw new Error(`Failed to acquire lock: ${lockName}`);
  }
  
  try {
    return fn();
  } finally {
    releaseLock(lockFile);
  }
}

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
 * Filter out noisy git stderr messages
 */
function filterGitStderr(stderr: string): string {
  if (!stderr) return '';
  
  const lines = stderr.split('\n');
  const filtered = lines.filter(line => {
    // GitHub noise
    if (line.includes('remote: Create a pull request')) return false;
    if (line.trim().startsWith('remote:') && line.includes('pull/new')) return false;
    if (line.trim() === 'remote:') return false; // Empty remote lines
    
    return true;
  });
  
  return filtered.join('\n');
}

/**
 * Run git command and return output
 */
export function runGit(args: string[], options: GitRunOptions = {}): string {
  const { cwd, silent = false } = options;
  
  if (verboseGitEnabled || process.env['DEBUG_GIT']) {
    logger.debug(`Running: git ${args.join(' ')}`, { context: 'git', emoji: '🛠️' });
    if (cwd) {
      logger.debug(`  cwd: ${cwd}`, { context: 'git' });
    }
  }
  
  try {
    const stdioMode = silent ? 'pipe' : ['inherit', 'inherit', 'pipe'];

    const result = spawnSync('git', args, {
      cwd: cwd || process.cwd(),
      encoding: 'utf8',
      stdio: stdioMode as any,
      timeout: 30000, // 30 second timeout for all git operations
    });
    
    if (result.error) {
      if (!silent) {
        console.error(`[ERROR_GIT] Failed to execute git command: ${result.error.message}`);
      }
      throw result.error;
    }

    if (!silent && result.stderr) {
      const filteredStderr = filterGitStderr(result.stderr);
      if (filteredStderr) {
        process.stderr.write(filteredStderr);
      }
    }
    
    if (result.status !== 0 && !silent) {
      const errorMsg = `Git command failed (exit code ${result.status}): git ${args.join(' ')}\n${result.stderr || ''}`;
      throw new Error(errorMsg);
    }
    
    return result.stdout ? result.stdout.trim() : '';
  } catch (error) {
    if (silent) {
      if (process.env['DEBUG_GIT']) {
        console.error(`[DEBUG_GIT] Command failed (silent mode): ${error instanceof Error ? error.message : String(error)}`);
      }
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
  
  if (verboseGitEnabled || process.env['DEBUG_GIT']) {
    logger.debug(`Running: git ${args.join(' ')} (result mode)`, { context: 'git', emoji: '🛠️' });
    if (cwd) {
      logger.debug(`  cwd: ${cwd}`, { context: 'git' });
    }
  }

  const result = spawnSync('git', args, {
    cwd: cwd || process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 30000, // 30 second timeout
  });
  
  const gitResult = {
    exitCode: result.status ?? 1,
    stdout: (result.stdout || '').toString().trim(),
    stderr: (result.stderr || '').toString().trim(),
    success: result.status === 0,
  };

  if (process.env['DEBUG_GIT'] && !gitResult.success) {
    console.error(`[DEBUG_GIT] Command failed: git ${args.join(' ')}\nstderr: ${gitResult.stderr}`);
  }

  return gitResult;
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
 * Get main repository root directory (for worktrees)
 */
export function getMainRepoRoot(cwd?: string): string {
  try {
    const result = runGitResult(['worktree', 'list', '--porcelain'], { cwd });
    if (result.success && result.stdout) {
      const firstLine = result.stdout.split('\n')[0];
      if (firstLine && firstLine.startsWith('worktree ')) {
        return firstLine.slice(9).trim();
      }
    }
  } catch {
    // Fallback to normal repo root
  }
  return getRepoRoot(cwd);
}

/**
 * Check if directory is a git repository
 */
export function isGitRepo(cwd?: string): boolean {
  const result = runGitResult(['rev-parse', '--git-dir'], { cwd });
  return result.success;
}

/**
 * Check if worktree exists in Git's worktree list
 */
export function worktreeExists(worktreePath: string, cwd?: string): boolean {
  const result = runGitResult(['worktree', 'list'], { cwd });
  if (!result.success) return false;
  
  return result.stdout.includes(worktreePath);
}

/**
 * Check if a directory is a valid Git worktree (not just a regular directory)
 * This prevents accidental checkout in the main repository when the worktree
 * directory exists but is not properly registered as a worktree.
 */
export function isValidWorktree(dirPath: string): boolean {
  // 1. Directory must exist
  if (!fs.existsSync(dirPath)) {
    return false;
  }
  
  // 2. Check if Git recognizes this as a worktree by checking .git file
  // In a worktree, .git is a file (not a directory) pointing to the main repo's .git/worktrees/
  const dotGitPath = path.join(dirPath, '.git');
  if (!fs.existsSync(dotGitPath)) {
    return false;
  }
  
  try {
    const stat = fs.statSync(dotGitPath);
    
    // In worktrees, .git is a FILE containing "gitdir: /path/to/.git/worktrees/..."
    // In the main repo, .git is a DIRECTORY
    if (stat.isDirectory()) {
      // This is the main repository, not a worktree
      return false;
    }
    
    // Read the .git file to verify it points to a valid worktree
    const content = fs.readFileSync(dotGitPath, 'utf8').trim();
    if (!content.startsWith('gitdir:')) {
      return false;
    }
    
    // Verify the gitdir path exists
    const gitdirPath = content.replace('gitdir:', '').trim();
    return fs.existsSync(gitdirPath);
  } catch {
    return false;
  }
}

/**
 * Remove a directory that was supposed to be a worktree but isn't valid
 * Used to clean up orphaned/corrupted worktree directories before recreation
 */
export function cleanupInvalidWorktreeDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) return;
  
  // Only remove if it's NOT a valid worktree (safety check)
  if (isValidWorktree(dirPath)) {
    throw new Error(`Cannot cleanup: ${dirPath} is a valid worktree`);
  }
  
  // Remove the directory recursively
  fs.rmSync(dirPath, { recursive: true, force: true });
}

/**
 * Create worktree
 */
export function createWorktree(worktreePath: string, branchName: string, options: { cwd?: string; baseBranch?: string } = {}): string {
  let { cwd, baseBranch } = options;
  
  if (!baseBranch) {
    baseBranch = getCurrentBranch(cwd) || 'refs/heads/main';
  }

  // Ensure baseBranch is unambiguous (branch name rather than tag)
  // Special case: HEAD should not be prefixed with refs/heads/
  const unambiguousBase = (baseBranch === 'HEAD' || baseBranch.startsWith('refs/') || baseBranch.includes('/')) 
    ? baseBranch 
    : `refs/heads/${baseBranch}`;

  // Use a file-based lock to prevent race conditions during worktree creation
  const lockDir = safeJoin(cwd || getRepoRoot(), '_cursorflow', 'locks');
  if (!fs.existsSync(lockDir)) {
    fs.mkdirSync(lockDir, { recursive: true });
  }
  const lockFile = safeJoin(lockDir, 'worktree.lock');
  
  let retries = 20;
  let acquired = false;
  
  while (retries > 0 && !acquired) {
    try {
      fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
      acquired = true;
    } catch {
      retries--;
      const delay = Math.floor(Math.random() * 500) + 200;
      // Use synchronous sleep to keep the function signature synchronous
      const end = Date.now() + delay;
      while (Date.now() < end) { /* wait */ }
    }
  }
  
  if (!acquired) {
    throw new Error('Failed to acquire worktree lock after multiple retries');
  }
  
  try {
    // Check if branch already exists
    const branchExists = runGitResult(['rev-parse', '--verify', branchName], { cwd }).success;
    
    if (branchExists) {
      // Branch exists, checkout to worktree
      runGit(['worktree', 'add', worktreePath, branchName], { cwd });
    } else {
      // Create new branch from base
      runGit(['worktree', 'add', '-b', branchName, worktreePath, unambiguousBase], { cwd });
    }
    
    return worktreePath;
  } finally {
    try {
      fs.unlinkSync(lockFile);
    } catch {
      // Ignore
    }
  }
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

// ============================================================================
// Enhanced Git Functions for Robustness
// ============================================================================

/**
 * Generate a unique branch name that doesn't conflict with existing branches
 */
export function generateUniqueBranchName(baseName: string, options: { cwd?: string; maxAttempts?: number } = {}): string {
  const { cwd, maxAttempts = 10 } = options;
  const timestamp = Date.now().toString(36);
  const random = () => Math.random().toString(36).substring(2, 5);
  
  // First attempt: base name with timestamp
  let candidate = `${baseName}-${timestamp}-${random()}`;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (!branchExists(candidate, { cwd })) {
      return candidate;
    }
    // Try with new random suffix
    candidate = `${baseName}-${timestamp}-${random()}`;
  }
  
  // Last resort: use full timestamp with random
  return `${baseName}-${Date.now()}-${random()}`;
}

/**
 * Safe merge result
 */
export interface SafeMergeResult {
  success: boolean;
  conflict: boolean;
  conflictingFiles: string[];
  error?: string;
  aborted: boolean;
}

/**
 * Check if merging a branch would cause conflicts (dry-run)
 * This does NOT actually perform the merge - it only checks for potential conflicts
 */
export function checkMergeConflict(branchName: string, options: { cwd?: string } = {}): {
  willConflict: boolean;
  conflictingFiles: string[];
  error?: string;
} {
  const { cwd } = options;
  
  // Use merge-tree to check for conflicts without actually merging
  // First, get the merge base
  const mergeBaseResult = runGitResult(['merge-base', 'HEAD', branchName], { cwd });
  if (!mergeBaseResult.success) {
    return { willConflict: false, conflictingFiles: [], error: `Cannot find merge base: ${mergeBaseResult.stderr}` };
  }
  
  const mergeBase = mergeBaseResult.stdout.trim();
  
  // Use merge-tree to simulate the merge
  const mergeTreeResult = runGitResult(['merge-tree', mergeBase, 'HEAD', branchName], { cwd });
  
  // Check for conflict markers in the output
  const output = mergeTreeResult.stdout;
  const hasConflict = output.includes('<<<<<<<') || output.includes('>>>>>>>') || output.includes('=======');
  
  if (hasConflict) {
    // Extract conflicting file names from merge-tree output
    const conflictingFiles: string[] = [];
    const lines = output.split('\n');
    let currentFile = '';
    
    for (const line of lines) {
      // merge-tree output format includes file paths
      if (line.startsWith('changed in both')) {
        const match = line.match(/changed in both\s+(.+)/);
        if (match) {
          conflictingFiles.push(match[1]!.trim());
        }
      } else if (line.match(/^[a-f0-9]+ [a-f0-9]+ [a-f0-9]+\t(.+)$/)) {
        const match = line.match(/\t(.+)$/);
        if (match) {
          currentFile = match[1]!;
        }
      } else if (line.includes('<<<<<<<') && currentFile) {
        if (!conflictingFiles.includes(currentFile)) {
          conflictingFiles.push(currentFile);
        }
      }
    }
    
    return { willConflict: true, conflictingFiles };
  }
  
  return { willConflict: false, conflictingFiles: [] };
}

/**
 * Sync local branch with remote before starting work
 * Fetches the latest from remote and fast-forwards if possible
 */
export function syncBranchWithRemote(branchName: string, options: { 
  cwd?: string;
  createIfMissing?: boolean;
} = {}): { 
  success: boolean; 
  updated: boolean;
  error?: string;
  ahead?: number;
  behind?: number;
} {
  const { cwd, createIfMissing = false } = options;
  
  // Fetch the branch from origin
  const fetchResult = runGitResult(['fetch', 'origin', branchName], { cwd });
  
  if (!fetchResult.success) {
    // Branch might not exist on remote yet
    if (createIfMissing || fetchResult.stderr.includes("couldn't find remote ref")) {
      return { success: true, updated: false };
    }
    return { success: false, updated: false, error: fetchResult.stderr };
  }
  
  // Check if we're ahead/behind
  const statusResult = runGitResult(['rev-list', '--left-right', '--count', `${branchName}...origin/${branchName}`], { cwd });
  
  if (!statusResult.success) {
    // Remote tracking branch might not exist
    return { success: true, updated: false };
  }
  
  const [aheadStr, behindStr] = statusResult.stdout.trim().split(/\s+/);
  const ahead = parseInt(aheadStr || '0');
  const behind = parseInt(behindStr || '0');
  
  if (behind === 0) {
    // Already up to date or ahead
    return { success: true, updated: false, ahead, behind };
  }
  
  if (ahead > 0 && behind > 0) {
    // Diverged - cannot fast-forward
    return { 
      success: false, 
      updated: false, 
      ahead, 
      behind,
      error: `Branch has diverged: ${ahead} commits ahead, ${behind} commits behind. Manual resolution required.`
    };
  }
  
  // Can fast-forward
  const mergeResult = runGitResult(['merge', '--ff-only', `origin/${branchName}`], { cwd });
  
  if (mergeResult.success) {
    return { success: true, updated: true, ahead: 0, behind: 0 };
  }
  
  return { success: false, updated: false, error: mergeResult.stderr };
}

/**
 * Safely merge a branch with conflict detection and auto-abort
 */
export function safeMerge(branchName: string, options: { 
  cwd?: string; 
  noFf?: boolean; 
  message?: string | null;
  abortOnConflict?: boolean;
  strategy?: 'ours' | 'theirs' | null;
} = {}): SafeMergeResult {
  const { cwd, noFf = false, message = null, abortOnConflict = true, strategy = null } = options;
  
  const args = ['merge'];
  
  if (noFf) {
    args.push('--no-ff');
  }
  
  if (strategy) {
    args.push('-X', strategy);
  }
  
  if (message) {
    args.push('-m', message);
  }
  
  args.push(branchName);
  
  const result = runGitResult(args, { cwd });
  
  if (result.success) {
    return {
      success: true,
      conflict: false,
      conflictingFiles: [],
      aborted: false,
    };
  }
  
  // Check for conflicts
  const output = result.stdout + result.stderr;
  const isConflict = output.includes('CONFLICT') || output.includes('Automatic merge failed');
  
  if (isConflict) {
    // Get conflicting files
    const conflictingFiles = getConflictingFiles(cwd);
    
    if (abortOnConflict) {
      // Abort the merge
      runGitResult(['merge', '--abort'], { cwd });
      
      return {
        success: false,
        conflict: true,
        conflictingFiles,
        error: 'Merge conflict detected and aborted',
        aborted: true,
      };
    }
    
    return {
      success: false,
      conflict: true,
      conflictingFiles,
      error: 'Merge conflict - manual resolution required',
      aborted: false,
    };
  }
  
  return {
    success: false,
    conflict: false,
    conflictingFiles: [],
    error: result.stderr || 'Merge failed',
    aborted: false,
  };
}

/**
 * Get list of conflicting files
 */
export function getConflictingFiles(cwd?: string): string[] {
  const result = runGitResult(['diff', '--name-only', '--diff-filter=U'], { cwd });
  if (!result.success) return [];
  
  return result.stdout.split('\n').filter(f => f.trim());
}

/**
 * Check if merge is in progress
 */
export function isMergeInProgress(cwd?: string): boolean {
  const repoRoot = getRepoRoot(cwd);
  return fs.existsSync(path.join(repoRoot, '.git', 'MERGE_HEAD'));
}

/**
 * Abort ongoing merge
 */
export function abortMerge(cwd?: string): boolean {
  const result = runGitResult(['merge', '--abort'], { cwd });
  return result.success;
}

/**
 * Get HEAD commit hash
 */
export function getHead(cwd?: string): string {
  return runGit(['rev-parse', 'HEAD'], { cwd, silent: true });
}

/**
 * Get short HEAD commit hash
 */
export function getHeadShort(cwd?: string): string {
  return runGit(['rev-parse', '--short', 'HEAD'], { cwd, silent: true });
}

/**
 * Stash changes with optional message
 */
export function stash(message?: string, options: { cwd?: string } = {}): boolean {
  const args = ['stash', 'push'];
  if (message) {
    args.push('-m', message);
  }
  
  const result = runGitResult(args, { cwd: options.cwd });
  return result.success;
}

/**
 * Pop stashed changes
 */
export function stashPop(options: { cwd?: string } = {}): boolean {
  const result = runGitResult(['stash', 'pop'], { cwd: options.cwd });
  return result.success;
}

/**
 * Clean worktree (remove untracked files)
 */
export function cleanWorktree(options: { cwd?: string; force?: boolean; directories?: boolean } = {}): void {
  const args = ['clean'];
  if (options.force) args.push('-f');
  if (options.directories) args.push('-d');
  
  runGit(args, { cwd: options.cwd });
}

/**
 * Reset worktree to specific commit/branch
 */
export function reset(target: string, options: { cwd?: string; mode?: 'soft' | 'mixed' | 'hard' } = {}): void {
  const args = ['reset'];
  if (options.mode) args.push(`--${options.mode}`);
  args.push(target);
  
  runGit(args, { cwd: options.cwd });
}

/**
 * Checkout specific commit or branch
 */
export function checkout(target: string, options: { cwd?: string; force?: boolean; createBranch?: boolean } = {}): void {
  const args = ['checkout'];
  if (options.force) args.push('-f');
  if (options.createBranch) args.push('-b');
  args.push(target);
  
  runGit(args, { cwd: options.cwd });
}

/**
 * Get commits between two refs
 */
export function getCommitsBetween(fromRef: string, toRef: string, options: { cwd?: string } = {}): CommitInfo[] {
  const format = '%H|%h|%an|%ae|%at|%s';
  const result = runGitResult(['log', '--format=' + format, `${fromRef}..${toRef}`], { cwd: options.cwd });
  
  if (!result.success) return [];
  
  return result.stdout.split('\n')
    .filter(line => line.trim())
    .map(line => {
      const parts = line.split('|');
      return {
        hash: parts[0] || '',
        shortHash: parts[1] || '',
        author: parts[2] || '',
        authorEmail: parts[3] || '',
        timestamp: parseInt(parts[4] || '0'),
        subject: parts[5] || '',
      };
    });
}

/**
 * Enhanced worktree creation with async lock
 */
export async function createWorktreeAsync(
  worktreePath: string, 
  branchName: string, 
  options: { cwd?: string; baseBranch?: string; timeout?: number } = {}
): Promise<string> {
  let { cwd, baseBranch, timeout = 30000 } = options;
  
  if (!baseBranch) {
    baseBranch = getCurrentBranch(cwd) || 'refs/heads/main';
  }

  // Ensure baseBranch is unambiguous
  const unambiguousBase = (baseBranch.startsWith('refs/') || baseBranch.includes('/')) 
    ? baseBranch 
    : `refs/heads/${baseBranch}`;

  const { acquireLock, releaseLock } = await import('./lock');
  const lockDir = safeJoin(cwd || getRepoRoot(), '_cursorflow', 'locks');
  if (!fs.existsSync(lockDir)) {
    fs.mkdirSync(lockDir, { recursive: true });
  }
  const lockFile = safeJoin(lockDir, 'worktree.lock');
  
  const acquired = await acquireLock(lockFile, { 
    timeoutMs: timeout,
    operation: `createWorktree:${branchName}`,
  });
  
  if (!acquired) {
    throw new Error('Failed to acquire worktree lock after timeout');
  }
  
  try {
    // Check if branch already exists
    const branchExistsLocal = runGitResult(['rev-parse', '--verify', branchName], { cwd }).success;
    
    if (branchExistsLocal) {
      runGit(['worktree', 'add', worktreePath, branchName], { cwd });
    } else {
      runGit(['worktree', 'add', '-b', branchName, worktreePath, unambiguousBase], { cwd });
    }
    
    return worktreePath;
  } finally {
    await releaseLock(lockFile);
  }
}

/**
 * Prune orphaned worktrees
 */
export function pruneWorktrees(options: { cwd?: string } = {}): void {
  runGit(['worktree', 'prune'], { cwd: options.cwd });
}

/**
 * Get worktree for a specific path
 */
export function getWorktreeForPath(targetPath: string, cwd?: string): WorktreeInfo | null {
  const worktrees = listWorktrees(cwd);
  return worktrees.find(wt => wt.path === targetPath) || null;
}

/**
 * Sync branch with remote (fetch + merge or rebase)
 */
/**
 * Push branch to remote, creating it if it doesn't exist
 * Returns success status and any error message
 */
export function pushBranchSafe(branchName: string, options: { cwd?: string; force?: boolean } = {}): { success: boolean; error?: string } {
  const { cwd, force = false } = options;
  
  // Check if origin exists
  if (!remoteExists('origin', { cwd })) {
    return { success: false, error: 'No remote "origin" configured' };
  }
  
  const args = ['push'];
  if (force) {
    args.push('--force');
  }
  args.push('-u', 'origin', branchName);
  
  const result = runGitResult(args, { cwd });
  
  if (result.success) {
    return { success: true };
  }
  
  return { success: false, error: result.stderr };
}

/**
 * Push branch to remote with fallback branch name if push is rejected.
 * 
 * If the remote branch already exists and push is rejected (e.g., fetch first error),
 * this function will rename the local branch with a suffix and retry the push.
 * 
 * @returns Object with success status, the final branch name used, and optional error
 */
export function pushWithFallbackBranchName(
  branchName: string, 
  options: { 
    cwd?: string; 
    setUpstream?: boolean;
    maxRetries?: number;
  } = {}
): { success: boolean; finalBranchName: string; error?: string; renamed?: boolean } {
  const { cwd, setUpstream = true, maxRetries = 3 } = options;
  
  // Check if origin exists
  if (!remoteExists('origin', { cwd })) {
    // If no origin, just skip pushing (useful for local tests)
    return { success: true, finalBranchName: branchName };
  }
  
  let currentBranchName = branchName;
  let retryCount = 0;
  let renamed = false;
  
  while (retryCount < maxRetries) {
    const args = ['push'];
    if (setUpstream) {
      args.push('-u', 'origin', currentBranchName);
    } else {
      args.push('origin', currentBranchName);
    }
    
    const result = runGitResult(args, { cwd });
    
    if (result.success) {
      return { success: true, finalBranchName: currentBranchName, renamed };
    }
    
    // Check if the error is "rejected" (remote has newer commits or branch exists with different history)
    const isRejected = result.stderr.includes('[rejected]') || 
                       result.stderr.includes('fetch first') ||
                       result.stderr.includes('non-fast-forward');
    
    if (!isRejected) {
      // Other error, don't retry
      return { success: false, finalBranchName: currentBranchName, error: result.stderr };
    }
    
    // Generate new branch name with suffix
    retryCount++;
    const timestamp = Date.now();
    const newBranchName = `${branchName}-merged-${timestamp}`;
    
    logger.warn(`⚠️ Push rejected for '${currentBranchName}', renaming to '${newBranchName}'`);
    
    // Rename local branch
    const renameResult = runGitResult(['branch', '-m', currentBranchName, newBranchName], { cwd });
    if (!renameResult.success) {
      return { 
        success: false, 
        finalBranchName: currentBranchName, 
        error: `Failed to rename branch: ${renameResult.stderr}` 
      };
    }
    
    currentBranchName = newBranchName;
    renamed = true;
    
    // Small delay to avoid timestamp collision
    if (retryCount < maxRetries) {
      // Synchronous delay
      const start = Date.now();
      while (Date.now() - start < 100) {
        // busy wait
      }
    }
  }
  
  return { 
    success: false, 
    finalBranchName: currentBranchName, 
    error: `Push failed after ${maxRetries} retries`,
    renamed,
  };
}

/**
 * Auto-commit any uncommitted changes and push to remote
 * Used for checkpoint before destructive operations
 */
export function checkpointAndPush(options: { 
  cwd?: string; 
  message?: string;
  branchName?: string;
} = {}): { success: boolean; committed: boolean; pushed: boolean; error?: string } {
  const { cwd, message = '[cursorflow] checkpoint before clean' } = options;
  
  let committed = false;
  let pushed = false;
  
  // Get current branch if not specified
  let branchName = options.branchName;
  if (!branchName) {
    try {
      branchName = getCurrentBranch(cwd);
    } catch {
      return { success: false, committed: false, pushed: false, error: 'Failed to get current branch' };
    }
  }
  
  // Check for uncommitted changes
  if (hasUncommittedChanges(cwd)) {
    // Stage all changes
    const addResult = runGitResult(['add', '-A'], { cwd });
    if (!addResult.success) {
      return { success: false, committed: false, pushed: false, error: `Failed to stage changes: ${addResult.stderr}` };
    }
    
    // Commit
    const commitResult = runGitResult(['commit', '-m', message], { cwd });
    if (!commitResult.success) {
      return { success: false, committed: false, pushed: false, error: `Failed to commit: ${commitResult.stderr}` };
    }
    committed = true;
  }
  
  // Push to remote
  const pushResult = pushBranchSafe(branchName, { cwd });
  if (pushResult.success) {
    pushed = true;
  } else {
    // Push failed but commit succeeded - partial success
    if (committed) {
      return { success: true, committed: true, pushed: false, error: `Commit succeeded but push failed: ${pushResult.error}` };
    }
    // Nothing to commit and push failed - check if there's anything to push
    const localCommits = runGitResult(['rev-list', `origin/${branchName}..HEAD`], { cwd });
    if (localCommits.success && localCommits.stdout.trim()) {
      return { success: false, committed: false, pushed: false, error: `Push failed: ${pushResult.error}` };
    }
    // Nothing to push
    pushed = true;
  }
  
  return { success: true, committed, pushed };
}

export function syncWithRemote(branch: string, options: { 
  cwd?: string; 
  strategy?: 'merge' | 'rebase';
  createIfMissing?: boolean;
} = {}): { success: boolean; error?: string } {
  const { cwd, strategy = 'merge', createIfMissing = false } = options;
  
  // Fetch the branch
  const fetchResult = runGitResult(['fetch', 'origin', branch], { cwd });
  
  if (!fetchResult.success) {
    if (createIfMissing && fetchResult.stderr.includes('not found')) {
      // Branch doesn't exist on remote, nothing to sync
      return { success: true };
    }
    return { success: false, error: fetchResult.stderr };
  }
  
  // Merge or rebase
  if (strategy === 'rebase') {
    const result = runGitResult(['rebase', `origin/${branch}`], { cwd });
    if (!result.success) {
      // Abort rebase on failure
      runGitResult(['rebase', '--abort'], { cwd });
      return { success: false, error: result.stderr };
    }
  } else {
    const mergeResult = safeMerge(`origin/${branch}`, { 
      cwd, 
      message: `chore: sync with origin/${branch}`,
      abortOnConflict: true,
    });
    
    if (!mergeResult.success) {
      return { success: false, error: mergeResult.error };
    }
  }
  
  return { success: true };
}

/**
 * Check if the repository is a shallow clone
 */
export function isShallowRepository(options: { cwd?: string } = {}): boolean {
  const result = runGitResult(['rev-parse', '--is-shallow-repository'], { cwd: options.cwd });
  return result.success && result.stdout.trim() === 'true';
}

/**
 * Unshallow a shallow clone repository
 * This fetches the full git history which is required for proper worktree and branch operations
 * 
 * @returns true if unshallow was performed, false if already full clone
 */
export function ensureUnshallow(options: { cwd?: string; silent?: boolean } = {}): boolean {
  if (!isShallowRepository(options)) {
    return false;
  }
  
  if (!options.silent) {
    logger.info('🔄 Detected shallow clone, fetching full history for proper worktree support...');
  }
  
  try {
    // Unshallow the repository to get full history
    runGit(['fetch', '--unshallow'], { cwd: options.cwd, silent: options.silent });
    
    if (!options.silent) {
      logger.info('✅ Repository unshallowed successfully');
    }
    
    return true;
  } catch (e: any) {
    // If already unshallowed or remote doesn't support it, try alternative approach
    if (e.message?.includes('unshallow') || e.message?.includes('shallow')) {
      try {
        // Alternative: fetch full history
        runGit(['fetch', '--depth=2147483647'], { cwd: options.cwd, silent: options.silent });
        return true;
      } catch {
        // Ignore, already have enough history
      }
    }
    
    if (!options.silent) {
      logger.warn(`⚠️ Could not unshallow repository: ${e.message}`);
    }
    
    return false;
  }
}
#!/usr/bin/env node
/**
 * Git utilities for CursorFlow
 */

const { execSync, spawnSync } = require('child_process');
const path = require('path');

/**
 * Run git command and return output
 */
function runGit(args, options = {}) {
  const { cwd, silent = false } = options;
  
  try {
    const result = execSync(`git ${args.join(' ')}`, {
      cwd: cwd || process.cwd(),
      encoding: 'utf8',
      stdio: silent ? 'pipe' : 'inherit',
    });
    return result ? result.trim() : '';
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
function runGitResult(args, options = {}) {
  const { cwd } = options;
  
  const result = spawnSync('git', args, {
    cwd: cwd || process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
  });
  
  return {
    exitCode: result.status ?? 1,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    success: result.status === 0,
  };
}

/**
 * Get current branch name
 */
function getCurrentBranch(cwd) {
  return runGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, silent: true });
}

/**
 * Get repository root directory
 */
function getRepoRoot(cwd) {
  return runGit(['rev-parse', '--show-toplevel'], { cwd, silent: true });
}

/**
 * Check if directory is a git repository
 */
function isGitRepo(cwd) {
  const result = runGitResult(['rev-parse', '--git-dir'], { cwd });
  return result.success;
}

/**
 * Check if worktree exists
 */
function worktreeExists(worktreePath, cwd) {
  const result = runGitResult(['worktree', 'list'], { cwd });
  if (!result.success) return false;
  
  return result.stdout.includes(worktreePath);
}

/**
 * Create worktree
 */
function createWorktree(worktreePath, branchName, options = {}) {
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
function removeWorktree(worktreePath, options = {}) {
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
function listWorktrees(cwd) {
  const result = runGitResult(['worktree', 'list', '--porcelain'], { cwd });
  if (!result.success) return [];
  
  const worktrees = [];
  const lines = result.stdout.split('\n');
  let current = {};
  
  for (const line of lines) {
    if (line.startsWith('worktree ')) {
      if (current.path) {
        worktrees.push(current);
      }
      current = { path: line.slice(9) };
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice(7);
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice(5);
    }
  }
  
  if (current.path) {
    worktrees.push(current);
  }
  
  return worktrees;
}

/**
 * Check if there are uncommitted changes
 */
function hasUncommittedChanges(cwd) {
  const result = runGitResult(['status', '--porcelain'], { cwd });
  return result.success && result.stdout.length > 0;
}

/**
 * Get list of changed files
 */
function getChangedFiles(cwd) {
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
function commit(message, options = {}) {
  const { cwd, addAll = true } = options;
  
  if (addAll) {
    runGit(['add', '-A'], { cwd });
  }
  
  runGit(['commit', '-m', message], { cwd });
}

/**
 * Push to remote
 */
function push(branchName, options = {}) {
  const { cwd, force = false, setUpstream = false } = options;
  
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
function fetch(options = {}) {
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
function branchExists(branchName, options = {}) {
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
function deleteBranch(branchName, options = {}) {
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
function merge(branchName, options = {}) {
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
function getCommitInfo(commitHash, options = {}) {
  const { cwd } = options;
  
  const format = '--format=%H%n%h%n%an%n%ae%n%at%n%s';
  const result = runGitResult(['show', '-s', format, commitHash], { cwd });
  
  if (!result.success) return null;
  
  const lines = result.stdout.split('\n');
  return {
    hash: lines[0],
    shortHash: lines[1],
    author: lines[2],
    authorEmail: lines[3],
    timestamp: parseInt(lines[4]),
    subject: lines[5],
  };
}

module.exports = {
  runGit,
  runGitResult,
  getCurrentBranch,
  getRepoRoot,
  isGitRepo,
  worktreeExists,
  createWorktree,
  removeWorktree,
  listWorktrees,
  hasUncommittedChanges,
  getChangedFiles,
  commit,
  push,
  fetch,
  branchExists,
  deleteBranch,
  merge,
  getCommitInfo,
};

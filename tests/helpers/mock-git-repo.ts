/**
 * Mock Git Repository Helper
 * 
 * Creates temporary Git repositories for integration testing.
 * Supports:
 * - Main repository with origin remote (bare repo)
 * - Worktree creation
 * - Conflict scenarios
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';

export interface MockGitRepo {
  /** Main repository directory */
  repoDir: string;
  /** Bare repository (acts as origin remote) */
  bareDir: string;
  /** Temporary root directory */
  tempDir: string;
  /** Cleanup function */
  cleanup(): Promise<void>;
}

export interface CreateMockGitRepoOptions {
  /** Initial branch name (default: 'main') */
  initialBranch?: string;
  /** Create initial files */
  initialFiles?: Record<string, string>;
  /** Create initial commits */
  initialCommits?: number;
}

/**
 * Run git command in a directory
 */
function runGit(args: string[], cwd: string): string {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  
  if (result.error) {
    throw result.error;
  }
  
  if (result.status !== 0) {
    throw new Error(`Git command failed: git ${args.join(' ')}\n${result.stderr}`);
  }
  
  return (result.stdout || '').trim();
}

/**
 * Create a temporary Git repository for testing
 */
export async function createMockGitRepo(options: CreateMockGitRepoOptions = {}): Promise<MockGitRepo> {
  const {
    initialBranch = 'main',
    initialFiles = {
      'README.md': '# Test Project\n\nThis is a test project for CursorFlow testing.',
      'package.json': JSON.stringify({
        name: 'test-project',
        version: '1.0.0',
        description: 'Test project for CursorFlow',
      }, null, 2),
      'src/index.ts': 'export const hello = () => console.log("Hello, World!");',
    },
    initialCommits = 1,
  } = options;

  // Create temporary directory
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursorflow-test-'));
  const repoDir = path.join(tempDir, 'repo');
  const bareDir = path.join(tempDir, 'bare.git');

  try {
    // Create bare repository (acts as origin)
    fs.mkdirSync(bareDir, { recursive: true });
    runGit(['init', '--bare'], bareDir);

    // Create main repository
    fs.mkdirSync(repoDir, { recursive: true });
    runGit(['init'], repoDir);
    runGit(['config', 'user.email', 'test@cursorflow.test'], repoDir);
    runGit(['config', 'user.name', 'CursorFlow Test'], repoDir);
    
    // Set initial branch name
    runGit(['checkout', '-b', initialBranch], repoDir);

    // Create initial files
    for (const [filePath, content] of Object.entries(initialFiles)) {
      const fullPath = path.join(repoDir, filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf8');
    }

    // Create initial commits
    runGit(['add', '-A'], repoDir);
    runGit(['commit', '-m', 'Initial commit'], repoDir);

    for (let i = 1; i < initialCommits; i++) {
      const commitFile = path.join(repoDir, `commit-${i}.txt`);
      fs.writeFileSync(commitFile, `Commit ${i} content`, 'utf8');
      runGit(['add', '-A'], repoDir);
      runGit(['commit', '-m', `Commit ${i}`], repoDir);
    }

    // Add origin remote
    runGit(['remote', 'add', 'origin', bareDir], repoDir);
    runGit(['push', '-u', 'origin', initialBranch], repoDir);

    return {
      repoDir,
      bareDir,
      tempDir,
      cleanup: async () => {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      },
    };
  } catch (error) {
    // Cleanup on error
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
    throw error;
  }
}

/**
 * Create a file in the repository and commit it
 */
export function addFileAndCommit(
  repoDir: string,
  filePath: string,
  content: string,
  message: string
): void {
  const fullPath = path.join(repoDir, filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
  runGit(['add', filePath], repoDir);
  runGit(['commit', '-m', message], repoDir);
}

/**
 * Create a branch from current HEAD
 */
export function createBranch(repoDir: string, branchName: string): void {
  runGit(['checkout', '-b', branchName], repoDir);
}

/**
 * Checkout a branch
 */
export function checkoutBranch(repoDir: string, branchName: string): void {
  runGit(['checkout', branchName], repoDir);
}

/**
 * Create a merge conflict scenario
 */
export function createConflictScenario(
  repoDir: string,
  baseBranch: string,
  conflictBranch: string,
  conflictFile: string
): void {
  // Ensure we're on base branch
  runGit(['checkout', baseBranch], repoDir);

  // Create a file on base branch
  const fullPath = path.join(repoDir, conflictFile);
  fs.writeFileSync(fullPath, 'Base branch content\nLine 2\nLine 3\n', 'utf8');
  runGit(['add', conflictFile], repoDir);
  runGit(['commit', '-m', 'Add file on base branch'], repoDir);

  // Create conflict branch and modify the same file
  runGit(['checkout', '-b', conflictBranch], repoDir);
  fs.writeFileSync(fullPath, 'Conflict branch content\nLine 2\nLine 3\n', 'utf8');
  runGit(['add', conflictFile], repoDir);
  runGit(['commit', '-m', 'Modify file on conflict branch'], repoDir);

  // Go back to base and make conflicting change
  runGit(['checkout', baseBranch], repoDir);
  fs.writeFileSync(fullPath, 'Different base content\nLine 2\nLine 3\n', 'utf8');
  runGit(['add', conflictFile], repoDir);
  runGit(['commit', '-m', 'Modify file on base branch'], repoDir);
}

/**
 * Get current branch name
 */
export function getCurrentBranch(repoDir: string): string {
  return runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoDir);
}

/**
 * Get list of branches
 */
export function getBranches(repoDir: string): string[] {
  return runGit(['branch', '--list'], repoDir)
    .split('\n')
    .map(b => b.trim().replace(/^\*\s*/, ''))
    .filter(b => b.length > 0);
}

/**
 * Check if there are uncommitted changes
 */
export function hasUncommittedChanges(repoDir: string): boolean {
  const status = runGit(['status', '--porcelain'], repoDir);
  return status.length > 0;
}

/**
 * Get the HEAD commit hash
 */
export function getHeadCommit(repoDir: string): string {
  return runGit(['rev-parse', 'HEAD'], repoDir);
}

/**
 * Get commit count
 */
export function getCommitCount(repoDir: string): number {
  const count = runGit(['rev-list', '--count', 'HEAD'], repoDir);
  return parseInt(count, 10);
}


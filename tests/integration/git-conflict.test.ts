/**
 * Git Conflict Handling Integration Tests
 * 
 * Tests how CursorFlow handles Git merge conflicts during orchestration.
 * Verifies proper detection, reporting, and recovery from conflicts.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

describe('Git Conflict Handling', () => {
  let testDir: string;
  let repoDir: string;
  let bareDir: string;

  beforeEach(() => {
    // Create isolated test environment
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursorflow-conflict-'));
    repoDir = path.join(testDir, 'repo');
    bareDir = path.join(testDir, 'origin.git');
    
    fs.mkdirSync(repoDir, { recursive: true });
    
    // Initialize git repo
    execSync('git init', { cwd: repoDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'pipe' });
    
    // Create initial content
    fs.writeFileSync(path.join(repoDir, 'shared.txt'), 'Line 1\nLine 2\nLine 3\n');
    execSync('git add -A', { cwd: repoDir, stdio: 'pipe' });
    execSync('git commit -m "Initial commit"', { cwd: repoDir, stdio: 'pipe' });
    
    // Create bare repo as origin
    fs.mkdirSync(bareDir, { recursive: true });
    execSync('git init --bare', { cwd: bareDir, stdio: 'pipe' });
    execSync(`git remote add origin "${bareDir}"`, { cwd: repoDir, stdio: 'pipe' });
    execSync('git push -u origin HEAD:main', { cwd: repoDir, stdio: 'pipe' });
  });

  afterEach(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  /**
   * Helper to create a branch with conflicting changes
   */
  function createConflictingBranch(branchName: string, lineContent: string) {
    execSync('git checkout main', { cwd: repoDir, stdio: 'pipe' });
    execSync(`git checkout -b ${branchName}`, { cwd: repoDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(repoDir, 'shared.txt'), `Line 1\n${lineContent}\nLine 3\n`);
    execSync('git add -A', { cwd: repoDir, stdio: 'pipe' });
    execSync(`git commit -m "Change from ${branchName}"`, { cwd: repoDir, stdio: 'pipe' });
    execSync('git checkout main', { cwd: repoDir, stdio: 'pipe' });
  }

  /**
   * Helper to check if merge has conflict
   */
  function hasMergeConflict(sourceBranch: string, targetBranch: string = 'main'): boolean {
    try {
      // Create temp branch to test merge
      execSync(`git checkout ${targetBranch}`, { cwd: repoDir, stdio: 'pipe' });
      execSync('git checkout -b temp-conflict-check', { cwd: repoDir, stdio: 'pipe' });
      
      try {
        execSync(`git merge ${sourceBranch} --no-edit`, { cwd: repoDir, stdio: 'pipe' });
        // No conflict - cleanup and return false
        execSync('git checkout main', { cwd: repoDir, stdio: 'pipe' });
        execSync('git branch -D temp-conflict-check', { cwd: repoDir, stdio: 'pipe' });
        return false;
      } catch {
        // Conflict detected - cleanup
        execSync('git merge --abort', { cwd: repoDir, stdio: 'pipe' });
        execSync('git checkout main', { cwd: repoDir, stdio: 'pipe' });
        execSync('git branch -D temp-conflict-check', { cwd: repoDir, stdio: 'pipe' });
        return true;
      }
    } catch {
      return false;
    }
  }

  describe('Conflict Detection', () => {
    test('should detect text file conflict', () => {
      // Create two branches with conflicting changes to the same line
      createConflictingBranch('branch-a', 'Content from A');
      createConflictingBranch('branch-b', 'Content from B');
      
      // Merge branch-a into main first
      execSync('git checkout main', { cwd: repoDir, stdio: 'pipe' });
      execSync('git merge branch-a --no-edit', { cwd: repoDir, stdio: 'pipe' });
      
      // Now branch-b should conflict with main (which has branch-a's changes)
      const hasConflict = hasMergeConflict('branch-b', 'main');
      expect(hasConflict).toBe(true);
    });

    test('should not detect conflict for non-overlapping changes', () => {
      // Create branch that changes a different part of the file
      execSync('git checkout main', { cwd: repoDir, stdio: 'pipe' });
      execSync('git checkout -b branch-different', { cwd: repoDir, stdio: 'pipe' });
      fs.writeFileSync(path.join(repoDir, 'other.txt'), 'New file content');
      execSync('git add -A', { cwd: repoDir, stdio: 'pipe' });
      execSync('git commit -m "Add new file"', { cwd: repoDir, stdio: 'pipe' });
      execSync('git checkout main', { cwd: repoDir, stdio: 'pipe' });
      
      const hasConflict = hasMergeConflict('branch-different');
      expect(hasConflict).toBe(false);
    });
  });

  describe('Git Utility Functions', () => {
    test('runGitResult should return success/failure status', async () => {
      const { runGitResult } = require('../../src/utils/git');
      
      // Test successful command
      const successResult = runGitResult(['status'], { cwd: repoDir });
      expect(successResult.success).toBe(true);
      
      // Test failing command
      const failResult = runGitResult(['checkout', 'nonexistent-branch'], { cwd: repoDir });
      expect(failResult.success).toBe(false);
    });

    test('hasUncommittedChanges should detect uncommitted changes', () => {
      const { hasUncommittedChanges } = require('../../src/utils/git');
      
      // Initially no changes
      expect(hasUncommittedChanges(repoDir)).toBe(false);
      
      // Add uncommitted change
      fs.writeFileSync(path.join(repoDir, 'new-file.txt'), 'content');
      execSync('git add new-file.txt', { cwd: repoDir, stdio: 'pipe' });
      
      expect(hasUncommittedChanges(repoDir)).toBe(true);
      
      // Cleanup
      execSync('git reset HEAD new-file.txt', { cwd: repoDir, stdio: 'pipe' });
      fs.unlinkSync(path.join(repoDir, 'new-file.txt'));
    });

    test('getCurrentBranch should return current branch name', () => {
      const { getCurrentBranch } = require('../../src/utils/git');
      
      const branch = getCurrentBranch(repoDir);
      // Accept either 'main' or 'master' as valid default branch
      expect(['main', 'master']).toContain(branch);
      
      // Create and checkout new branch
      execSync('git checkout -b test-branch', { cwd: repoDir, stdio: 'pipe' });
      expect(getCurrentBranch(repoDir)).toBe('test-branch');
      
      // Cleanup - go back to original branch
      execSync(`git checkout ${branch}`, { cwd: repoDir, stdio: 'pipe' });
      execSync('git branch -D test-branch', { cwd: repoDir, stdio: 'pipe' });
    });
  });

  describe('Worktree Operations', () => {
    test('should create worktree successfully', () => {
      const worktreePath = path.join(testDir, 'worktree-1');
      
      // Create worktree
      execSync(`git worktree add "${worktreePath}" -b worktree-branch`, { cwd: repoDir, stdio: 'pipe' });
      
      // Verify worktree exists
      expect(fs.existsSync(worktreePath)).toBe(true);
      expect(fs.existsSync(path.join(worktreePath, '.git'))).toBe(true);
      
      // Verify worktree is on correct branch
      const branch = execSync('git branch --show-current', { cwd: worktreePath, encoding: 'utf8' }).trim();
      expect(branch).toBe('worktree-branch');
      
      // Cleanup
      execSync(`git worktree remove "${worktreePath}"`, { cwd: repoDir, stdio: 'pipe' });
    });

    test('should handle worktree with existing branch', () => {
      // Create branch first
      execSync('git checkout -b existing-branch', { cwd: repoDir, stdio: 'pipe' });
      execSync('git checkout main', { cwd: repoDir, stdio: 'pipe' });
      
      const worktreePath = path.join(testDir, 'worktree-existing');
      
      // Create worktree on existing branch (no -b flag)
      execSync(`git worktree add "${worktreePath}" existing-branch`, { cwd: repoDir, stdio: 'pipe' });
      
      expect(fs.existsSync(worktreePath)).toBe(true);
      
      // Cleanup
      execSync(`git worktree remove "${worktreePath}"`, { cwd: repoDir, stdio: 'pipe' });
      execSync('git branch -D existing-branch', { cwd: repoDir, stdio: 'pipe' });
    });

    test('changes in worktree should be isolated', () => {
      const worktreePath = path.join(testDir, 'worktree-isolated');
      
      // Create worktree
      execSync(`git worktree add "${worktreePath}" -b isolated-branch`, { cwd: repoDir, stdio: 'pipe' });
      
      // Make changes in worktree
      fs.writeFileSync(path.join(worktreePath, 'worktree-file.txt'), 'worktree content');
      execSync('git add -A', { cwd: worktreePath, stdio: 'pipe' });
      execSync('git commit -m "Worktree commit"', { cwd: worktreePath, stdio: 'pipe' });
      
      // Verify main repo doesn't have the file
      expect(fs.existsSync(path.join(repoDir, 'worktree-file.txt'))).toBe(false);
      
      // Verify worktree has the file
      expect(fs.existsSync(path.join(worktreePath, 'worktree-file.txt'))).toBe(true);
      
      // Cleanup
      execSync(`git worktree remove "${worktreePath}"`, { cwd: repoDir, stdio: 'pipe' });
    });
  });

  describe('Merge Conflict Recovery', () => {
    test('should abort merge on conflict', () => {
      createConflictingBranch('conflict-a', 'Conflict A');
      createConflictingBranch('conflict-b', 'Conflict B');
      
      // Merge first branch
      execSync('git checkout main', { cwd: repoDir, stdio: 'pipe' });
      execSync('git merge conflict-a --no-edit', { cwd: repoDir, stdio: 'pipe' });
      
      // Try to merge second branch (will conflict)
      let conflictOccurred = false;
      try {
        execSync('git merge conflict-b --no-edit', { cwd: repoDir, stdio: 'pipe' });
      } catch {
        conflictOccurred = true;
        // Abort the merge
        execSync('git merge --abort', { cwd: repoDir, stdio: 'pipe' });
      }
      
      expect(conflictOccurred).toBe(true);
      
      // Verify repo is back to clean state
      const status = execSync('git status --porcelain', { cwd: repoDir, encoding: 'utf8' });
      expect(status.trim()).toBe('');
    });

    test('should preserve branch state after abort', () => {
      createConflictingBranch('preserve-a', 'Preserve A');
      createConflictingBranch('preserve-b', 'Preserve B');
      
      // Merge first branch
      execSync('git checkout main', { cwd: repoDir, stdio: 'pipe' });
      execSync('git merge preserve-a --no-edit', { cwd: repoDir, stdio: 'pipe' });
      
      // Store current commit
      const commitBefore = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf8' }).trim();
      
      // Try merge that will conflict
      try {
        execSync('git merge preserve-b --no-edit', { cwd: repoDir, stdio: 'pipe' });
      } catch {
        execSync('git merge --abort', { cwd: repoDir, stdio: 'pipe' });
      }
      
      // Verify we're at the same commit
      const commitAfter = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf8' }).trim();
      expect(commitAfter).toBe(commitBefore);
    });
  });
});


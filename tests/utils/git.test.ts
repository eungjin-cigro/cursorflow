import * as child_process from 'child_process';
import { runGit, runGitResult, pushWithFallbackBranchName } from '../../src/utils/git';

jest.mock('child_process');

describe('Git Utilities', () => {
  const mockedSpawnSync = child_process.spawnSync as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('runGit should return trimmed output', () => {
    mockedSpawnSync.mockReturnValue({
      status: 0,
      stdout: '  main  \n',
      stderr: '',
    });
    
    const result = runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
    expect(result).toBe('main');
    expect(mockedSpawnSync).toHaveBeenCalledWith('git', ['rev-parse', '--abbrev-ref', 'HEAD'], expect.any(Object));
  });

  test('runGitResult should return status and output', () => {
    mockedSpawnSync.mockReturnValue({
      status: 0,
      stdout: 'v1.0.0\n',
      stderr: '',
    });
    
    const result = runGitResult(['tag']);
    expect(result.success).toBe(true);
    expect(result.stdout).toBe('v1.0.0');
    expect(result.exitCode).toBe(0);
  });

  test('runGitResult should handle errors', () => {
    mockedSpawnSync.mockReturnValue({
      status: 128,
      stdout: '',
      stderr: 'fatal: not a git repository',
    });
    
    const result = runGitResult(['status']);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(128);
    expect(result.stderr).toContain('fatal');
  });
});

describe('pushWithFallbackBranchName', () => {
  const mockedSpawnSync = child_process.spawnSync as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should return success with original branch name when push succeeds', () => {
    // Mock: origin exists
    mockedSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: 'origin', stderr: '' }) // remote -v
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' }); // push

    const result = pushWithFallbackBranchName('feature-branch');
    
    expect(result.success).toBe(true);
    expect(result.finalBranchName).toBe('feature-branch');
    expect(result.renamed).toBeFalsy();
  });

  test('should skip push and return success when no origin exists', () => {
    // Mock: no origin
    mockedSpawnSync.mockReturnValueOnce({ 
      status: 1, 
      stdout: '', 
      stderr: 'fatal: No such remote' 
    });

    const result = pushWithFallbackBranchName('feature-branch');
    
    expect(result.success).toBe(true);
    expect(result.finalBranchName).toBe('feature-branch');
    expect(result.renamed).toBeFalsy();
  });

  test('should rename branch and retry when push is rejected', () => {
    // Mock sequence:
    // 1. origin exists
    // 2. first push rejected
    // 3. branch rename success
    // 4. second push success
    mockedSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: 'origin', stderr: '' }) // remote -v
      .mockReturnValueOnce({ 
        status: 1, 
        stdout: '', 
        stderr: '! [rejected] feature-branch -> feature-branch (fetch first)' 
      }) // first push rejected
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' }) // branch -m rename
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' }); // second push success

    const result = pushWithFallbackBranchName('feature-branch');
    
    expect(result.success).toBe(true);
    expect(result.finalBranchName).toMatch(/^feature-branch-merged-\d+$/);
    expect(result.renamed).toBe(true);
  });

  test('should rename branch and retry when push has non-fast-forward error', () => {
    mockedSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: 'origin', stderr: '' }) // remote -v
      .mockReturnValueOnce({ 
        status: 1, 
        stdout: '', 
        stderr: 'error: failed to push some refs (non-fast-forward)' 
      }) // first push rejected
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' }) // branch -m rename
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' }); // second push success

    const result = pushWithFallbackBranchName('01-setup');
    
    expect(result.success).toBe(true);
    expect(result.finalBranchName).toMatch(/^01-setup-merged-\d+$/);
    expect(result.renamed).toBe(true);
  });

  test('should fail immediately on non-rejection errors', () => {
    mockedSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: 'origin', stderr: '' }) // remote -v
      .mockReturnValueOnce({ 
        status: 1, 
        stdout: '', 
        stderr: 'fatal: Authentication failed' 
      }); // push failed with auth error

    const result = pushWithFallbackBranchName('feature-branch');
    
    expect(result.success).toBe(false);
    expect(result.finalBranchName).toBe('feature-branch');
    expect(result.error).toContain('Authentication failed');
    expect(result.renamed).toBeFalsy();
  });

  test('should fail when branch rename fails', () => {
    mockedSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: 'origin', stderr: '' }) // remote -v
      .mockReturnValueOnce({ 
        status: 1, 
        stdout: '', 
        stderr: '! [rejected] branch (fetch first)' 
      }) // push rejected
      .mockReturnValueOnce({ 
        status: 1, 
        stdout: '', 
        stderr: 'error: refname refs/heads/new already exists' 
      }); // branch rename failed

    const result = pushWithFallbackBranchName('feature-branch');
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to rename branch');
  });

  test('should retry up to maxRetries times', () => {
    // All push attempts rejected, all renames succeed
    // Sequence: remote-v, then (push, rename) x 3 times
    mockedSpawnSync
      .mockReturnValueOnce({ status: 0, stdout: 'origin', stderr: '' }) // remote -v
      // Attempt 1 (retryCount: 0 -> 1)
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: '[rejected] (fetch first)' }) // push
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' }) // rename
      // Attempt 2 (retryCount: 1 -> 2)
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: '[rejected] (fetch first)' }) // push
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' }) // rename
      // Attempt 3 (retryCount: 2 -> 3, then loop exits)
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: '[rejected] (fetch first)' }) // push
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' }); // rename

    const result = pushWithFallbackBranchName('feature-branch', { maxRetries: 3 });
    
    expect(result.success).toBe(false);
    expect(result.error).toContain('Push failed after 3 retries');
    expect(result.renamed).toBe(true);
  });
});

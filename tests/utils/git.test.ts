import * as child_process from 'child_process';
import { runGit, runGitResult } from '../../src/utils/git';

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

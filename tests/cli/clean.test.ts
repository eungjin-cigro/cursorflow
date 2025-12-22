import * as fs from 'fs';
import * as path from 'path';
import clean = require('../../src/cli/clean');
import { RunService } from '../../src/utils/run-service';
import * as git from '../../src/utils/git';
import * as config from '../../src/utils/config';
import * as logger from '../../src/utils/logger';

jest.mock('../../src/utils/run-service');
jest.mock('../../src/utils/git');
jest.mock('../../src/utils/config');
jest.mock('../../src/utils/logger');

describe('CLI clean command extensions', () => {
  const mockedRunService = RunService as jest.MockedClass<typeof RunService>;
  const mockedGit = git as jest.Mocked<typeof git>;
  const mockedLoadConfig = config.loadConfig as jest.Mock;
  const mockedGetLogsDir = config.getLogsDir as jest.Mock;
  
  const projectRoot = '/mock/root';

  beforeEach(() => {
    jest.clearAllMocks();
    mockedLoadConfig.mockReturnValue({
      projectRoot,
      tasksDir: '_cursorflow/tasks',
      logsDir: '_cursorflow/logs',
      branchPrefix: 'feature/',
      worktreeRoot: '_cursorflow/worktrees'
    });
    mockedGetLogsDir.mockReturnValue('/mock/logs');
    mockedGit.getRepoRoot.mockReturnValue(projectRoot);
  });

  test('cleans specific run resources with --run', async () => {
    const mockRun = {
      id: 'run-to-clean',
      taskName: 'Clean Me',
      path: '/mock/logs/run-to-clean',
      branches: ['feature/test-branch'],
      worktrees: ['/mock/worktrees/test-wt']
    };
    mockedRunService.prototype.getRunInfo.mockReturnValue(mockRun as any);

    await clean(['--run', 'run-to-clean']);

    expect(mockedGit.deleteBranch).toHaveBeenCalledWith('feature/test-branch', expect.any(Object));
    expect(mockedGit.removeWorktree).toHaveBeenCalledWith('/mock/worktrees/test-wt', expect.any(Object));
    expect(mockedRunService.prototype.deleteRun).toHaveBeenCalledWith('run-to-clean', expect.any(Object));
  });

  test('cleans older runs with --older-than', async () => {
    const now = Date.now();
    const mockRuns = [
      { id: 'new-run', startTime: now, branches: [], worktrees: [], path: '/p1' },
      { id: 'old-run', startTime: now - (10 * 24 * 60 * 60 * 1000), branches: ['old-b'], worktrees: ['/old-w'], path: '/p2' }
    ];
    mockedRunService.prototype.listRuns.mockReturnValue(mockRuns as any);
    mockedRunService.prototype.getRunInfo.mockImplementation(id => mockRuns.find(r => r.id === id) as any);

    await clean(['--older-than', '5']); // older than 5 days

    expect(mockedRunService.prototype.deleteRun).toHaveBeenCalledWith('old-run', expect.any(Object));
    expect(mockedRunService.prototype.deleteRun).not.toHaveBeenCalledWith('new-run', expect.any(Object));
  });

  test('cleans orphaned resources with --orphaned', async () => {
    const worktreeRoot = path.join(projectRoot, '_cursorflow/worktrees');
    const activeWt = path.join(worktreeRoot, 'active');
    const orphanedWt = path.join(worktreeRoot, 'orphaned');

    mockedRunService.prototype.listRuns.mockReturnValue([
      { id: 'active', branches: ['feature/active'], worktrees: [activeWt] }
    ] as any);

    mockedGit.listWorktrees.mockReturnValue([
      { path: projectRoot }, // repo root
      { path: activeWt },
      { path: orphanedWt }
    ]);

    mockedGit.runGitResult.mockReturnValue({
      success: true,
      stdout: '* main\n  feature/active\n  feature/orphaned'
    } as any);

    await clean(['--orphaned']);

    expect(mockedGit.removeWorktree).toHaveBeenCalledWith(orphanedWt, expect.any(Object));
    expect(mockedGit.deleteBranch).toHaveBeenCalledWith('feature/orphaned', expect.any(Object));
    expect(mockedGit.deleteBranch).not.toHaveBeenCalledWith('feature/active', expect.any(Object));
  });
});

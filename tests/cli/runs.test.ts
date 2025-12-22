import * as fs from 'fs';
import * as path from 'path';
import runs = require('../../src/cli/runs');
import { RunService } from '../../src/utils/run-service';
import * as config from '../../src/utils/config';
import * as logger from '../../src/utils/logger';

jest.mock('../../src/utils/run-service');
jest.mock('../../src/utils/config');
jest.mock('../../src/utils/logger');

describe('CLI runs command', () => {
  const mockedRunService = RunService as jest.MockedClass<typeof RunService>;
  const mockedLoadConfig = config.loadConfig as jest.Mock;
  const mockedGetLogsDir = config.getLogsDir as jest.Mock;
  
  const tmpRoot = path.join(__dirname, 'tmp-runs');
  const logsDir = path.join(tmpRoot, '_cursorflow', 'logs');
  const runsDir = path.join(logsDir, 'runs');

  beforeEach(() => {
    jest.clearAllMocks();
    
    if (!fs.existsSync(runsDir)) {
      fs.mkdirSync(runsDir, { recursive: true });
    }

    mockedLoadConfig.mockReturnValue({ projectRoot: tmpRoot });
    mockedGetLogsDir.mockReturnValue(logsDir);
    
    // Default implementation for RunService
    mockedRunService.prototype.listRuns.mockReturnValue([]);
    mockedRunService.prototype.getRunInfo.mockReturnValue(null);
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('prints message when no runs found', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    await runs([]);
    expect(consoleSpy).toHaveBeenCalledWith('No runs found.');
    consoleSpy.mockRestore();
  });

  test('lists runs in table format', async () => {
    const mockRuns = [
      {
        id: 'run-1',
        taskName: 'Task 1',
        status: 'completed',
        startTime: Date.now() - 10000,
        duration: 5000,
        lanes: [{ status: 'completed' }, { status: 'completed' }],
        branches: [],
        worktrees: [],
        path: '/path/1'
      }
    ];
    mockedRunService.prototype.listRuns.mockReturnValue(mockRuns as any);
    
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    await runs([]);
    
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Run ID'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('run-1'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Task 1'));
    consoleSpy.mockRestore();
  });

  test('shows run detail when runId is provided', async () => {
    const mockRun = {
      id: 'run-123',
      taskName: 'Detail Task',
      status: 'running',
      startTime: Date.now(),
      duration: 100,
      path: '/path/run-123',
      lanes: [
        { name: 'lane-1', status: 'running', currentTask: 1, totalTasks: 2, pid: 1234 }
      ],
      branches: ['feat/lane-1'],
      worktrees: ['/wt/lane-1']
    };
    mockedRunService.prototype.getRunInfo.mockReturnValue(mockRun as any);
    
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    await runs(['run-123']);
    
    expect(mockedRunService.prototype.getRunInfo).toHaveBeenCalledWith('run-123');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Detail Task'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('lane-1'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('1234'));
    consoleSpy.mockRestore();
  });

  test('outputs JSON when --json is provided', async () => {
    const mockRuns = [{ id: 'run-json', taskName: 'JSON Task', status: 'pending' }];
    mockedRunService.prototype.listRuns.mockReturnValue(mockRuns as any);
    
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    await runs(['--json']);
    
    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output[0].id).toBe('run-json');
    consoleSpy.mockRestore();
  });
});

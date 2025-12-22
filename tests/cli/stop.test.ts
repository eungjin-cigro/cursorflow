import * as readline from 'readline';
import stop = require('../../src/cli/stop');
import { RunService } from '../../src/utils/run-service';
import { ProcessManager } from '../../src/utils/process-manager';
import * as config from '../../src/utils/config';
import * as logger from '../../src/utils/logger';

jest.mock('../../src/utils/run-service');
jest.mock('../../src/utils/process-manager');
jest.mock('../../src/utils/config');
jest.mock('../../src/utils/logger');
jest.mock('readline');

describe('CLI stop command', () => {
  const mockedRunService = RunService as jest.MockedClass<typeof RunService>;
  const mockedProcessManager = ProcessManager as jest.Mocked<typeof ProcessManager>;
  const mockedLoadConfig = config.loadConfig as jest.Mock;
  const mockedGetLogsDir = config.getLogsDir as jest.Mock;
  const mockedReadline = readline as jest.Mocked<typeof readline>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedLoadConfig.mockReturnValue({ projectRoot: '/mock' });
    mockedGetLogsDir.mockReturnValue('/mock/logs');
    
    // Default confirmation to yes
    mockedReadline.createInterface.mockReturnValue({
      question: jest.fn().mockImplementation((_query, cb) => cb('y')),
      close: jest.fn(),
    } as any);
  });

  test('stops all runs when no args provided', async () => {
    const mockActiveRuns = [
      {
        id: 'run-1',
        taskName: 'Task 1',
        lanes: [{ name: 'lane-1', pid: 123 }]
      }
    ];
    mockedRunService.prototype.getActiveRuns.mockReturnValue(mockActiveRuns as any);
    mockedProcessManager.killProcess.mockReturnValue(true);

    await stop(['--yes']); // Use --yes to skip confirmation

    expect(mockedRunService.prototype.getActiveRuns).toHaveBeenCalled();
    expect(mockedProcessManager.killProcess).toHaveBeenCalledWith(123, 'SIGTERM');
    expect(logger.success).toHaveBeenCalledWith(expect.stringContaining('All workflows stopped'));
  });

  test('stops specific run by ID', async () => {
    const mockRun = {
      id: 'run-123',
      taskName: 'Target Task',
      status: 'running',
      lanes: [{ name: 'lane-a', pid: 456 }]
    };
    mockedRunService.prototype.getRunInfo.mockReturnValue(mockRun as any);
    mockedProcessManager.killProcess.mockReturnValue(true);

    await stop(['run-123', '--yes']);

    expect(mockedRunService.prototype.getRunInfo).toHaveBeenCalledWith('run-123');
    expect(mockedProcessManager.killProcess).toHaveBeenCalledWith(456, 'SIGTERM');
  });

  test('stops specific lane in run', async () => {
    const mockRun = {
      id: 'run-456',
      lanes: [
        { name: 'target-lane', pid: 789 },
        { name: 'other-lane', pid: 101 }
      ]
    };
    mockedRunService.prototype.getRunInfo.mockReturnValue(mockRun as any);
    mockedProcessManager.killProcess.mockReturnValue(true);

    await stop(['run-456', '--lane', 'target-lane', '--yes']);

    expect(mockedProcessManager.killProcess).toHaveBeenCalledWith(789, 'SIGTERM');
    expect(mockedProcessManager.killProcess).not.toHaveBeenCalledWith(101, 'SIGTERM');
  });

  test('uses SIGKILL when --force is provided', async () => {
    const mockRun = {
      id: 'run-kill',
      status: 'running',
      lanes: [{ name: 'lane-1', pid: 999 }]
    };
    mockedRunService.prototype.getRunInfo.mockReturnValue(mockRun as any);
    
    await stop(['run-kill', '--force', '--yes']);

    expect(mockedProcessManager.killProcess).toHaveBeenCalledWith(999, 'SIGKILL');
  });
});

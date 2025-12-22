import { TaskService } from '../../src/utils/task-service';
import * as config from '../../src/utils/config';
import * as logger from '../../src/utils/logger';
import tasks = require('../../src/cli/tasks');

jest.mock('../../src/utils/task-service');
jest.mock('../../src/utils/config');
jest.mock('../../src/utils/logger', () => ({
  ...jest.requireActual('../../src/utils/logger'),
  info: jest.fn(),
  error: jest.fn(),
  createSpinner: jest.fn().mockReturnValue({
    start: jest.fn(),
    succeed: jest.fn(),
    fail: jest.fn(),
  }),
}));

describe('CLI tasks command', () => {
  let consoleLogSpy: jest.SpyInstance;
  const mockedTaskService = TaskService as jest.MockedClass<typeof TaskService>;
  const mockedFindProjectRoot = config.findProjectRoot as jest.Mock;
  const mockedLoadConfig = config.loadConfig as jest.Mock;
  const mockedGetTasksDir = config.getTasksDir as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    
    mockedFindProjectRoot.mockReturnValue('/root');
    mockedLoadConfig.mockReturnValue({ projectRoot: '/root' });
    mockedGetTasksDir.mockReturnValue('/root/_cursorflow/tasks');

    // Default mock implementation for TaskService
    mockedTaskService.prototype.listTaskDirs.mockReturnValue([]);
    mockedTaskService.prototype.getTaskDirInfo.mockReturnValue(null);
    mockedTaskService.prototype.validateTaskDir.mockReturnValue({
      ok: true,
      issues: [],
      context: { cwd: '/root' }
    } as any);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  test('prints message when no tasks found', async () => {
    await tasks([]);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('No tasks found'));
  });

  test('lists tasks correctly', async () => {
    const mockTasks = [
      {
        name: '2412221530_AuthSystem',
        timestamp: new Date('2024-12-22T15:30:00'),
        lanes: [{}, {}, {}],
        validationStatus: 'valid',
      }
    ];
    mockedTaskService.prototype.listTaskDirs.mockReturnValue(mockTasks as any);

    await tasks([]);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Prepared Tasks:'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('2412221530_AuthSystem'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('3 lanes'));
    
  });

  test('runs validation with --validate flag', async () => {
    const mockTasks = [
      { name: 'task1', timestamp: new Date(), lanes: [], validationStatus: 'unknown' }
    ];
    mockedTaskService.prototype.listTaskDirs.mockReturnValue(mockTasks as any);
    
    await tasks(['--validate']);

    expect(logger.createSpinner).toHaveBeenCalled();
    expect(mockedTaskService.prototype.validateTaskDir).toHaveBeenCalledWith('task1');
  });

  test('shows task details', async () => {
    const mockTaskDetail = {
      name: '2412221530_AuthSystem',
      lanes: [
        {
          fileName: '01-lane-1.json',
          preset: 'complex',
          taskFlow: 'plan → implement → test',
          dependsOn: []
        },
        {
          fileName: '02-lane-2.json',
          preset: 'simple',
          taskFlow: 'implement → test',
          dependsOn: ['01-lane-1']
        }
      ],
      validationReport: {
        issues: []
      }
    };
    mockedTaskService.prototype.getTaskDirInfo.mockReturnValue(mockTaskDetail as any);

    await tasks(['2412221530_AuthSystem']);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Task: 2412221530_AuthSystem'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('01-lane-1.json'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('[complex]'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('plan → implement → test'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('(depends: 01-lane-1)'));
  });

  test.skip('shows validation issues in detail view', async () => {
    const mockTaskDetail = {
      name: 'task-with-error',
      lanes: [],
      validationReport: {
        issues: [
          {
            severity: 'error',
            title: 'Missing File',
            message: 'Some file is missing'
          }
        ]
      }
    };
    mockedTaskService.prototype.getTaskDirInfo.mockReturnValue(mockTaskDetail as any);

    await tasks(['task-with-error']);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Validation Issues:'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('❌ Missing File'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Some file is missing'));
  });

  test('fails when task not found', async () => {
    const processExitSpy = jest.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as any);
    mockedTaskService.prototype.getTaskDirInfo.mockReturnValue(null);

    await expect(tasks(['non-existent'])).rejects.toThrow('process.exit called');

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Task not found'));
    expect(processExitSpy).toHaveBeenCalledWith(1);
    processExitSpy.mockRestore();
  });
});

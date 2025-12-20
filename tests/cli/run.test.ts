import * as fs from 'fs';
import * as path from 'path';

import run = require('../../src/cli/run');
import * as orchestrator from '../../src/core/orchestrator';
import * as doctor from '../../src/utils/doctor';
import * as config from '../../src/utils/config';

jest.mock('../../src/core/orchestrator');
jest.mock('../../src/utils/doctor');
jest.mock('../../src/utils/config');

describe('CLI run preflight', () => {
  const mockedOrchestrate = orchestrator.orchestrate as unknown as jest.Mock;
  const mockedRunDoctor = doctor.runDoctor as unknown as jest.Mock;
  const mockedLoadConfig = config.loadConfig as unknown as jest.Mock;
  const mockedGetLogsDir = config.getLogsDir as unknown as jest.Mock;
  const mockedFindProjectRoot = config.findProjectRoot as unknown as jest.Mock;

  const tmpRoot = path.join(__dirname, 'tmp-run');

  beforeEach(() => {
    jest.clearAllMocks();

    if (!fs.existsSync(tmpRoot)) {
      fs.mkdirSync(tmpRoot, { recursive: true });
    }

    mockedFindProjectRoot.mockReturnValue(tmpRoot);
    mockedLoadConfig.mockReturnValue({
      executor: 'cursor-agent',
      pollInterval: 60,
      projectRoot: tmpRoot,
    });
    mockedGetLogsDir.mockReturnValue(path.join(tmpRoot, '_cursorflow', 'logs'));
    mockedOrchestrate.mockResolvedValue({ lanes: [], exitCodes: {}, runRoot: 'x' });
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('fails fast when doctor preflight fails', async () => {
    const tasksDir = path.join(tmpRoot, '_cursorflow', 'tasks', 'demo');
    fs.mkdirSync(tasksDir, { recursive: true });

    mockedRunDoctor.mockReturnValue({
      ok: false,
      issues: [
        {
          id: 'git.no_origin',
          severity: 'error',
          title: 'Missing origin',
          message: 'origin missing',
          fixes: ['git remote add origin ...'],
        },
      ],
      context: { cwd: tmpRoot, tasksDir },
    });

    await expect(run([tasksDir])).rejects.toThrow('Pre-flight checks failed');
    expect(mockedOrchestrate).not.toHaveBeenCalled();
  });

  test('can skip doctor with --skip-doctor', async () => {
    const tasksDir = path.join(tmpRoot, '_cursorflow', 'tasks', 'demo2');
    fs.mkdirSync(tasksDir, { recursive: true });

    mockedRunDoctor.mockImplementation(() => {
      throw new Error('doctor should not be called');
    });

    await expect(run([tasksDir, '--skip-doctor'])).resolves.toBeUndefined();
    expect(mockedOrchestrate).toHaveBeenCalledTimes(1);
  });
});



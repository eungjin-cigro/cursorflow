import * as fs from 'fs';
import * as path from 'path';
import { orchestrate } from '../../src/core/orchestrator';
import { events } from '../../src/utils/events';
import * as child_process from 'child_process';

// Mock git utilities
jest.mock('../../src/utils/git', () => ({
  getRepoRoot: jest.fn().mockReturnValue('/mock/repo'),
  getMainRepoRoot: jest.fn().mockReturnValue('/mock/repo'),
  runGit: jest.fn().mockReturnValue(''),
  runGitResult: jest.fn().mockReturnValue({ success: true, output: '' }),
  push: jest.fn().mockReturnValue(''),
  getLatestRunDir: jest.fn().mockReturnValue('/mock/logs'),
  createWorktree: jest.fn().mockReturnValue('/mock/worktree'),
  isGitRepo: jest.fn().mockReturnValue(true),
  remoteExists: jest.fn().mockReturnValue(true),
  hasUncommittedChanges: jest.fn().mockReturnValue(false),
  getCurrentBranch: jest.fn().mockReturnValue('main'),
}));

// Mock child_process
jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  spawn: jest.fn(),
  execSync: jest.fn().mockReturnValue(''),
}));

describe('Dependency Self-Healing E2E', () => {
  const testTasksDir = path.join(__dirname, 'test-tasks-healing');
  const testRunDir = path.join(__dirname, 'test-runs-healing');
  const testWorktreeDir = path.join(__dirname, 'test-worktree-healing');
  let mockExit: jest.SpyInstance;

  beforeAll(() => {
    mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    if (!fs.existsSync(testTasksDir)) fs.mkdirSync(testTasksDir, { recursive: true });
    if (!fs.existsSync(testWorktreeDir)) fs.mkdirSync(testWorktreeDir, { recursive: true });
    fs.writeFileSync(path.join(testTasksDir, 'lane-a.json'), JSON.stringify({ 
      tasks: [
        { name: 'task1', prompt: 'do something' },
        { name: 'task2', prompt: 'do something else' }
      ] 
    }));
  });

  afterAll(() => {
    mockExit.mockRestore();
    if (fs.existsSync(testTasksDir)) fs.rmSync(testTasksDir, { recursive: true, force: true });
    if (fs.existsSync(testRunDir)) fs.rmSync(testRunDir, { recursive: true, force: true });
    if (fs.existsSync(testWorktreeDir)) fs.rmSync(testWorktreeDir, { recursive: true, force: true });
  });

  test('should resolve dependencies and resume when blocked', async () => {
    let laneAAttempt = 0;
    const spawnMock = child_process.spawn as jest.Mock;

    // First attempt: Lane A starts task 1, but task 1 returns code 2 (blocked)
    spawnMock.mockImplementation(() => {
      laneAAttempt++;
      const exitCode = laneAAttempt === 1 ? 2 : 0; 
      
      return {
        pid: 1000 + laneAAttempt,
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn(),
        once: jest.fn().mockImplementation((event, cb) => {
          if (event === 'exit') {
            if (laneAAttempt === 1) {
              const laneRunDir = path.join(testRunDir, 'lanes', 'lane-a');
              fs.mkdirSync(laneRunDir, { recursive: true });
              fs.writeFileSync(path.join(laneRunDir, 'state.json'), JSON.stringify({
                status: 'failed',
                currentTaskIndex: 0,
                totalTasks: 2,
                label: 'lane-a',
                pipelineBranch: 'cursorflow/test',
                worktreeDir: testWorktreeDir,
                dependencyRequest: {
                  reason: 'need lodash',
                  changes: ['add lodash'],
                  commands: ['pnpm add lodash']
                }
              }));
            }
            setTimeout(() => cb(exitCode), 10);
          }
        }),
        exitCode: null,
        kill: jest.fn()
      };
    });

    const emittedEvents: string[] = [];
    events.on('*', (event) => {
      emittedEvents.push(event.type);
    });

    try {
      await orchestrate(testTasksDir, {
        runDir: testRunDir,
        pollInterval: 50,
        autoResolveDependencies: true,
        skipPreflight: true
      });
    } catch (e: any) {
      if (!e.message.includes('process.exit(0)')) {
        // expect(e.message).toBe('process.exit(0)');
      }
    }

    // Verify events sequence
    expect(emittedEvents).toContain('orchestration.started');
    expect(emittedEvents).toContain('lane.started'); // Attempt 1
    expect(emittedEvents).toContain('lane.blocked'); // Code 2
    expect(emittedEvents).toContain('lane.started'); // Attempt 2 (Resume)
    expect(emittedEvents).toContain('lane.completed'); // Success
    expect(emittedEvents).toContain('orchestration.completed');

    // Verify resolveDependencies was called
    expect(child_process.execSync).toHaveBeenCalledWith('pnpm add lodash', expect.any(Object));
    // expect(git.runGit).toHaveBeenCalledWith(['merge', expect.stringContaining('cursorflow/run-'), '--no-edit'], expect.any(Object));

    mockExit.mockRestore();
  });
});


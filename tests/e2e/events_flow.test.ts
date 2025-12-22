import * as fs from 'fs';
import * as path from 'path';
import { orchestrate } from '../../src/core/orchestrator';
import { events } from '../../src/utils/events';

// Mock process.exit
const mockExit = jest.spyOn(process, 'exit').mockImplementation((code) => {
  throw new Error(`process.exit(${code})`);
});

// Mock child_process.spawn
jest.mock('child_process', () => ({
  ...jest.requireActual('child_process'),
  spawn: jest.fn().mockImplementation(() => {
    const mockChild = {
      pid: 1234,
      stdout: { on: jest.fn() },
      stderr: { on: jest.fn() },
      on: jest.fn(),
      once: jest.fn().mockImplementation((event, cb) => {
        if (event === 'exit') {
          // Simulate exit after a short delay
          setTimeout(() => cb(0), 10);
        }
      }),
      exitCode: null,
      kill: jest.fn()
    };
    return mockChild;
  })
}));

describe('E2E Event Flow', () => {
  const testTasksDir = path.join(__dirname, 'test-tasks-e2e');
  const testRunDir = path.join(__dirname, 'test-runs-e2e');

  beforeAll(() => {
    if (!fs.existsSync(testTasksDir)) {
      fs.mkdirSync(testTasksDir, { recursive: true });
    }
    fs.writeFileSync(path.join(testTasksDir, 'lane-a.json'), JSON.stringify({ tasks: [{ name: 'task1', prompt: 'hi' }] }));
  });

  afterAll(() => {
    mockExit.mockRestore();
    if (fs.existsSync(testTasksDir)) fs.rmSync(testTasksDir, { recursive: true, force: true });
    if (fs.existsSync(testRunDir)) fs.rmSync(testRunDir, { recursive: true, force: true });
  });

  test('orchestrate should emit full lifecycle of events', async () => {
    const emittedEvents: string[] = [];
    events.on('*', (event) => {
      emittedEvents.push(event.type);
    });

    try {
      await orchestrate(testTasksDir, {
        runDir: testRunDir,
        pollInterval: 50,
        skipPreflight: true,
      });
    } catch (e: any) {
      if (!e.message.includes('process.exit(0)')) {
        throw e;
      }
    }

    // Verify events
    expect(emittedEvents).toContain('orchestration.started');
    expect(emittedEvents).toContain('lane.started');
    expect(emittedEvents).toContain('lane.completed');
    expect(emittedEvents).toContain('orchestration.completed');
    
    // Check order
    const startIdx = emittedEvents.indexOf('orchestration.started');
    const laneStartIdx = emittedEvents.indexOf('lane.started');
    const laneCompIdx = emittedEvents.indexOf('lane.completed');
    const endIdx = emittedEvents.indexOf('orchestration.completed');

    expect(startIdx).toBeLessThan(laneStartIdx);
    expect(laneStartIdx).toBeLessThan(laneCompIdx);
    expect(laneCompIdx).toBeLessThan(endIdx);
  });
});

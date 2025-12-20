import * as fs from 'fs';
import * as path from 'path';
import { saveState, loadState, createLaneState, updateLaneState } from '../../src/utils/state';
import { RunnerConfig } from '../../src/utils/types';

describe('State Utilities', () => {
  const testDir = path.join(__dirname, 'test-state');
  const statePath = path.join(testDir, 'state.json');

  const mockRunnerConfig: RunnerConfig = {
    tasks: [{}, {}, {}] as any,
    dependencyPolicy: {
      allowDependencyChange: false,
      lockfileReadOnly: true
    }
  };

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  test('saveState and loadState should work together', () => {
    const state = { foo: 'bar', count: 42 };
    saveState(statePath, state);
    
    const loaded = loadState(statePath);
    expect(loaded).toEqual(state);
  });

  test('loadState should return null for non-existent file', () => {
    const loaded = loadState(path.join(testDir, 'non-existent.json'));
    expect(loaded).toBeNull();
  });

  test('createLaneState should create correct initial state', () => {
    const state = createLaneState('test-lane', mockRunnerConfig);
    
    expect(state.label).toBe('test-lane');
    expect(state.status).toBe('pending');
    expect(state.totalTasks).toBe(3);
    expect(state.currentTaskIndex).toBe(0);
  });

  test('updateLaneState should merge updates and set updatedAt', () => {
    const state = createLaneState('test-lane', { ...mockRunnerConfig, tasks: [] });
    const now = Date.now();
    
    const updated = updateLaneState(state, { status: 'running', currentTaskIndex: 1 });
    
    expect(updated.status).toBe('running');
    expect(updated.currentTaskIndex).toBe(1);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(now);
    expect(updated.label).toBe('test-lane'); // Original property preserved
  });
});

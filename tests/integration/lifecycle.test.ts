/**
 * Lane Lifecycle Integration Tests
 * 
 * Tests the complete lane lifecycle using Mock cursor-agent and real Git.
 * Covers:
 * - Normal start to completion
 * - State transitions
 * - Resume after interruption
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  setupTestEnvironment,
  TestHarness,
  readState,
  readJsonlLog,
  sleep,
  SCENARIOS,
} from '../helpers';

// Note: These are integration tests that require:
// 1. Mock cursor-agent in PATH
// 2. Temporary Git repository
// 3. Longer timeout

describe('Lane Lifecycle', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await setupTestEnvironment({
      gitOptions: {
        initialBranch: 'main',
        initialFiles: {
          'README.md': '# Test Project',
          'src/index.ts': 'console.log("Hello");',
        },
      },
    });
  }, 30000);

  afterAll(async () => {
    await harness.cleanup();
  });

  describe('State Management', () => {
    test('should create initial state correctly', () => {
      // Create a lane state directly
      const { createLaneState } = require('../../src/utils/state');
      
      const config = {
        tasks: [
          { name: 'task1', prompt: 'Do task 1' },
          { name: 'task2', prompt: 'Do task 2' },
        ],
        dependencyPolicy: {
          allowDependencyChange: false,
          lockfileReadOnly: true,
        },
      };

      const state = createLaneState('test-lane', config);

      expect(state.label).toBe('test-lane');
      expect(state.status).toBe('pending');
      expect(state.totalTasks).toBe(2);
      expect(state.currentTaskIndex).toBe(0);
    });

    test('should update state transitions', () => {
      const { createLaneState, updateLaneState } = require('../../src/utils/state');
      
      const config = { tasks: [{ name: 'task1', prompt: 'Do it' }] };
      let state = createLaneState('test-lane', config);

      // Transition to running
      state = updateLaneState(state, { status: 'running' });
      expect(state.status).toBe('running');
      expect(state.updatedAt).toBeDefined();

      // Transition to completed
      state = updateLaneState(state, { 
        status: 'completed',
        currentTaskIndex: 1,
        endTime: Date.now(),
      });
      expect(state.status).toBe('completed');
      expect(state.currentTaskIndex).toBe(1);
      expect(state.endTime).toBeDefined();
    });

    test('should save and load state atomically', () => {
      const { saveState, loadState } = require('../../src/utils/state');
      const statePath = path.join(harness.tempDir, 'test-state.json');

      const state = {
        label: 'atomic-test',
        status: 'running',
        currentTaskIndex: 1,
        totalTasks: 3,
        startTime: Date.now(),
      };

      saveState(statePath, state);
      const loaded = loadState(statePath);

      expect(loaded).toEqual(state);

      // Verify no temp files left behind
      const files = fs.readdirSync(harness.tempDir);
      const tempFiles = files.filter(f => f.includes('.tmp.'));
      expect(tempFiles).toHaveLength(0);
    });
  });

  describe('State Validation', () => {
    test('should detect invalid state', () => {
      const { saveState, validateLaneState } = require('../../src/utils/state');
      const statePath = path.join(harness.tempDir, 'invalid-state.json');

      // Create invalid state (missing required fields)
      const invalidState = {
        label: 'invalid',
        // Missing status, currentTaskIndex, totalTasks
      };

      fs.writeFileSync(statePath, JSON.stringify(invalidState), 'utf8');

      const result = validateLaneState(statePath);
      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    test('should repair corrupted state', () => {
      const { repairLaneState, validateLaneState } = require('../../src/utils/state');
      const statePath = path.join(harness.tempDir, 'corrupt-state.json');

      // Create corrupted state with missing required fields
      const corruptState = {
        label: 'corrupt',
        // Missing: status, currentTaskIndex, totalTasks
      };

      fs.writeFileSync(statePath, JSON.stringify(corruptState), 'utf8');

      // First, validate should report issues
      const validation = validateLaneState(statePath);
      expect(validation.valid).toBe(false);
      expect(validation.issues.length).toBeGreaterThan(0);

      // Then repair should create a valid state
      const repaired = repairLaneState(statePath);
      
      expect(repaired).not.toBeNull();
      // After repair, should have all required fields
      expect(repaired!.label).toBe('corrupt');
      expect(repaired!.status).toBeDefined();
      expect(repaired!.currentTaskIndex).toBeDefined();
      expect(repaired!.totalTasks).toBeDefined();
    });
  });

  describe('Mock Agent Verification', () => {
    test('mock cursor-agent should be in PATH', () => {
      const { execSync } = require('child_process');
      
      const result = execSync('which cursor-agent', {
        encoding: 'utf8',
        env: harness.getEnv(),
      }).trim();

      expect(result).toContain('mock-cursor-agent');
    });

    test('mock cursor-agent create-chat should return chat ID', () => {
      const { execSync } = require('child_process');
      
      const chatId = execSync('cursor-agent create-chat', {
        encoding: 'utf8',
        env: harness.getEnv(),
      }).trim();

      expect(chatId).toMatch(/^mock-chat-\d+-[a-z0-9]+$/);
    });

    test('mock cursor-agent should respond based on scenario', () => {
      const { execSync } = require('child_process');
      
      harness.setScenario(SCENARIOS.SUCCESS);

      const result = execSync('echo "test prompt" | cursor-agent --resume test-chat-id', {
        encoding: 'utf8',
        env: harness.getEnv(),
      });

      // Should contain JSON result
      expect(result).toContain('"type":"result"');
      expect(result).toContain('"is_error":false');
    });

    test('mock cursor-agent failure scenario should return error', () => {
      const { spawnSync } = require('child_process');
      
      harness.setScenario(SCENARIOS.FAILURE);

      const result = spawnSync('cursor-agent', ['--resume', 'test-chat-id'], {
        encoding: 'utf8',
        input: 'test prompt',
        env: harness.getEnv(),
      });

      expect(result.status).toBe(1);
      expect(result.stdout).toContain('"is_error":true');
    });
  });

  describe('Git Repository Verification', () => {
    test('should have valid Git repository', () => {
      const { execSync } = require('child_process');
      
      const result = execSync('git status', {
        cwd: harness.gitRepo.repoDir,
        encoding: 'utf8',
      });

      expect(result).toContain('On branch main');
    });

    test('should have origin remote', () => {
      const { execSync } = require('child_process');
      
      const result = execSync('git remote -v', {
        cwd: harness.gitRepo.repoDir,
        encoding: 'utf8',
      });

      expect(result).toContain('origin');
      expect(result).toContain(harness.gitRepo.bareDir);
    });

    test('should be able to create branches', () => {
      const { execSync } = require('child_process');
      
      execSync('git checkout -b test-branch', {
        cwd: harness.gitRepo.repoDir,
        encoding: 'utf8',
      });

      const result = execSync('git branch --list', {
        cwd: harness.gitRepo.repoDir,
        encoding: 'utf8',
      });

      expect(result).toContain('test-branch');

      // Cleanup
      execSync('git checkout main', {
        cwd: harness.gitRepo.repoDir,
        encoding: 'utf8',
      });
    });
  });
});

describe('Event System', () => {
  test('should emit events correctly', () => {
    const { events } = require('../../src/utils/events');
    
    const emittedEvents: any[] = [];
    const handler = (event: any) => emittedEvents.push(event);
    
    events.on('test.event', handler);
    
    events.emit('test.event', { data: 'test' });
    
    expect(emittedEvents).toHaveLength(1);
    // Events are wrapped in CursorFlowEvent, data is in payload
    expect(emittedEvents[0].type).toBe('test.event');
    expect(emittedEvents[0].payload.data).toBe('test');
    
    events.off('test.event', handler);
  });

  test('should support wildcard listeners', () => {
    const { events } = require('../../src/utils/events');
    
    const emittedEvents: any[] = [];
    const handler = (event: any) => emittedEvents.push(event);
    
    events.on('*', handler);
    
    events.emit('event1', { value: 1 });
    events.emit('event2', { value: 2 });
    
    expect(emittedEvents).toHaveLength(2);
    expect(emittedEvents[0].type).toBe('event1');
    expect(emittedEvents[1].type).toBe('event2');
    
    events.off('*', handler);
  });
});


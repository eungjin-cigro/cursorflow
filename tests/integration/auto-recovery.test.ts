/**
 * Auto-Recovery Unit Tests
 * 
 * Tests the AutoRecoveryManager logic without external dependencies.
 * These tests verify:
 * - Idle detection timing
 * - Recovery stage transitions
 * - Continue signal generation
 * - Restart logic
 * - POF generation
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  AutoRecoveryManager,
  RecoveryStage,
  DEFAULT_AUTO_RECOVERY_CONFIG,
  resetAutoRecoveryManager,
  createPOFFromRecoveryState,
  savePOF,
  loadPOF,
} from '../../src/core/auto-recovery';

describe('AutoRecoveryManager', () => {
  let manager: AutoRecoveryManager;
  let tempDir: string;

  beforeEach(() => {
    // Reset singleton
    resetAutoRecoveryManager();
    
    // Create with short timeouts for testing
    manager = new AutoRecoveryManager({
      idleTimeoutMs: 500,        // 0.5 seconds
      continueGraceMs: 300,      // 0.3 seconds
      strongerPromptGraceMs: 300,
      maxRestarts: 2,
      runDoctorOnFailure: false, // Disable for unit tests
      verbose: false,
    });

    // Create temp directory for test files
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-test-'));
  });

  afterEach(() => {
    // Cleanup
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('Lane Registration', () => {
    test('should register lane with initial state', () => {
      manager.registerLane('test-lane', 'run-1');
      
      const state = manager.getState('test-lane');
      expect(state).toBeDefined();
      expect(state!.laneName).toBe('test-lane');
      expect(state!.runId).toBe('run-1');
      expect(state!.stage).toBe(RecoveryStage.NORMAL);
      expect(state!.restartCount).toBe(0);
    });

    test('should unregister lane', () => {
      manager.registerLane('test-lane', 'run-1');
      manager.unregisterLane('test-lane');
      
      expect(manager.getState('test-lane')).toBeUndefined();
    });
  });

  describe('Activity Recording', () => {
    test('should update activity time when bytes received', () => {
      manager.registerLane('test-lane', 'run-1');
      
      const stateBefore = manager.getState('test-lane')!;
      const timeBefore = stateBefore.lastActivityTime;
      
      // Small delay to ensure time difference
      const delay = new Promise(resolve => setTimeout(resolve, 10));
      return delay.then(() => {
        manager.recordActivity('test-lane', 100, 'some output');
        
        const stateAfter = manager.getState('test-lane')!;
        expect(stateAfter.lastActivityTime).toBeGreaterThanOrEqual(timeBefore);
        expect(stateAfter.totalBytesReceived).toBe(100);
        expect(stateAfter.lastOutput).toBe('some output');
      });
    });

    test('should not update activity time when zero bytes', () => {
      manager.registerLane('test-lane', 'run-1');
      
      const stateBefore = manager.getState('test-lane')!;
      const timeBefore = stateBefore.lastActivityTime;
      
      manager.recordActivity('test-lane', 0, 'heartbeat');
      
      const stateAfter = manager.getState('test-lane')!;
      expect(stateAfter.lastActivityTime).toBe(timeBefore);
    });

    test('should reset stage to NORMAL when activity received', async () => {
      manager.registerLane('test-lane', 'run-1');
      
      // Force stage to CONTINUE_SIGNAL
      const state = manager.getState('test-lane')!;
      state.stage = RecoveryStage.CONTINUE_SIGNAL;
      
      // Record activity
      manager.recordActivity('test-lane', 100, 'response');
      
      expect(manager.getState('test-lane')!.stage).toBe(RecoveryStage.NORMAL);
    });
  });

  describe('Idle Detection', () => {
    test('should detect idle after timeout', async () => {
      manager.registerLane('test-lane', 'run-1');
      
      // Initially should not need intervention
      expect(manager.needsIntervention('test-lane')).toBe(false);
      
      // Wait for idle timeout
      await new Promise(resolve => setTimeout(resolve, 600));
      
      // Now should need intervention
      expect(manager.needsIntervention('test-lane')).toBe(true);
    });

    test('should not detect idle if activity recorded', async () => {
      manager.registerLane('test-lane', 'run-1');
      
      // Wait partial timeout
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Record activity
      manager.recordActivity('test-lane', 50, 'working...');
      
      // Wait another partial timeout
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Should still not need intervention (activity reset the timer)
      expect(manager.needsIntervention('test-lane')).toBe(false);
    });

    test('should use longer timeout for long operations', async () => {
      const longOpManager = new AutoRecoveryManager({
        idleTimeoutMs: 200,
        longOperationGraceMs: 1000,
        longOperationPatterns: [/installing/i],
      });

      longOpManager.registerLane('test-lane', 'run-1');
      
      // Record output indicating long operation
      longOpManager.recordActivity('test-lane', 10, 'Installing dependencies...');
      
      // Wait past normal timeout
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Should NOT need intervention (long operation grace period)
      expect(longOpManager.needsIntervention('test-lane')).toBe(false);
    });
  });

  describe('Recovery Stage Transitions', () => {
    test('should escalate from NORMAL to CONTINUE_SIGNAL', async () => {
      manager.registerLane('test-lane', 'run-1');
      
      // Wait for idle
      await new Promise(resolve => setTimeout(resolve, 600));
      
      const laneRunDir = path.join(tempDir, 'test-lane');
      fs.mkdirSync(laneRunDir, { recursive: true });
      
      const action = await manager.getRecoveryAction('test-lane', laneRunDir);
      
      expect(action.action).toBe('continue_signal');
      expect(action.success).toBe(true);
      expect(manager.getState('test-lane')!.stage).toBe(RecoveryStage.CONTINUE_SIGNAL);
      
      // Check intervention file was created
      const interventionPath = path.join(laneRunDir, 'pending-intervention.json');
      expect(fs.existsSync(interventionPath)).toBe(true);
    });

    test('should escalate from CONTINUE_SIGNAL to STRONGER_PROMPT', async () => {
      manager.registerLane('test-lane', 'run-1');
      
      const laneRunDir = path.join(tempDir, 'test-lane');
      fs.mkdirSync(laneRunDir, { recursive: true });
      
      // First intervention
      await new Promise(resolve => setTimeout(resolve, 600));
      await manager.getRecoveryAction('test-lane', laneRunDir);
      
      // Wait for grace period
      await new Promise(resolve => setTimeout(resolve, 400));
      
      // Second intervention
      const action = await manager.getRecoveryAction('test-lane', laneRunDir);
      
      expect(action.action).toBe('stronger_prompt');
      expect(manager.getState('test-lane')!.stage).toBe(RecoveryStage.STRONGER_PROMPT);
    });

    test('should request restart after stronger prompt fails', async () => {
      manager.registerLane('test-lane', 'run-1');
      
      const laneRunDir = path.join(tempDir, 'test-lane');
      fs.mkdirSync(laneRunDir, { recursive: true });
      
      // First intervention (CONTINUE_SIGNAL)
      await new Promise(resolve => setTimeout(resolve, 600));
      await manager.getRecoveryAction('test-lane', laneRunDir);
      
      // Wait and second intervention (STRONGER_PROMPT)
      await new Promise(resolve => setTimeout(resolve, 400));
      await manager.getRecoveryAction('test-lane', laneRunDir);
      
      // Wait and third intervention (RESTART)
      await new Promise(resolve => setTimeout(resolve, 400));
      const action = await manager.getRecoveryAction('test-lane', laneRunDir);
      
      expect(action.action).toBe('restart');
      expect(manager.getState('test-lane')!.restartCount).toBe(1);
    });

    test('should abort after max restarts exceeded', async () => {
      manager.registerLane('test-lane', 'run-1');
      
      const laneRunDir = path.join(tempDir, 'test-lane');
      fs.mkdirSync(laneRunDir, { recursive: true });
      
      // Force state to simulate multiple restarts
      const state = manager.getState('test-lane')!;
      state.stage = RecoveryStage.STRONGER_PROMPT;
      state.restartCount = 2; // At max
      state.lastStageChangeTime = Date.now() - 1000;
      
      const action = await manager.getRecoveryAction('test-lane', laneRunDir);
      
      // Should skip to DIAGNOSE since restarts exhausted
      expect(action.action).toBe('diagnose');
    });
  });

  describe('Failure History', () => {
    test('should record failure history', async () => {
      manager.registerLane('test-lane', 'run-1');
      
      const laneRunDir = path.join(tempDir, 'test-lane');
      fs.mkdirSync(laneRunDir, { recursive: true });
      
      // Trigger intervention
      await new Promise(resolve => setTimeout(resolve, 600));
      await manager.getRecoveryAction('test-lane', laneRunDir);
      
      const history = manager.getFailureHistory('test-lane');
      expect(history.length).toBe(1);
      expect(history[0]!.action).toBe('continue_signal');
      expect(history[0]!.stage).toBe(RecoveryStage.CONTINUE_SIGNAL);
    });
  });
});

describe('POF (Post-mortem of Failure)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pof-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  test('should create POF entry from recovery state', () => {
    const recoveryState = {
      laneName: 'test-lane',
      runId: 'run-123',
      stage: RecoveryStage.ABORT,
      lastActivityTime: Date.now() - 60000,
      lastBytesReceived: 100,
      totalBytesReceived: 500,
      lastOutput: 'Last output before failure',
      restartCount: 2,
      continueSignalsSent: 3,
      lastStageChangeTime: Date.now(),
      isLongOperation: false,
      failureHistory: [
        {
          timestamp: Date.now() - 30000,
          stage: RecoveryStage.CONTINUE_SIGNAL,
          action: 'continue_signal',
          message: 'Idle for 120s',
          idleTimeMs: 120000,
          bytesReceived: 500,
          lastOutput: 'Working...',
        },
      ],
    };

    const laneState = {
      label: 'test-lane',
      status: 'failed' as const,
      currentTaskIndex: 1,
      totalTasks: 3,
      pid: 12345,
      worktreeDir: '/tmp/worktree',
      pipelineBranch: 'cursorflow/test',
      startTime: Date.now() - 300000,
      endTime: null,
      error: 'Agent stopped responding',
      dependencyRequest: null,
    };

    const pof = createPOFFromRecoveryState(
      'run-123',
      '/tmp/runs/run-123',
      'test-lane',
      recoveryState,
      laneState
    );

    expect(pof.runId).toBe('run-123');
    expect(pof.affectedLanes).toHaveLength(1);
    expect(pof.affectedLanes[0]!.name).toBe('test-lane');
    expect(pof.affectedLanes[0]!.recoveryAttempts).toHaveLength(1);
    expect(pof.possibleCauses.length).toBeGreaterThan(0);
    expect(pof.recovery.command).toContain('cursorflow resume');
  });

  test('should save and load POF', () => {
    const pof = {
      title: 'Test POF',
      runId: 'run-123',
      failureTime: new Date().toISOString(),
      detectedAt: new Date().toISOString(),
      summary: 'Test failure',
      rootCause: {
        type: 'TEST',
        description: 'Test description',
        symptoms: ['symptom1'],
      },
      affectedLanes: [],
      possibleCauses: ['cause1'],
      recovery: {
        command: 'cursorflow resume',
        description: 'Resume the run',
      },
    };

    const pofPath = savePOF('run-123', tempDir, pof);
    expect(fs.existsSync(pofPath)).toBe(true);

    const loadedPof = loadPOF(tempDir, 'run-123');
    expect(loadedPof).not.toBeNull();
    expect(loadedPof!.runId).toBe('run-123');
    expect(loadedPof!.summary).toBe('Test failure');
  });

  test('should append to existing POF as previousFailures', () => {
    const firstPof = {
      title: 'First POF',
      runId: 'run-123',
      failureTime: new Date().toISOString(),
      detectedAt: new Date().toISOString(),
      summary: 'First failure',
      rootCause: { type: 'FIRST', description: 'First', symptoms: [] },
      affectedLanes: [],
      possibleCauses: [],
      recovery: { command: 'cmd1', description: 'desc1' },
    };

    savePOF('run-123', tempDir, firstPof);

    const secondPof = {
      title: 'Second POF',
      runId: 'run-123',
      failureTime: new Date().toISOString(),
      detectedAt: new Date().toISOString(),
      summary: 'Second failure',
      rootCause: { type: 'SECOND', description: 'Second', symptoms: [] },
      affectedLanes: [],
      possibleCauses: [],
      recovery: { command: 'cmd2', description: 'desc2' },
    };

    savePOF('run-123', tempDir, secondPof);

    const loaded = loadPOF(tempDir, 'run-123');
    expect(loaded!.summary).toBe('Second failure');
    expect(loaded!.previousFailures).toHaveLength(1);
    expect(loaded!.previousFailures![0]!.summary).toBe('First failure');
  });
});


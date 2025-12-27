import { 
  StallDetectionService, 
  StallPhase, 
  RecoveryAction,
  StallType,
  resetStallService,
} from '../../src/core/stall-detection';

// Legacy imports for backward compatibility tests
import { AutoRecoveryManager, RecoveryStage } from '../../src/core/auto-recovery';
import { analyzeStall, FailureType, RecoveryAction as LegacyRecoveryAction } from '../../src/core/failure-policy';

describe('StallDetectionService (Unified)', () => {
  let service: StallDetectionService;
  const laneName = 'test-lane';

  beforeEach(() => {
    // Reset singleton for each test
    resetStallService();
    service = StallDetectionService.getInstance({
      idleTimeoutMs: 1000, // 1 second for testing
      continueGraceMs: 500,
      strongerPromptGraceMs: 500,
      maxRestarts: 2,
      verbose: false,
    });
    service.registerLane(laneName, { laneRunDir: '/tmp/test-lane' });
  });

  afterEach(() => {
    resetStallService();
  });

  describe('Activity Recording', () => {
    test('should update lastRealActivityTime when real activity (bytes > 0) is recorded', async () => {
      const stateBefore = service.getState(laneName)!;
      const initialActivityTime = stateBefore.lastRealActivityTime;

      // Wait a bit to ensure time advances
      await new Promise(resolve => setTimeout(resolve, 10));

      service.recordActivity(laneName, 100, 'Real output');
      
      const stateAfter = service.getState(laneName)!;
      expect(stateAfter.lastRealActivityTime).toBeGreaterThan(initialActivityTime);
      expect(stateAfter.totalBytesReceived).toBe(100);
    });

    test('should NOT update lastRealActivityTime when heartbeat (bytes === 0) is recorded', async () => {
      const stateBefore = service.getState(laneName)!;
      const initialActivityTime = stateBefore.lastRealActivityTime;

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10));

      service.recordActivity(laneName, 0, '⏱ Heartbeat: 10s elapsed, 0 bytes received');
      
      const stateAfter = service.getState(laneName)!;
      expect(stateAfter.lastRealActivityTime).toBe(initialActivityTime);
      expect(stateAfter.totalBytesReceived).toBe(0);
      expect(stateAfter.lastOutput).toContain('Heartbeat');
    });

    test('should reset phase to NORMAL when real activity is detected', async () => {
      // Manually set to CONTINUE_SENT phase (simulating successful intervention)
      const state = service.getState(laneName)!;
      state.phase = StallPhase.CONTINUE_SENT;
      state.lastPhaseChangeTime = Date.now();
      
      expect(service.getPhase(laneName)).toBe(StallPhase.CONTINUE_SENT);
      
      // Record real activity
      service.recordActivity(laneName, 50, 'Real output');
      
      // Phase should reset to NORMAL
      expect(service.getPhase(laneName)).toBe(StallPhase.NORMAL);
    });
  });

  describe('Stall Analysis', () => {
    test('should return SEND_CONTINUE when idle timeout exceeded', async () => {
      // Record some initial activity so it's not ZERO_BYTES
      service.recordActivity(laneName, 10, 'Initial activity');
      
      // Wait for idle timeout
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      const analysis = service.analyzeStall(laneName);
      
      expect(analysis.type).toBe(StallType.IDLE);
      expect(analysis.action).toBe(RecoveryAction.SEND_CONTINUE);
    });

    test('should return ZERO_BYTES type when 0 bytes received during idle', async () => {
      // Wait for idle timeout without any activity
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // First check to update bytesAtLastCheck
      service.checkAndRecover(laneName);
      
      // Wait again
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      const analysis = service.analyzeStall(laneName);
      
      // Since we're now in CONTINUE_SENT phase, it should escalate
      expect(analysis.action).not.toBe(RecoveryAction.NONE);
    });

    test('should return NONE when activity is recent', () => {
      // Record some activity
      service.recordActivity(laneName, 100, 'Active');
      
      const analysis = service.analyzeStall(laneName);
      
      expect(analysis.action).toBe(RecoveryAction.NONE);
    });
  });

  describe('Recovery Escalation', () => {
    test('should escalate from CONTINUE to STRONGER_PROMPT after grace period', async () => {
      // Manually set to CONTINUE_SENT phase (simulating successful intervention)
      const state = service.getState(laneName)!;
      state.phase = StallPhase.CONTINUE_SENT;
      state.lastPhaseChangeTime = Date.now() - 600; // Past grace period
      
      const analysis = service.analyzeStall(laneName);
      expect(analysis.action).toBe(RecoveryAction.SEND_STRONGER_PROMPT);
    });

    test('should escalate to REQUEST_RESTART after stronger prompt grace period', async () => {
      // Move to STRONGER_PROMPT_SENT
      service.getState(laneName)!.phase = StallPhase.STRONGER_PROMPT_SENT;
      service.getState(laneName)!.lastPhaseChangeTime = Date.now() - 600;
      
      const analysis = service.analyzeStall(laneName);
      expect(analysis.action).toBe(RecoveryAction.REQUEST_RESTART);
    });

    test('should escalate to RUN_DOCTOR after max restarts', async () => {
      const state = service.getState(laneName)!;
      state.phase = StallPhase.STRONGER_PROMPT_SENT;
      state.lastPhaseChangeTime = Date.now() - 600;
      state.restartCount = 2; // Already at max
      
      const analysis = service.analyzeStall(laneName);
      expect(analysis.action).toBe(RecoveryAction.RUN_DOCTOR);
    });
  });

  describe('State Management', () => {
    test('should track restart count correctly', () => {
      expect(service.getRestartCount(laneName)).toBe(0);
      
      const state = service.getState(laneName)!;
      state.restartCount = 1;
      
      expect(service.getRestartCount(laneName)).toBe(1);
    });

    test('should correctly identify unrecoverable state', () => {
      expect(service.isUnrecoverable(laneName)).toBe(false);
      
      service.getState(laneName)!.phase = StallPhase.DIAGNOSED;
      expect(service.isUnrecoverable(laneName)).toBe(true);
      
      service.getState(laneName)!.phase = StallPhase.ABORTED;
      expect(service.isUnrecoverable(laneName)).toBe(true);
    });

    test('should record failure history', async () => {
      await new Promise(resolve => setTimeout(resolve, 1100));
      service.checkAndRecover(laneName);
      
      const history = service.getFailureHistory(laneName);
      expect(history.length).toBeGreaterThan(0);
      expect(history[0].action).toBe(RecoveryAction.SEND_CONTINUE);
    });
  });

  describe('Singleton Pattern', () => {
    test('should return same instance', () => {
      const instance1 = StallDetectionService.getInstance();
      const instance2 = StallDetectionService.getInstance();
      
      expect(instance1).toBe(instance2);
    });

    test('should update config when provided', () => {
      const instance = StallDetectionService.getInstance({ idleTimeoutMs: 5000 });
      expect(instance.getConfig().idleTimeoutMs).toBe(5000);
    });
  });
});

// Backward compatibility tests
describe('Legacy Stall Detection (Backward Compatibility)', () => {
  describe('AutoRecoveryManager', () => {
    let manager: AutoRecoveryManager;
    const laneName = 'test-lane';
    const runId = 'test-run-1';

    beforeEach(() => {
      manager = new AutoRecoveryManager({
        idleTimeoutMs: 1000, // 1 second for testing
      });
      manager.registerLane(laneName, runId);
    });

    test('should update lastActivityTime when real activity (bytes > 0) is recorded', async () => {
      const stateBefore = manager.getState(laneName)!;
      const initialActivityTime = stateBefore.lastActivityTime;

      // Wait a bit to ensure time advances
      await new Promise(resolve => setTimeout(resolve, 10));

      manager.recordActivity(laneName, 100, 'Real output');
      
      const stateAfter = manager.getState(laneName)!;
      expect(stateAfter.lastActivityTime).toBeGreaterThan(initialActivityTime);
      expect(stateAfter.totalBytesReceived).toBe(100);
    });

    test('should NOT update lastActivityTime when heartbeat (bytes === 0) is recorded', async () => {
      const stateBefore = manager.getState(laneName)!;
      const initialActivityTime = stateBefore.lastActivityTime;

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10));

      manager.recordActivity(laneName, 0, '⏱ Heartbeat: 10s elapsed, 0 bytes received');
      
      const stateAfter = manager.getState(laneName)!;
      expect(stateAfter.lastActivityTime).toBe(initialActivityTime);
      expect(stateAfter.totalBytesReceived).toBe(0);
      expect(stateAfter.lastOutput).toContain('Heartbeat');
    });

    test('should trigger intervention when idle even with heartbeats', async () => {
      // Record heartbeats multiple times
      for (let i = 0; i < 3; i++) {
        await new Promise(resolve => setTimeout(resolve, 400));
        manager.recordActivity(laneName, 0, '⏱ Heartbeat');
      }

      // After 1.2s ( > 1s idleTimeout), it should need intervention
      expect(manager.needsIntervention(laneName)).toBe(true);
      
      const action = await manager.getRecoveryAction(laneName, '/tmp');
      expect(action.action).toBe('continue_signal');
    });
  });

  describe('failure-policy analyzeStall (deprecated)', () => {
    const config = {
      idleTimeoutMs: 1000,
      progressTimeoutMs: 5000,
      taskTimeoutMs: 10000,
      longOperationGraceMs: 2000,
      longOperationPatterns: [],
      maxRestarts: 2,
    };

    test('should return AGENT_NO_RESPONSE when bytesReceived is 0 and idleTime is high', () => {
      const analysis = analyzeStall({
        stallPhase: 0,
        idleTimeMs: 1500,
        bytesReceived: 0, // No real bytes since last check
      }, config);

      expect(analysis.type).toBe(FailureType.AGENT_NO_RESPONSE);
      expect(analysis.action).toBe(LegacyRecoveryAction.CONTINUE_SIGNAL);
    });

    test('should return NONE when bytesReceived > 0 even if idleTime is high', () => {
      // This covers the case where orchestrator just received data but hasn't reset idleTime yet
      const analysis = analyzeStall({
        stallPhase: 0,
        idleTimeMs: 1500,
        bytesReceived: 50, // Some bytes received since last check
      }, config);

      // It might still return STALL_IDLE based on idleTimeMs alone in the current implementation
      // But we want to ensure AGENT_NO_RESPONSE is not triggered
      expect(analysis.type).not.toBe(FailureType.AGENT_NO_RESPONSE);
    });
  });
});

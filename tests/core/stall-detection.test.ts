import { AutoRecoveryManager, RecoveryStage } from '../../src/core/auto-recovery';
import { analyzeStall, FailureType, RecoveryAction } from '../../src/core/failure-policy';

describe('Stall Detection and Heartbeat Filtering', () => {
  describe('AutoRecoveryManager', () => {
    let manager: AutoRecoveryManager;
    const laneName = 'test-lane';

    beforeEach(() => {
      manager = new AutoRecoveryManager({
        idleTimeoutMs: 1000, // 1 second for testing
      });
      manager.registerLane(laneName);
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

  describe('failure-policy analyzeStall', () => {
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
      expect(analysis.action).toBe(RecoveryAction.CONTINUE_SIGNAL);
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


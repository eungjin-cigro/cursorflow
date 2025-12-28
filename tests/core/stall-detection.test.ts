import { 
  StallDetectionService, 
  StallPhase, 
  RecoveryAction,
  StallType,
  resetStallService,
} from '../../src/core/stall-detection';

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


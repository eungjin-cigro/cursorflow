/**
 * Tests for the intervention module
 * 
 * This tests the core intervention functionality:
 * - Creating intervention requests
 * - Reading and clearing pending interventions
 * - Process kill utilities
 * - Message generation
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  createInterventionRequest,
  readPendingIntervention,
  clearPendingIntervention,
  hasPendingIntervention,
  InterventionType,
  PENDING_INTERVENTION_FILE,
  createContinueMessage,
  createStrongerPromptMessage,
  createRestartMessage,
  wrapUserIntervention,
  isProcessAlive,
  killProcess,
} from '../../src/core/intervention';

describe('Intervention Module', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intervention-test-'));
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('Intervention Request Management', () => {
    test('should create intervention request file', () => {
      createInterventionRequest(testDir, {
        type: InterventionType.USER_MESSAGE,
        message: 'Test message',
        source: 'user',
      });

      const pendingPath = path.join(testDir, PENDING_INTERVENTION_FILE);
      expect(fs.existsSync(pendingPath)).toBe(true);

      const content = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
      expect(content.type).toBe(InterventionType.USER_MESSAGE);
      expect(content.message).toBe('Test message');
      expect(content.source).toBe('user');
      expect(content.timestamp).toBeDefined();
    });

    test('should read pending intervention', () => {
      createInterventionRequest(testDir, {
        type: InterventionType.STRONGER_PROMPT,
        message: 'Stronger message',
        source: 'stall-detector',
        priority: 7,
      });

      const intervention = readPendingIntervention(testDir);
      expect(intervention).not.toBeNull();
      expect(intervention!.type).toBe(InterventionType.STRONGER_PROMPT);
      expect(intervention!.message).toBe('Stronger message');
      expect(intervention!.priority).toBe(7);
    });

    test('should return null when no pending intervention', () => {
      const intervention = readPendingIntervention(testDir);
      expect(intervention).toBeNull();
    });

    test('should clear pending intervention', () => {
      createInterventionRequest(testDir, {
        type: InterventionType.USER_MESSAGE,
        message: 'Test',
        source: 'user',
      });

      expect(hasPendingIntervention(testDir)).toBe(true);

      clearPendingIntervention(testDir);

      expect(hasPendingIntervention(testDir)).toBe(false);
      expect(fs.existsSync(path.join(testDir, PENDING_INTERVENTION_FILE))).toBe(false);
    });

    test('should respect priority when existing request has higher priority', () => {
      // Create high priority request
      createInterventionRequest(testDir, {
        type: InterventionType.USER_MESSAGE,
        message: 'High priority',
        source: 'user',
        priority: 10,
      });

      // Try to create lower priority request
      createInterventionRequest(testDir, {
        type: InterventionType.CONTINUE_SIGNAL,
        message: 'Low priority',
        source: 'stall-detector',
        priority: 5,
      });

      const intervention = readPendingIntervention(testDir);
      expect(intervention!.message).toBe('High priority');
    });

    test('should replace request when new request has higher priority', () => {
      // Create low priority request
      createInterventionRequest(testDir, {
        type: InterventionType.CONTINUE_SIGNAL,
        message: 'Low priority',
        source: 'stall-detector',
        priority: 5,
      });

      // Create higher priority request
      createInterventionRequest(testDir, {
        type: InterventionType.USER_MESSAGE,
        message: 'High priority',
        source: 'user',
        priority: 10,
      });

      const intervention = readPendingIntervention(testDir);
      expect(intervention!.message).toBe('High priority');
    });
  });

  describe('Message Generation', () => {
    test('should create continue message', () => {
      const message = createContinueMessage();
      expect(message).toContain('continue');
      expect(message.length).toBeGreaterThan(10);
    });

    test('should create stronger prompt message', () => {
      const message = createStrongerPromptMessage();
      expect(message).toContain('SYSTEM INTERVENTION');
      expect(message).toContain('stuck');
      expect(message.length).toBeGreaterThan(100);
    });

    test('should create restart message', () => {
      const message = createRestartMessage('Test reason');
      expect(message).toContain('SYSTEM');
      expect(message).toContain('Test reason');
    });

    test('should wrap user intervention', () => {
      const message = wrapUserIntervention('Hello');
      expect(message).toBe('[USER INTERVENTION] Hello');
    });
  });

  describe('Process Utilities', () => {
    test('should return false for non-existent PID', () => {
      // Use a very high PID that's unlikely to exist
      const alive = isProcessAlive(999999999);
      expect(alive).toBe(false);
    });

    test('should return true for current process', () => {
      const alive = isProcessAlive(process.pid);
      expect(alive).toBe(true);
    });

    test('killProcess should handle non-existent PID gracefully', () => {
      const result = killProcess(999999999);
      // Should return true because the process doesn't exist (considered "killed")
      expect(result).toBe(true);
    });
  });

  describe('Intervention Types', () => {
    test('should have all expected intervention types', () => {
      expect(InterventionType.USER_MESSAGE).toBe('user_message');
      expect(InterventionType.CONTINUE_SIGNAL).toBe('continue_signal');
      expect(InterventionType.STRONGER_PROMPT).toBe('stronger_prompt');
      expect(InterventionType.SYSTEM_RESTART).toBe('system_restart');
      expect(InterventionType.GIT_GUIDANCE).toBe('git_guidance');
    });
  });
});


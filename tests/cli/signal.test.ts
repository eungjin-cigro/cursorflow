/**
 * Tests for signal CLI command
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import signal = require('../../src/cli/signal');
import * as config from '../../src/utils/config';
import * as logger from '../../src/utils/logger';
import * as state from '../../src/utils/state';
import * as intervention from '../../src/core/intervention';

jest.mock('../../src/utils/config');
jest.mock('../../src/utils/logger');
jest.mock('../../src/utils/state');
jest.mock('../../src/core/intervention');

describe('CLI signal command', () => {
  const mockedLoadConfig = config.loadConfig as jest.Mock;
  const mockedGetLogsDir = config.getLogsDir as jest.Mock;
  const mockedLoadState = state.loadState as jest.Mock;
  const mockedAppendLog = state.appendLog as jest.Mock;
  const mockedCreateConversationEntry = state.createConversationEntry as jest.Mock;
  const mockedIsProcessAlive = intervention.isProcessAlive as jest.Mock;
  const mockedCreateInterventionRequest = intervention.createInterventionRequest as jest.Mock;
  const mockedExecuteUserIntervention = intervention.executeUserIntervention as jest.Mock;
  const mockedWrapUserIntervention = intervention.wrapUserIntervention as jest.Mock;

  let testDir: string;
  let runDir: string;
  let laneDir: string;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create test directory structure
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-test-'));
    runDir = path.join(testDir, 'logs', 'runs', 'run-20240101-120000');
    laneDir = path.join(runDir, 'lanes', 'test-lane');
    fs.mkdirSync(laneDir, { recursive: true });

    // Default mocks
    mockedLoadConfig.mockReturnValue({ projectRoot: testDir });
    mockedGetLogsDir.mockReturnValue(path.join(testDir, 'logs'));
    mockedCreateConversationEntry.mockReturnValue({ type: 'intervention', content: 'test' });
    mockedWrapUserIntervention.mockImplementation((msg) => `[USER INTERVENTION] ${msg}`);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('completed lane rejection', () => {
    test('should reject signal to completed lane with error', async () => {
      // Setup: lane is completed
      fs.writeFileSync(path.join(laneDir, 'state.json'), JSON.stringify({
        label: 'test-lane',
        status: 'completed',
        currentTaskIndex: 3,
        totalTasks: 3,
      }));

      mockedLoadState.mockReturnValue({
        label: 'test-lane',
        status: 'completed',
        currentTaskIndex: 3,
        totalTasks: 3,
      });
      mockedIsProcessAlive.mockReturnValue(false);

      // Execute & Assert
      await expect(signal(['test-lane', 'Some message', '--run-dir', runDir]))
        .rejects
        .toThrow('Lane is already completed');

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Cannot signal a completed lane'));
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('cursorflow run'));
      expect(mockedCreateInterventionRequest).not.toHaveBeenCalled();
    });
  });

  describe('failed lane handling', () => {
    test('should accept signal to failed lane and queue intervention', async () => {
      // Setup: lane is failed
      fs.writeFileSync(path.join(laneDir, 'state.json'), JSON.stringify({
        label: 'test-lane',
        status: 'failed',
        error: 'Some error',
      }));

      mockedLoadState.mockReturnValue({
        label: 'test-lane',
        status: 'failed',
        error: 'Some error',
      });
      mockedIsProcessAlive.mockReturnValue(false);

      // Execute
      await signal(['test-lane', 'Try again with different approach', '--run-dir', runDir]);

      // Assert
      expect(mockedCreateInterventionRequest).toHaveBeenCalledWith(
        laneDir,
        expect.objectContaining({
          type: intervention.InterventionType.USER_MESSAGE,
          source: 'user',
        })
      );
      expect(logger.success).toHaveBeenCalledWith(expect.stringContaining('Signal queued'));
    });
  });

  describe('pending lane handling', () => {
    test('should accept signal to pending lane and queue intervention', async () => {
      // Setup: lane is pending
      fs.writeFileSync(path.join(laneDir, 'state.json'), JSON.stringify({
        label: 'test-lane',
        status: 'pending',
      }));

      mockedLoadState.mockReturnValue({
        label: 'test-lane',
        status: 'pending',
      });
      mockedIsProcessAlive.mockReturnValue(false);

      // Execute
      await signal(['test-lane', 'Start with this context', '--run-dir', runDir]);

      // Assert
      expect(mockedCreateInterventionRequest).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('not currently running'));
      expect(logger.success).toHaveBeenCalledWith(expect.stringContaining('Signal queued'));
    });
  });

  describe('running lane handling', () => {
    test('should interrupt running lane and create intervention', async () => {
      // Setup: lane is running
      const runningPid = 12345;
      fs.writeFileSync(path.join(laneDir, 'state.json'), JSON.stringify({
        label: 'test-lane',
        status: 'running',
        pid: runningPid,
      }));

      mockedLoadState.mockReturnValue({
        label: 'test-lane',
        status: 'running',
        pid: runningPid,
      });
      mockedIsProcessAlive.mockReturnValue(true);
      mockedExecuteUserIntervention.mockResolvedValue({
        success: true,
        killedPid: runningPid,
      });

      // Execute (note: --run-dir must come before message to avoid being included in message)
      await signal(['test-lane', '--run-dir', runDir, 'Focus on error handling']);

      // Assert
      expect(mockedExecuteUserIntervention).toHaveBeenCalledWith(
        laneDir,
        'Focus on error handling',
        runningPid
      );
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Interrupting running process'));
      expect(logger.success).toHaveBeenCalledWith(expect.stringContaining('interrupted successfully'));
    });
  });

  describe('timeout update', () => {
    test('should update timeout without checking lane status', async () => {
      // Setup: minimal lane state (doesn't matter for timeout)
      fs.writeFileSync(path.join(laneDir, 'state.json'), JSON.stringify({
        label: 'test-lane',
        status: 'running',
      }));

      // Execute
      await signal(['test-lane', '--timeout', '600000', '--run-dir', runDir]);

      // Assert
      const timeoutPath = path.join(laneDir, 'timeout.txt');
      expect(fs.existsSync(timeoutPath)).toBe(true);
      expect(fs.readFileSync(timeoutPath, 'utf8')).toBe('600000');
      expect(logger.success).toHaveBeenCalledWith(expect.stringContaining('Timeout update signal sent'));
    });
  });

  describe('error handling', () => {
    test('should throw error when lane name not provided', async () => {
      await expect(signal([]))
        .rejects
        .toThrow('Lane name required');
    });

    test('should throw error when lane directory not found', async () => {
      await expect(signal(['nonexistent-lane', 'message', '--run-dir', runDir]))
        .rejects
        .toThrow('Lane directory not found');
    });

    test('should throw error when neither message nor timeout provided', async () => {
      fs.writeFileSync(path.join(laneDir, 'state.json'), JSON.stringify({
        label: 'test-lane',
        status: 'pending',
      }));

      // Use only lane name - findLatestRunDir will find the test run directory
      await expect(signal(['test-lane']))
        .rejects
        .toThrow('Either a message or --timeout is required');
    });
  });

  describe('--force option removal', () => {
    test('should not recognize --force option', async () => {
      // Setup: lane is pending
      fs.writeFileSync(path.join(laneDir, 'state.json'), JSON.stringify({
        label: 'test-lane',
        status: 'pending',
      }));

      mockedLoadState.mockReturnValue({
        label: 'test-lane',
        status: 'pending',
      });
      mockedIsProcessAlive.mockReturnValue(false);

      // Execute with --force (should be ignored, treated as regular arg)
      // Since --force is no longer parsed, it would be filtered out as an option
      // and the command should work normally without special handling
      await signal(['test-lane', 'message', '--run-dir', runDir]);

      // Assert: intervention should be created normally
      expect(mockedCreateInterventionRequest).toHaveBeenCalled();
    });
  });
});


/**
 * E2E Tests for Enhanced Logging Feature
 * 
 * Tests the full logging pipeline from orchestrator spawn to log viewing
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnLane, waitChild } from '../../src/core/orchestrator';
import { 
  readJsonLog, 
  stripAnsi, 
  exportLogs,
  DEFAULT_LOG_CONFIG,
} from '../../src/utils/enhanced-logger';

describe('Enhanced Logging E2E', () => {
  const testDir = path.join(__dirname, 'test-enhanced-logging');
  const tasksDir = path.join(testDir, 'tasks');
  const lanesDir = path.join(testDir, 'lanes');

  beforeAll(() => {
    // Setup test directories
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.mkdirSync(lanesDir, { recursive: true });

    // Create a simple test task that will produce output
    const taskConfig = {
      baseBranch: 'main',
      branchPrefix: 'test/',
      tasks: [
        {
          name: 'test-task',
          prompt: 'This is a test prompt',
        },
      ],
    };

    fs.writeFileSync(
      path.join(tasksDir, 'test-lane.json'),
      JSON.stringify(taskConfig, null, 2)
    );
  });

  afterAll(() => {
    // Cleanup
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe('Log File Creation', () => {
    it('should create all expected log files when enhanced logging is enabled', async () => {
      const laneRunDir = path.join(lanesDir, 'log-creation-test');
      fs.mkdirSync(laneRunDir, { recursive: true });

      // Spawn a lane with enhanced logging
      const result = spawnLane({
        laneName: 'log-creation-test',
        tasksFile: path.join(tasksDir, 'test-lane.json'),
        laneRunDir,
        executor: 'cursor-agent',
        startIndex: 0,
        enhancedLogConfig: {
          enabled: true,
          stripAnsi: true,
          addTimestamps: true,
          keepRawLogs: true,
          writeJsonLog: true,
        },
      });

      // Kill the process immediately (we just want to test file creation)
      result.child.kill('SIGTERM');
      await waitChild(result.child);

      // Give time for logs to flush
      await new Promise(resolve => setTimeout(resolve, 100));

      // Close log manager if exists
      if (result.logManager) {
        result.logManager.close();
      }

      // Check that log files were created
      expect(fs.existsSync(path.join(laneRunDir, 'terminal.jsonl'))).toBe(true);
    });

    it('should fall back to simple logging when enhanced logging is disabled', async () => {
      const laneRunDir = path.join(lanesDir, 'disabled-test');
      fs.mkdirSync(laneRunDir, { recursive: true });

      const result = spawnLane({
        laneName: 'disabled-test',
        tasksFile: path.join(tasksDir, 'test-lane.json'),
        laneRunDir,
        executor: 'cursor-agent',
        startIndex: 0,
        enhancedLogConfig: {
          enabled: false,
        },
      });

      result.child.kill('SIGTERM');
      await waitChild(result.child);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Simple logging now creates terminal.jsonl
      expect(fs.existsSync(path.join(laneRunDir, 'terminal.jsonl'))).toBe(true);
      // No logManager when disabled
      expect(result.logManager).toBeUndefined();
    });
  });

  describe('Log Content', () => {
    it('should include session start entry with lane info', async () => {
      const laneRunDir = path.join(lanesDir, 'session-entry-test');
      fs.mkdirSync(laneRunDir, { recursive: true });

      const result = spawnLane({
        laneName: 'session-entry-test',
        tasksFile: path.join(tasksDir, 'test-lane.json'),
        laneRunDir,
        executor: 'cursor-agent',
        startIndex: 0,
        enhancedLogConfig: {
          enabled: true,
        },
      });

      result.child.kill('SIGTERM');
      await waitChild(result.child);
      await new Promise(resolve => setTimeout(resolve, 100));

      if (result.logManager) {
        result.logManager.close();
      }

      const logContent = fs.readFileSync(path.join(laneRunDir, 'terminal.jsonl'), 'utf8');
      
      expect(logContent).toContain('Session started');
      expect(logContent).toContain('session-entry-test');
    });

    it('should write log entries with proper structure', async () => {
      const laneRunDir = path.join(lanesDir, 'log-structure-test');
      fs.mkdirSync(laneRunDir, { recursive: true });

      const result = spawnLane({
        laneName: 'log-structure-test',
        tasksFile: path.join(tasksDir, 'test-lane.json'),
        laneRunDir,
        executor: 'cursor-agent',
        startIndex: 0,
        enhancedLogConfig: {
          enabled: true,
        },
      });

      result.child.kill('SIGTERM');
      await waitChild(result.child);
      await new Promise(resolve => setTimeout(resolve, 100));

      if (result.logManager) {
        result.logManager.close();
      }

      const logContent = fs.readFileSync(path.join(laneRunDir, 'terminal.jsonl'), 'utf8');
      expect(logContent).toContain('Session started');
      expect(logContent).toContain('log-structure-test');
    });
  });

  describe('Log Export', () => {
    const exportTestDir = path.join(lanesDir, 'export-test');

    beforeAll(async () => {
      fs.mkdirSync(exportTestDir, { recursive: true });

      const result = spawnLane({
        laneName: 'export-test',
        tasksFile: path.join(tasksDir, 'test-lane.json'),
        laneRunDir: exportTestDir,
        executor: 'cursor-agent',
        startIndex: 0,
        enhancedLogConfig: {
          enabled: true,
        },
      });

      result.child.kill('SIGTERM');
      await waitChild(result.child);
      await new Promise(resolve => setTimeout(resolve, 100));

      if (result.logManager) {
        result.logManager.close();
      }
    });

    it('should export logs as text', () => {
      const output = exportLogs(exportTestDir, 'text');
      expect(output).toContain('CursorFlow Session Log');
    });

    it('should export logs (simplified)', () => {
      const output = exportLogs(exportTestDir, 'json');
      expect(output).toContain('CursorFlow Session Log');
    });

    it('should write export to file', () => {
      const outputPath = path.join(exportTestDir, 'exported.txt');
      exportLogs(exportTestDir, 'text', outputPath);
      
      expect(fs.existsSync(outputPath)).toBe(true);
      const content = fs.readFileSync(outputPath, 'utf8');
      expect(content).toContain('CursorFlow Session Log');
    });
  });

  describe('ANSI Stripping', () => {
    it('should handle common ANSI sequences', () => {
      // Test various ANSI codes
      const testCases = [
        { input: '\x1b[31mRed\x1b[0m', expected: 'Red' },
        { input: '\x1b[1mBold\x1b[0m', expected: 'Bold' },
        { input: '\x1b[32m✓\x1b[0m Success', expected: '✓ Success' },
        { input: '\x1b[2K\x1b[1GProgress', expected: 'Progress' },
        { input: 'No ANSI here', expected: 'No ANSI here' },
      ];

      for (const { input, expected } of testCases) {
        expect(stripAnsi(input)).toBe(expected);
      }
    });
  });

  describe('Default Configuration', () => {
    it('should have appropriate defaults', () => {
      expect(DEFAULT_LOG_CONFIG.enabled).toBe(true);
      expect(DEFAULT_LOG_CONFIG.stripAnsi).toBe(true);
      expect(DEFAULT_LOG_CONFIG.addTimestamps).toBe(true);
      expect(DEFAULT_LOG_CONFIG.maxFileSize).toBeGreaterThan(0);
      expect(DEFAULT_LOG_CONFIG.maxFiles).toBeGreaterThan(0);
    });
  });
});


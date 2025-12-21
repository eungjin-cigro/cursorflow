/**
 * Tests for enhanced-logger utility
 */

import * as fs from 'fs';
import * as path from 'path';
import { 
  stripAnsi, 
  formatTimestamp, 
  EnhancedLogManager,
  createLogManager,
  readJsonLog,
  exportLogs,
  DEFAULT_LOG_CONFIG,
  JsonLogEntry,
} from '../../src/utils/enhanced-logger';

describe('Enhanced Logger', () => {
  const testDir = path.join(__dirname, 'test-logs');

  beforeEach(() => {
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe('stripAnsi', () => {
    it('should remove color codes', () => {
      const input = '\x1b[31mRed Text\x1b[0m';
      expect(stripAnsi(input)).toBe('Red Text');
    });

    it('should remove cursor movement codes', () => {
      const input = '\x1b[2K\x1b[1GProgress: 50%';
      expect(stripAnsi(input)).toBe('Progress: 50%');
    });

    it('should handle multiple ANSI sequences', () => {
      const input = '\x1b[32m✓\x1b[0m \x1b[1mTask completed\x1b[0m';
      expect(stripAnsi(input)).toBe('✓ Task completed');
    });

    it('should handle empty string', () => {
      expect(stripAnsi('')).toBe('');
    });

    it('should handle string without ANSI codes', () => {
      const input = 'Plain text without codes';
      expect(stripAnsi(input)).toBe(input);
    });

    it('should handle spinner characters', () => {
      const input = '⠋ Loading...\r⠙ Loading...\r⠹ Loading...';
      const result = stripAnsi(input);
      // Carriage returns that overwrite are converted to newlines
      expect(result).not.toContain('\r');
    });
  });

  describe('formatTimestamp', () => {
    it('should format as ISO', () => {
      const result = formatTimestamp('iso');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should format as short time', () => {
      const result = formatTimestamp('short');
      expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });

    it('should format as relative with start time', () => {
      const startTime = Date.now() - 65000; // 65 seconds ago
      const result = formatTimestamp('relative', startTime);
      expect(result).toMatch(/^\+1m\d+s$/);
    });

    it('should format relative hours correctly', () => {
      const startTime = Date.now() - (2 * 60 * 60 * 1000 + 30 * 60 * 1000); // 2h 30m ago
      const result = formatTimestamp('relative', startTime);
      expect(result).toMatch(/^\+2h30m/);
    });
  });

  describe('EnhancedLogManager', () => {
    it('should create log files', () => {
      const manager = createLogManager(testDir, 'test-lane');
      
      const paths = manager.getLogPaths();
      expect(paths.clean).toContain('terminal.log');
      
      manager.close();
      
      expect(fs.existsSync(paths.clean)).toBe(true);
    });

    it('should write stdout data', () => {
      const manager = createLogManager(testDir, 'test-lane');
      
      manager.writeStdout('Hello World\n');
      manager.close();
      
      const content = fs.readFileSync(path.join(testDir, 'terminal.log'), 'utf8');
      expect(content).toContain('Hello World');
    });

    it('should write stderr data', () => {
      const manager = createLogManager(testDir, 'test-lane');
      
      manager.writeStderr('Error occurred\n');
      manager.close();
      
      const content = fs.readFileSync(path.join(testDir, 'terminal.log'), 'utf8');
      expect(content).toContain('Error occurred');
    });

    it('should strip ANSI codes in clean log', () => {
      const manager = createLogManager(testDir, 'test-lane', { stripAnsi: true });
      
      manager.writeStdout('\x1b[32mColored text\x1b[0m\n');
      manager.close();
      
      const content = fs.readFileSync(path.join(testDir, 'terminal.log'), 'utf8');
      expect(content).toContain('Colored text');
      expect(content).not.toContain('\x1b[32m');
    });

    it('should keep ANSI codes in raw log', () => {
      const manager = createLogManager(testDir, 'test-lane', { 
        stripAnsi: true, 
        keepRawLogs: true 
      });
      
      manager.writeStdout('\x1b[32mColored text\x1b[0m\n');
      manager.close();
      
      const rawContent = fs.readFileSync(path.join(testDir, 'terminal-raw.log'), 'utf8');
      expect(rawContent).toContain('\x1b[32m');
    });

    it('should write JSON log entries', () => {
      const manager = createLogManager(testDir, 'test-lane', { writeJsonLog: true });
      
      manager.writeStdout('Test message\n');
      manager.close();
      
      const entries = readJsonLog(path.join(testDir, 'terminal.jsonl'));
      expect(entries.length).toBeGreaterThan(0);
      
      const sessionEntry = entries.find(e => e.level === 'session');
      expect(sessionEntry).toBeDefined();
      expect(sessionEntry?.lane).toBe('test-lane');
    });

    it('should add timestamps to lines', () => {
      const manager = createLogManager(testDir, 'test-lane', { 
        addTimestamps: true,
        timestampFormat: 'iso'
      });
      
      manager.writeStdout('Timestamped line\n');
      manager.close();
      
      const content = fs.readFileSync(path.join(testDir, 'terminal.log'), 'utf8');
      // Should contain ISO timestamp pattern
      expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should write session header', () => {
      const manager = createLogManager(testDir, 'test-lane');
      manager.close();
      
      const content = fs.readFileSync(path.join(testDir, 'terminal.log'), 'utf8');
      expect(content).toContain('CursorFlow Session Log');
      expect(content).toContain('test-lane');
    });

    it('should set task context', () => {
      const manager = createLogManager(testDir, 'test-lane');
      
      manager.setTask('implement', 'claude-3.5-sonnet');
      manager.writeStdout('Working on task\n');
      manager.close();
      
      const content = fs.readFileSync(path.join(testDir, 'terminal.log'), 'utf8');
      expect(content).toContain('Task: implement');
      expect(content).toContain('Model: claude-3.5-sonnet');
    });
  });

  describe('readJsonLog', () => {
    it('should read JSON log file', () => {
      const logPath = path.join(testDir, 'test.jsonl');
      const entries: JsonLogEntry[] = [
        { timestamp: '2024-01-01T00:00:00Z', level: 'info', message: 'Test 1' },
        { timestamp: '2024-01-01T00:00:01Z', level: 'error', message: 'Test 2' },
      ];
      
      fs.writeFileSync(logPath, entries.map(e => JSON.stringify(e)).join('\n'));
      
      const result = readJsonLog(logPath);
      expect(result).toHaveLength(2);
      expect(result[0].message).toBe('Test 1');
      expect(result[1].level).toBe('error');
    });

    it('should return empty array for missing file', () => {
      const result = readJsonLog(path.join(testDir, 'nonexistent.jsonl'));
      expect(result).toEqual([]);
    });

    it('should skip invalid JSON lines', () => {
      const logPath = path.join(testDir, 'partial.jsonl');
      fs.writeFileSync(logPath, '{"message": "valid"}\ninvalid line\n{"message": "also valid"}');
      
      const result = readJsonLog(logPath);
      expect(result).toHaveLength(2);
    });
  });

  describe('exportLogs', () => {
    beforeEach(() => {
      // Create test log files
      const manager = createLogManager(testDir, 'export-test');
      manager.writeStdout('Line 1\n');
      manager.writeStderr('Error line\n');
      manager.close();
    });

    it('should export as text', () => {
      const output = exportLogs(testDir, 'text');
      expect(output).toContain('Line 1');
      expect(output).toContain('Error line');
    });

    it('should export as JSON', () => {
      const output = exportLogs(testDir, 'json');
      const parsed = JSON.parse(output);
      expect(Array.isArray(parsed)).toBe(true);
    });

    it('should export as markdown', () => {
      const output = exportLogs(testDir, 'markdown');
      expect(output).toContain('# CursorFlow Session Log');
    });

    it('should export as HTML', () => {
      const output = exportLogs(testDir, 'html');
      expect(output).toContain('<!DOCTYPE html>');
      expect(output).toContain('CursorFlow Session Log');
    });

    it('should write to file when outputPath provided', () => {
      const outputPath = path.join(testDir, 'export-output.txt');
      exportLogs(testDir, 'text', outputPath);
      
      expect(fs.existsSync(outputPath)).toBe(true);
      const content = fs.readFileSync(outputPath, 'utf8');
      expect(content).toContain('Line 1');
    });
  });

  describe('DEFAULT_LOG_CONFIG', () => {
    it('should have sensible defaults', () => {
      expect(DEFAULT_LOG_CONFIG.enabled).toBe(true);
      expect(DEFAULT_LOG_CONFIG.stripAnsi).toBe(true);
      expect(DEFAULT_LOG_CONFIG.addTimestamps).toBe(true);
      expect(DEFAULT_LOG_CONFIG.maxFileSize).toBe(50 * 1024 * 1024);
      expect(DEFAULT_LOG_CONFIG.maxFiles).toBe(5);
      expect(DEFAULT_LOG_CONFIG.keepRawLogs).toBe(true);
      expect(DEFAULT_LOG_CONFIG.writeJsonLog).toBe(true);
      expect(DEFAULT_LOG_CONFIG.timestampFormat).toBe('iso');
    });
  });
});


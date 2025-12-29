/**
 * Tests for enhanced-logger utility
 */

import * as fs from 'fs';
import * as path from 'path';
import { 
  stripAnsi, 
  formatTimestamp, 
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
      expect(paths.jsonl).toContain('terminal.jsonl');
      
      manager.close();
      
      expect(fs.existsSync(paths.jsonl)).toBe(true);
    });

    it('should write stdout data', () => {
      const manager = createLogManager(testDir, 'test-lane');
      
      manager.writeStdout('Hello World\n');
      manager.close();
      
      const content = fs.readFileSync(path.join(testDir, 'terminal.jsonl'), 'utf8');
      expect(content).toContain('Hello World');
    });

    it('should write stderr data', () => {
      const manager = createLogManager(testDir, 'test-lane');
      
      manager.writeStderr('Error occurred\n');
      manager.close();
      
      const content = fs.readFileSync(path.join(testDir, 'terminal.jsonl'), 'utf8');
      expect(content).toContain('Error occurred');
    });

    it('should strip ANSI codes in log content', () => {
      const manager = createLogManager(testDir, 'test-lane', { stripAnsi: true });
      
      manager.writeStdout('\x1b[32mColored text\x1b[0m\n');
      manager.close();
      
      const content = fs.readFileSync(path.join(testDir, 'terminal.jsonl'), 'utf8');
      expect(content).toContain('Colored text');
      expect(content).not.toContain('\x1b[32m');
    });

    it('should add timestamps to entries', () => {
      const manager = createLogManager(testDir, 'test-lane', { 
        writeJsonLog: true,
      });
      
      manager.writeStdout('Timestamped line\n');
      manager.close();
      
      const content = fs.readFileSync(path.join(testDir, 'terminal.jsonl'), 'utf8');
      const entry = JSON.parse(content.split('\n').filter(l => l.includes('Timestamped line'))[0]);
      expect(entry.timestamp).toBeDefined();
      expect(entry.timestamp_iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should write session start entry', () => {
      const manager = createLogManager(testDir, 'test-lane');
      manager.close();
      
      const content = fs.readFileSync(path.join(testDir, 'terminal.jsonl'), 'utf8');
      expect(content).toContain('Session started');
      expect(content).toContain('test-lane');
    });

    it('should set task context', () => {
      const manager = createLogManager(testDir, 'test-lane');
      
      manager.setTask('implement', 'claude-3.5-sonnet');
      manager.writeStdout('Working on task\n');
      manager.close();
      
      const content = fs.readFileSync(path.join(testDir, 'terminal.jsonl'), 'utf8');
      expect(content).toContain('Task: implement');
      expect(content).toContain('claude-3.5-sonnet');
    });
  });

  describe('readJsonLog', () => {
    it('should read JSON log file', () => {
      const logPath = path.join(testDir, 'test.jsonl');
      const entries = [
        { timestamp: Date.now(), content: 'Line 1' },
        { timestamp: Date.now() + 100, content: 'Line 2' }
      ];
      fs.writeFileSync(logPath, entries.map(e => JSON.stringify(e)).join('\n'));
      
      const result = readJsonLog(logPath);
      expect(result.length).toBe(2);
      expect(result[0].content).toBe('Line 1');
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
      expect(parsed.some((l: any) => l.content === 'Line 1')).toBe(true);
    });

    it('should export as markdown (simplified)', () => {
      const output = exportLogs(testDir, 'markdown');
      expect(output).toContain('Line 1');
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
      expect(DEFAULT_LOG_CONFIG.writeJsonLog).toBe(true);
      expect(DEFAULT_LOG_CONFIG.timestampFormat).toBe('iso');
    });
  });
});
});


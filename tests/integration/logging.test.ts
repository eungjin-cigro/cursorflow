/**
 * Logging and State Tracking Tests
 * 
 * Tests log data management:
 * - JSONL log writing and reading
 * - Conversation log entries
 * - Git operation logs
 * - Event logs
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  appendLog,
  readLog,
  createConversationEntry,
  createGitLogEntry,
  createEventEntry,
  saveState,
  loadState,
  getLatestRunDir,
  listLanesInRun,
} from '../../src/utils/state';

describe('JSONL Logging', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logging-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('appendLog / readLog', () => {
    test('should append entries to JSONL file', () => {
      const logPath = path.join(tempDir, 'test.jsonl');

      appendLog(logPath, { id: 1, message: 'First entry' });
      appendLog(logPath, { id: 2, message: 'Second entry' });
      appendLog(logPath, { id: 3, message: 'Third entry' });

      const entries = readLog(logPath);
      expect(entries).toHaveLength(3);
      expect(entries[0].id).toBe(1);
      expect(entries[2].message).toBe('Third entry');
    });

    test('should create directory if not exists', () => {
      const logPath = path.join(tempDir, 'nested', 'dir', 'test.jsonl');

      appendLog(logPath, { data: 'test' });

      expect(fs.existsSync(logPath)).toBe(true);
    });

    test('should return empty array for non-existent file', () => {
      const logPath = path.join(tempDir, 'nonexistent.jsonl');

      const entries = readLog(logPath);
      expect(entries).toEqual([]);
    });

    test('should handle concurrent writes', async () => {
      const logPath = path.join(tempDir, 'concurrent.jsonl');

      // Simulate concurrent writes
      const writes = Array.from({ length: 10 }, (_, i) =>
        Promise.resolve().then(() => appendLog(logPath, { index: i }))
      );

      await Promise.all(writes);

      const entries = readLog(logPath);
      expect(entries).toHaveLength(10);
    });
  });

  describe('Conversation Log Entries', () => {
    test('should create user entry', () => {
      const entry = createConversationEntry('user', 'Hello, agent!', {
        task: 'task-1',
      });

      expect(entry.role).toBe('user');
      expect(entry.fullText).toBe('Hello, agent!');
      expect(entry.textLength).toBe(13);
      expect(entry.task).toBe('task-1');
      expect(entry.timestamp).toBeDefined();
    });

    test('should create assistant entry with model', () => {
      const entry = createConversationEntry('assistant', 'I will help you.', {
        task: 'task-1',
        model: 'claude-3-opus',
      });

      expect(entry.role).toBe('assistant');
      expect(entry.model).toBe('claude-3-opus');
    });

    test('should create system entry', () => {
      const entry = createConversationEntry('system', 'System message');

      expect(entry.role).toBe('system');
      expect(entry.task).toBeNull();
      expect(entry.model).toBeNull();
    });

    test('should create intervention entry', () => {
      const entry = createConversationEntry('intervention', 'Please continue', {
        task: 'task-2',
      });

      expect(entry.role).toBe('intervention');
    });
  });

  describe('Git Operation Logs', () => {
    test('should create git log entry', () => {
      const entry = createGitLogEntry('commit', {
        hash: 'abc123',
        message: 'feat: add feature',
        branch: 'feature/test',
      });

      expect(entry.operation).toBe('commit');
      expect(entry.hash).toBe('abc123');
      expect(entry.timestamp).toBeDefined();
    });

    test('should log worktree operations', () => {
      const entry = createGitLogEntry('worktree_create', {
        path: '/tmp/worktree',
        branch: 'cursorflow/lane-1',
      });

      expect(entry.operation).toBe('worktree_create');
      expect(entry.path).toBe('/tmp/worktree');
    });

    test('should log merge operations', () => {
      const entry = createGitLogEntry('merge', {
        sourceBranch: 'feature/task-1',
        targetBranch: 'main',
        result: 'success',
      });

      expect(entry.result).toBe('success');
    });
  });

  describe('Event Logs', () => {
    test('should create event entry', () => {
      const entry = createEventEntry('lane.started', {
        laneName: 'lane-1',
        taskCount: 3,
      });

      expect(entry.event).toBe('lane.started');
      expect(entry.laneName).toBe('lane-1');
      expect(entry.timestamp).toBeDefined();
    });

    test('should log task events', () => {
      const entry = createEventEntry('task.completed', {
        laneName: 'lane-1',
        taskName: 'task-1',
        duration: 5000,
        result: 'success',
      });

      expect(entry.event).toBe('task.completed');
      expect(entry.duration).toBe(5000);
    });
  });

  describe('Structured Log Storage', () => {
    test('should write conversation log to lane directory', () => {
      const laneDir = path.join(tempDir, 'runs', 'run-1', 'lanes', 'lane-1');
      fs.mkdirSync(laneDir, { recursive: true });

      const convoPath = path.join(laneDir, 'conversation.jsonl');

      appendLog(convoPath, createConversationEntry('user', 'Task prompt'));
      appendLog(convoPath, createConversationEntry('assistant', 'Working on it...'));
      appendLog(convoPath, createConversationEntry('assistant', 'Done!'));

      const entries = readLog(convoPath);
      expect(entries).toHaveLength(3);
      expect(entries.filter(e => e.role === 'assistant')).toHaveLength(2);
    });

    test('should organize logs by run and lane', () => {
      const runDir = path.join(tempDir, 'runs', 'run-123');
      const lane1Dir = path.join(runDir, 'lanes', 'lane-1');
      const lane2Dir = path.join(runDir, 'lanes', 'lane-2');

      fs.mkdirSync(lane1Dir, { recursive: true });
      fs.mkdirSync(lane2Dir, { recursive: true });

      // Lane 1 logs
      appendLog(path.join(lane1Dir, 'conversation.jsonl'), { role: 'user', text: 'lane1' });
      saveState(path.join(lane1Dir, 'state.json'), { label: 'lane-1', status: 'running' });

      // Lane 2 logs
      appendLog(path.join(lane2Dir, 'conversation.jsonl'), { role: 'user', text: 'lane2' });
      saveState(path.join(lane2Dir, 'state.json'), { label: 'lane-2', status: 'pending' });

      // Verify structure
      const lanesDir = path.join(runDir, 'lanes');
      const lanes = listLanesInRun(lanesDir);
      expect(lanes).toHaveLength(2);
      expect(lanes.map(l => l.name)).toContain('lane-1');
      expect(lanes.map(l => l.name)).toContain('lane-2');
    });
  });
});

describe('Run Directory Management', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-dir-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  test('should find latest run directory', () => {
    const logsDir = path.join(tempDir, 'logs');
    
    // Create multiple run directories
    fs.mkdirSync(path.join(logsDir, 'run-2024-01-01'), { recursive: true });
    fs.mkdirSync(path.join(logsDir, 'run-2024-01-02'), { recursive: true });
    fs.mkdirSync(path.join(logsDir, 'run-2024-01-03'), { recursive: true });

    const latest = getLatestRunDir(logsDir);
    expect(latest).toContain('run-2024-01-03');
  });

  test('should return null for empty logs directory', () => {
    const logsDir = path.join(tempDir, 'empty-logs');
    fs.mkdirSync(logsDir, { recursive: true });

    const latest = getLatestRunDir(logsDir);
    expect(latest).toBeNull();
  });

  test('should list lanes in run directory', () => {
    const runDir = path.join(tempDir, 'run-test');
    
    // Create lane directories
    fs.mkdirSync(path.join(runDir, 'lane-a'), { recursive: true });
    fs.mkdirSync(path.join(runDir, 'lane-b'), { recursive: true });
    fs.mkdirSync(path.join(runDir, 'lane-c'), { recursive: true });

    // Create state files
    saveState(path.join(runDir, 'lane-a', 'state.json'), { label: 'lane-a' });
    saveState(path.join(runDir, 'lane-b', 'state.json'), { label: 'lane-b' });
    // lane-c has no state file

    const lanes = listLanesInRun(runDir);
    expect(lanes).toHaveLength(3);
  });
});

describe('Log Analysis Utilities', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-analysis-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  test('should calculate conversation statistics', () => {
    const logPath = path.join(tempDir, 'conversation.jsonl');

    appendLog(logPath, createConversationEntry('user', 'Short'));
    appendLog(logPath, createConversationEntry('assistant', 'A'.repeat(1000)));
    appendLog(logPath, createConversationEntry('user', 'Medium length message here'));
    appendLog(logPath, createConversationEntry('assistant', 'B'.repeat(2000)));

    const entries = readLog(logPath);
    
    const userEntries = entries.filter(e => e.role === 'user');
    const assistantEntries = entries.filter(e => e.role === 'assistant');
    
    const totalUserChars = userEntries.reduce((sum, e) => sum + e.textLength, 0);
    const totalAssistantChars = assistantEntries.reduce((sum, e) => sum + e.textLength, 0);

    expect(userEntries).toHaveLength(2);
    expect(assistantEntries).toHaveLength(2);
    expect(totalAssistantChars).toBeGreaterThan(totalUserChars);
  });

  test('should filter logs by time range', () => {
    const logPath = path.join(tempDir, 'events.jsonl');
    const now = Date.now();

    // Create entries with specific timestamps
    appendLog(logPath, { ...createEventEntry('event1', {}), _ts: now - 60000 }); // 1 min ago
    appendLog(logPath, { ...createEventEntry('event2', {}), _ts: now - 30000 }); // 30s ago
    appendLog(logPath, { ...createEventEntry('event3', {}), _ts: now - 10000 }); // 10s ago

    const entries = readLog(logPath);
    
    // Filter last 45 seconds
    const recent = entries.filter(e => e._ts && e._ts > now - 45000);
    expect(recent).toHaveLength(2);
  });
});


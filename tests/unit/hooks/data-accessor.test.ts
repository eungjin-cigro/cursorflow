/**
 * Data Accessor Unit Tests
 * 
 * HookDataAccessor의 데이터 접근 기능을 테스트합니다.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  HookDataAccessorImpl,
  createDataAccessor,
  DataAccessorOptions,
} from '../../../src/hooks';

describe('HookDataAccessor', () => {
  let tempDir: string;
  let options: DataAccessorOptions;
  
  beforeEach(() => {
    // 임시 디렉토리 생성
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'data-accessor-test-'));
    
    options = {
      worktreeDir: tempDir,
      runDir: tempDir,
      taskBranch: 'test-task-branch',
      pipelineBranch: 'test-pipeline-branch',
      laneName: 'test-lane',
      taskName: 'test-task',
      completedTasks: [
        { name: 'completed-task-1', status: 'success', duration: 5000 },
        { name: 'completed-task-2', status: 'success', duration: 3000 },
      ],
      pendingTasks: [
        { name: 'pending-task-1', prompt: 'Pending 1' },
        { name: 'pending-task-2', prompt: 'Pending 2' },
      ],
      dependencyResults: [
        { taskName: 'dep-task', laneName: 'other-lane', status: 'success' },
      ],
      taskStartTime: Date.now() - 10000,
      laneStartTime: Date.now() - 60000,
    };
  });
  
  afterEach(() => {
    // 임시 디렉토리 정리
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });
  
  describe('Git Data Access', () => {
    it('should return current branch', () => {
      const accessor = createDataAccessor(options);
      
      expect(accessor.git.getCurrentBranch()).toBe('test-task-branch');
    });
    
    it('should return empty array when git commands fail', async () => {
      const accessor = createDataAccessor(options);
      
      // worktreeDir이 git repo가 아니므로 빈 배열 반환
      const files = await accessor.git.getChangedFiles();
      expect(files).toEqual([]);
      
      const conflicts = await accessor.git.getConflictFiles();
      expect(conflicts).toEqual([]);
      
      const commits = await accessor.git.getRecentCommits();
      expect(commits).toEqual([]);
    });
    
    it('should return empty string for diff when git fails', async () => {
      const accessor = createDataAccessor(options);
      
      const diff = await accessor.git.getDiff();
      expect(diff).toBe('');
    });
  });
  
  describe('Conversation Data Access', () => {
    it('should return empty messages when no conversation file', async () => {
      const accessor = createDataAccessor(options);
      
      const messages = await accessor.conversation.getAllMessages();
      expect(messages).toEqual([]);
    });
    
    it('should parse conversation.jsonl correctly', async () => {
      const convoPath = path.join(tempDir, 'conversation.jsonl');
      const messages = [
        { role: 'user', content: 'Hello', timestamp: '2024-01-01T00:00:00Z', task: 'test-task' },
        { role: 'assistant', content: 'Hi there!', timestamp: '2024-01-01T00:00:01Z', task: 'test-task' },
        { role: 'user', content: 'Another message', timestamp: '2024-01-01T00:00:02Z', task: 'other-task' },
      ];
      fs.writeFileSync(convoPath, messages.map(m => JSON.stringify(m)).join('\n'));
      
      const accessor = createDataAccessor(options);
      
      const allMessages = await accessor.conversation.getAllMessages();
      expect(allMessages.length).toBe(3);
      expect(allMessages[0].role).toBe('user');
      expect(allMessages[1].content).toBe('Hi there!');
      
      const taskMessages = await accessor.conversation.getCurrentTaskMessages();
      expect(taskMessages.length).toBe(2);
      expect(taskMessages.every(m => m.taskName === 'test-task')).toBe(true);
      
      const recentMessages = await accessor.conversation.getRecentMessages(2);
      expect(recentMessages.length).toBe(2);
      expect(recentMessages[1].content).toBe('Another message');
      
      const lastResponse = await accessor.conversation.getLastResponse();
      expect(lastResponse).toBe('Hi there!');
    });
    
    it('should handle invalid JSON lines gracefully', async () => {
      const convoPath = path.join(tempDir, 'conversation.jsonl');
      fs.writeFileSync(convoPath, '{"role":"user","content":"Valid"}\ninvalid json\n{"role":"assistant","content":"Also valid"}');
      
      const accessor = createDataAccessor(options);
      
      const messages = await accessor.conversation.getAllMessages();
      expect(messages.length).toBe(2);
    });
  });
  
  describe('Tasks Data Access', () => {
    it('should return completed tasks', () => {
      const accessor = createDataAccessor(options);
      
      const completed = accessor.tasks.getCompletedTasks();
      expect(completed.length).toBe(2);
      expect(completed[0].name).toBe('completed-task-1');
    });
    
    it('should return pending tasks', () => {
      const accessor = createDataAccessor(options);
      
      const pending = accessor.tasks.getPendingTasks();
      expect(pending.length).toBe(2);
      expect(pending[0].name).toBe('pending-task-1');
    });
    
    it('should get specific task result', () => {
      const accessor = createDataAccessor(options);
      
      const result = accessor.tasks.getTaskResult('completed-task-1');
      expect(result).not.toBeNull();
      expect(result?.status).toBe('success');
      
      const notFound = accessor.tasks.getTaskResult('non-existent');
      expect(notFound).toBeNull();
    });
    
    it('should return dependency results', () => {
      const accessor = createDataAccessor(options);
      
      const deps = accessor.tasks.getDependencyResults();
      expect(deps.length).toBe(1);
      expect(deps[0].taskName).toBe('dep-task');
    });
  });
  
  describe('Logs Data Access', () => {
    it('should return empty string when no log files', async () => {
      const accessor = createDataAccessor(options);
      
      const output = await accessor.logs.getRawOutput();
      expect(output).toBe('');
    });
    
    it('should read terminal-raw.log', async () => {
      const logPath = path.join(tempDir, 'terminal-raw.log');
      fs.writeFileSync(logPath, 'Line 1\nLine 2\nLine 3');
      
      const accessor = createDataAccessor(options);
      
      const output = await accessor.logs.getRawOutput();
      expect(output).toBe('Line 1\nLine 2\nLine 3');
    });
    
    it('should parse tool calls from JSONL output', async () => {
      const logPath = path.join(tempDir, 'terminal-raw.log');
      const logs = [
        'Regular log line',
        JSON.stringify({ type: 'tool_call', name: 'read_file', parameters: { path: 'test.ts' }, timestamp: '2024-01-01T00:00:00Z' }),
        JSON.stringify({ type: 'text', content: 'Some text' }),
        JSON.stringify({ type: 'tool_call', name: 'write', parameters: { path: 'out.ts' }, result: 'success', timestamp: '2024-01-01T00:00:01Z' }),
      ].join('\n');
      fs.writeFileSync(logPath, logs);
      
      const accessor = createDataAccessor(options);
      
      const toolCalls = await accessor.logs.getToolCalls();
      expect(toolCalls.length).toBe(2);
      expect(toolCalls[0].name).toBe('read_file');
      expect(toolCalls[1].name).toBe('write');
      expect(toolCalls[1].result).toBe('success');
    });
    
    it('should extract errors from logs', async () => {
      const logPath = path.join(tempDir, 'terminal-raw.log');
      fs.writeFileSync(logPath, 'Normal line\nError: Something failed\nWarning: Check this\nAnother normal line');
      
      const accessor = createDataAccessor(options);
      
      const errors = await accessor.logs.getErrors();
      expect(errors.length).toBe(2);
      expect(errors[0].level).toBe('error');
      expect(errors[0].message).toContain('Error: Something failed');
      expect(errors[1].level).toBe('warn');
    });
  });
  
  describe('Timing Data Access', () => {
    it('should return task and lane start times', () => {
      const accessor = createDataAccessor(options);
      
      expect(accessor.timing.taskStartTime).toBe(options.taskStartTime);
      expect(accessor.timing.laneStartTime).toBe(options.laneStartTime);
    });
    
    it('should calculate elapsed time', () => {
      const accessor = createDataAccessor(options);
      
      const elapsed = accessor.timing.getElapsedTime();
      expect(elapsed).toBeGreaterThanOrEqual(10000);
      expect(elapsed).toBeLessThan(20000);
    });
  });
  
  describe('Cache Management', () => {
    it('should cache results', async () => {
      const convoPath = path.join(tempDir, 'conversation.jsonl');
      fs.writeFileSync(convoPath, JSON.stringify({ role: 'user', content: 'Test' }));
      
      const accessor = createDataAccessor(options) as HookDataAccessorImpl;
      
      // First call
      const messages1 = await accessor.conversation.getAllMessages();
      
      // 파일 수정
      fs.writeFileSync(convoPath, JSON.stringify({ role: 'user', content: 'Modified' }));
      
      // Second call should return cached result
      const messages2 = await accessor.conversation.getAllMessages();
      
      expect(messages1).toBe(messages2);
      expect(messages1[0].content).toBe('Test');
    });
    
    it('should clear cache', async () => {
      const convoPath = path.join(tempDir, 'conversation.jsonl');
      fs.writeFileSync(convoPath, JSON.stringify({ role: 'user', content: 'Test' }));
      
      const accessor = createDataAccessor(options) as HookDataAccessorImpl;
      
      // First call
      await accessor.conversation.getAllMessages();
      
      // 파일 수정
      fs.writeFileSync(convoPath, JSON.stringify({ role: 'user', content: 'Modified' }));
      
      // Clear cache
      accessor.clearCache();
      
      // Should read new data
      const messages = await accessor.conversation.getAllMessages();
      expect(messages[0].content).toBe('Modified');
    });
  });
  
  describe('Factory Function', () => {
    it('should create accessor instance', () => {
      const accessor = createDataAccessor(options);
      
      expect(accessor).toBeDefined();
      expect(accessor.git).toBeDefined();
      expect(accessor.conversation).toBeDefined();
      expect(accessor.tasks).toBeDefined();
      expect(accessor.logs).toBeDefined();
      expect(accessor.timing).toBeDefined();
    });
  });
});


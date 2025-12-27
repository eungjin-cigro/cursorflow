/**
 * Hook System Integration Tests
 * 
 * Hook 시스템의 전체적인 통합 동작을 테스트합니다.
 * 실제 파일 시스템과 상호작용하며, Hook이 올바르게 등록되고 실행되는지 검증합니다.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  HookManager,
  HookPoint,
  resetHookManager,
  createBeforeTaskContext,
  createAfterTaskContext,
  createOnErrorContext,
  createOnLaneEndContext,
  BaseContextOptions,
  FlowAbortError,
  FlowRetryError,
} from '../../src/hooks';

describe('Hook System Integration', () => {
  let hookManager: HookManager;
  let tempDir: string;
  let tasksFile: string;
  let baseOptions: BaseContextOptions;
  
  beforeEach(() => {
    // HookManager 리셋
    resetHookManager();
    hookManager = HookManager.getInstance();
    
    // 임시 디렉토리 및 파일 생성
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-integration-'));
    tasksFile = path.join(tempDir, 'tasks.json');
    
    const initialTasks = [
      { name: 'task-1', prompt: 'Task 1 prompt' },
      { name: 'task-2', prompt: 'Task 2 prompt' },
      { name: 'task-3', prompt: 'Task 3 prompt' },
    ];
    fs.writeFileSync(tasksFile, JSON.stringify({ tasks: initialTasks }, null, 2));
    
    baseOptions = {
      laneName: 'test-lane',
      runId: 'test-run-123',
      taskIndex: 0,
      totalTasks: 3,
      task: {
        name: 'task-1',
        prompt: 'Task 1 prompt',
        model: 'claude-sonnet-4-20250514',
      },
      worktreeDir: tempDir,
      runDir: tempDir,
      taskBranch: 'test-task-branch',
      pipelineBranch: 'test-pipeline',
      tasksFile,
      chatId: 'test-chat',
      tasks: initialTasks,
      completedTasks: [],
      dependencyResults: [],
      taskStartTime: Date.now(),
      laneStartTime: Date.now() - 60000,
    };
  });
  
  afterEach(() => {
    resetHookManager();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });
  
  describe('beforeTask Hook Integration', () => {
    it('should allow modifying task prompt', async () => {
      hookManager.register({
        point: HookPoint.BEFORE_TASK,
        mode: 'sync',
        name: 'prompt-modifier',
        handler: async (ctx) => {
          ctx.flow.modifyCurrentPrompt('Modified: ' + ctx.task.prompt);
        },
      });
      
      const { context, flowController } = createBeforeTaskContext(baseOptions);
      await hookManager.executeBeforeTask(context);
      
      const modifiedPrompt = flowController.getModifiedPrompt();
      expect(modifiedPrompt).toBe('Modified: Task 1 prompt');
    });
    
    it('should allow injecting a task', async () => {
      hookManager.register({
        point: HookPoint.BEFORE_TASK,
        mode: 'sync',
        name: 'task-injector',
        handler: async (ctx) => {
          ctx.flow.injectTask({
            name: 'pre-check',
            prompt: 'Run pre-check before main task',
          });
        },
      });
      
      const { context } = createBeforeTaskContext(baseOptions);
      await hookManager.executeBeforeTask(context);
      
      // tasks 배열에 태스크가 추가되었는지 확인
      expect(baseOptions.tasks.length).toBe(4);
      expect(baseOptions.tasks[1].name).toBe('pre-check');
    });
    
    it('should throw FlowAbortError when abort is called', async () => {
      hookManager.register({
        point: HookPoint.BEFORE_TASK,
        mode: 'sync',
        handler: async (ctx) => {
          ctx.flow.abort('Precondition failed');
        },
      });
      
      const { context } = createBeforeTaskContext(baseOptions);
      
      await expect(hookManager.executeBeforeTask(context)).rejects.toThrow(FlowAbortError);
    });
  });
  
  describe('afterTask Hook Integration', () => {
    it('should receive task result in context', async () => {
      let receivedResult: any;
      
      hookManager.register({
        point: HookPoint.AFTER_TASK,
        mode: 'sync',
        handler: async (ctx: any) => {
          receivedResult = ctx.result;
        },
      });
      
      const { context } = createAfterTaskContext(baseOptions, {
        status: 'success',
        exitCode: 0,
      });
      
      await hookManager.executeAfterTask(context);
      
      expect(receivedResult.status).toBe('success');
      expect(receivedResult.exitCode).toBe(0);
    });
    
    it('should allow retry request', async () => {
      hookManager.register({
        point: HookPoint.AFTER_TASK,
        mode: 'sync',
        handler: async (ctx: any) => {
          if (ctx.result.status === 'error') {
            ctx.flow.retry({ modifiedPrompt: 'Please try again' });
          }
        },
      });
      
      const { context } = createAfterTaskContext(baseOptions, {
        status: 'error',
        error: 'Something went wrong',
      });
      
      await expect(hookManager.executeAfterTask(context)).rejects.toThrow(FlowRetryError);
    });
    
    it('should access completed tasks', async () => {
      baseOptions.completedTasks = [
        { name: 'prev-task', status: 'success', duration: 5000 },
      ];
      
      let accessedCompletedTasks: any[];
      
      hookManager.register({
        point: HookPoint.AFTER_TASK,
        mode: 'sync',
        handler: async (ctx) => {
          accessedCompletedTasks = ctx.getData.tasks.getCompletedTasks();
        },
      });
      
      const { context } = createAfterTaskContext(baseOptions, { status: 'success' });
      await hookManager.executeAfterTask(context);
      
      expect(accessedCompletedTasks!.length).toBe(1);
      expect(accessedCompletedTasks![0].name).toBe('prev-task');
    });
  });
  
  describe('onError Hook Integration', () => {
    it('should receive error information', async () => {
      let receivedError: any;
      
      hookManager.register({
        point: HookPoint.ON_ERROR,
        mode: 'sync',
        handler: async (ctx: any) => {
          receivedError = ctx.error;
        },
      });
      
      const { context } = createOnErrorContext(baseOptions, {
        type: 'agent_error',
        message: 'Agent crashed',
        retryable: true,
      });
      
      await hookManager.executeOnError(context);
      
      expect(receivedError.type).toBe('agent_error');
      expect(receivedError.message).toBe('Agent crashed');
      expect(receivedError.retryable).toBe(true);
    });
    
    it('should allow error recovery through retry', async () => {
      hookManager.register({
        point: HookPoint.ON_ERROR,
        mode: 'sync',
        handler: async (ctx: any) => {
          if (ctx.error.retryable) {
            ctx.flow.retry({ modifiedPrompt: 'Recovery prompt' });
          }
        },
      });
      
      const { context } = createOnErrorContext(baseOptions, {
        type: 'timeout',
        message: 'Request timed out',
        retryable: true,
      });
      
      try {
        await hookManager.executeOnError(context);
        fail('Should have thrown FlowRetryError');
      } catch (e) {
        expect(e).toBeInstanceOf(FlowRetryError);
        expect((e as FlowRetryError).modifiedPrompt).toBe('Recovery prompt');
      }
    });
  });
  
  describe('onLaneEnd Hook Integration', () => {
    it('should receive lane summary', async () => {
      let receivedSummary: any;
      
      hookManager.register({
        point: HookPoint.ON_LANE_END,
        mode: 'sync',
        handler: async (ctx: any) => {
          receivedSummary = ctx.summary;
        },
      });
      
      const { context } = createOnLaneEndContext(baseOptions, {
        status: 'completed',
        completedTasks: 3,
        failedTasks: 0,
        totalDuration: 120000,
      });
      
      await hookManager.executeOnLaneEnd(context);
      
      expect(receivedSummary.status).toBe('completed');
      expect(receivedSummary.completedTasks).toBe(3);
      expect(receivedSummary.totalDuration).toBe(120000);
    });
    
    it('should run async hooks without blocking', async () => {
      let asyncExecuted = false;
      
      hookManager.register({
        point: HookPoint.ON_LANE_END,
        mode: 'async',
        handler: async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          asyncExecuted = true;
        },
      });
      
      const { context } = createOnLaneEndContext(baseOptions, {
        status: 'completed',
        completedTasks: 3,
        failedTasks: 0,
        totalDuration: 120000,
      });
      
      // 즉시 반환되어야 함
      const startTime = Date.now();
      const results = await hookManager.executeOnLaneEnd(context);
      const executionTime = Date.now() - startTime;
      
      // async hook은 결과를 반환하지 않음
      expect(results.length).toBe(0);
      expect(executionTime).toBeLessThan(50);
      
      // 잠시 대기 후 async hook이 실행되었는지 확인
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(asyncExecuted).toBe(true);
    });
  });
  
  describe('Multiple Hooks Execution', () => {
    it('should execute hooks in priority order', async () => {
      const executionOrder: string[] = [];
      
      hookManager.register({
        point: HookPoint.BEFORE_TASK,
        mode: 'sync',
        name: 'low-priority',
        priority: 100,
        handler: async () => { executionOrder.push('low'); },
      });
      
      hookManager.register({
        point: HookPoint.BEFORE_TASK,
        mode: 'sync',
        name: 'high-priority',
        priority: 10,
        handler: async () => { executionOrder.push('high'); },
      });
      
      hookManager.register({
        point: HookPoint.BEFORE_TASK,
        mode: 'sync',
        name: 'medium-priority',
        priority: 50,
        handler: async () => { executionOrder.push('medium'); },
      });
      
      const { context } = createBeforeTaskContext(baseOptions);
      await hookManager.executeBeforeTask(context);
      
      expect(executionOrder).toEqual(['high', 'medium', 'low']);
    });
    
    it('should pass data between hooks through context', async () => {
      hookManager.register({
        point: HookPoint.BEFORE_TASK,
        mode: 'sync',
        name: 'first-hook',
        priority: 10,
        handler: async (ctx) => {
          ctx.flow.modifyCurrentPrompt('Step 1: ' + ctx.task.prompt);
        },
      });
      
      hookManager.register({
        point: HookPoint.BEFORE_TASK,
        mode: 'sync',
        name: 'second-hook',
        priority: 20,
        handler: async (ctx) => {
          // 이전 hook의 수정사항은 flowController.getModifiedPrompt()로 확인 가능
          // 하지만 ctx.task.prompt는 원본 유지
          ctx.flow.injectTask({
            name: 'validation',
            prompt: 'Validate result of: ' + ctx.task.name,
          });
        },
      });
      
      const { context, flowController } = createBeforeTaskContext(baseOptions);
      await hookManager.executeBeforeTask(context);
      
      expect(flowController.getModifiedPrompt()).toBe('Step 1: Task 1 prompt');
      expect(baseOptions.tasks.length).toBe(4);
    });
  });
  
  describe('Data Accessor Integration', () => {
    it('should access conversation history', async () => {
      // conversation.jsonl 생성
      const convoPath = path.join(tempDir, 'conversation.jsonl');
      const messages = [
        { role: 'user', content: 'Hello', timestamp: new Date().toISOString(), task: 'task-1' },
        { role: 'assistant', content: 'Hi there!', timestamp: new Date().toISOString(), task: 'task-1' },
      ];
      fs.writeFileSync(convoPath, messages.map(m => JSON.stringify(m)).join('\n'));
      
      let lastResponse: string | null = null;
      
      hookManager.register({
        point: HookPoint.AFTER_TASK,
        mode: 'sync',
        handler: async (ctx) => {
          lastResponse = await ctx.getData.conversation.getLastResponse();
        },
      });
      
      const { context } = createAfterTaskContext(baseOptions, { status: 'success' });
      await hookManager.executeAfterTask(context);
      
      expect(lastResponse).toBe('Hi there!');
    });
    
    it('should access timing information', async () => {
      let elapsedTime: number = 0;
      
      hookManager.register({
        point: HookPoint.AFTER_TASK,
        mode: 'sync',
        handler: async (ctx) => {
          elapsedTime = ctx.getData.timing.getElapsedTime();
        },
      });
      
      // 약간의 지연
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const { context } = createAfterTaskContext(baseOptions, { status: 'success' });
      await hookManager.executeAfterTask(context);
      
      expect(elapsedTime).toBeGreaterThan(0);
    });
  });
  
  describe('Error Handling', () => {
    it('should continue execution with continueOnError=true', async () => {
      hookManager.configure({ continueOnError: true });
      
      const executionOrder: string[] = [];
      
      hookManager.register({
        point: HookPoint.BEFORE_TASK,
        mode: 'sync',
        name: 'first',
        priority: 10,
        handler: async () => { executionOrder.push('first'); },
      });
      
      hookManager.register({
        point: HookPoint.BEFORE_TASK,
        mode: 'sync',
        name: 'error',
        priority: 20,
        handler: async () => { throw new Error('Intentional error'); },
      });
      
      hookManager.register({
        point: HookPoint.BEFORE_TASK,
        mode: 'sync',
        name: 'third',
        priority: 30,
        handler: async () => { executionOrder.push('third'); },
      });
      
      const { context } = createBeforeTaskContext(baseOptions);
      const results = await hookManager.executeBeforeTask(context);
      
      expect(executionOrder).toEqual(['first', 'third']);
      expect(results.length).toBe(3);
      expect(results[1].success).toBe(false);
      expect(results[1].error?.message).toBe('Intentional error');
    });
    
    it('should stop execution with continueOnError=false', async () => {
      hookManager.configure({ continueOnError: false });
      
      const executionOrder: string[] = [];
      
      hookManager.register({
        point: HookPoint.BEFORE_TASK,
        mode: 'sync',
        name: 'first',
        priority: 10,
        handler: async () => { executionOrder.push('first'); },
      });
      
      hookManager.register({
        point: HookPoint.BEFORE_TASK,
        mode: 'sync',
        name: 'error',
        priority: 20,
        handler: async () => { throw new Error('Stop here'); },
      });
      
      hookManager.register({
        point: HookPoint.BEFORE_TASK,
        mode: 'sync',
        name: 'third',
        priority: 30,
        handler: async () => { executionOrder.push('third'); },
      });
      
      const { context } = createBeforeTaskContext(baseOptions);
      const results = await hookManager.executeBeforeTask(context);
      
      expect(executionOrder).toEqual(['first']);
      expect(results.length).toBe(2);
    });
  });
});


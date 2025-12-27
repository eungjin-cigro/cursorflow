/**
 * Hook Manager Unit Tests
 * 
 * HookManager의 등록, 실행, 설정 기능을 테스트합니다.
 */

import {
  HookManager,
  HookPoint,
  HookRegistration,
  BeforeTaskContext,
  AfterTaskContext,
  OnErrorContext,
  resetHookManager,
} from '../../../src/hooks';

describe('HookManager', () => {
  let hookManager: HookManager;
  
  beforeEach(() => {
    // 각 테스트 전에 HookManager 리셋
    resetHookManager();
    hookManager = HookManager.getInstance();
  });
  
  afterEach(() => {
    resetHookManager();
  });
  
  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const instance1 = HookManager.getInstance();
      const instance2 = HookManager.getInstance();
      expect(instance1).toBe(instance2);
    });
    
    it('should reset instance correctly', () => {
      const instance1 = HookManager.getInstance();
      instance1.register({
        point: HookPoint.BEFORE_TASK,
        mode: 'sync',
        handler: async () => {},
      });
      
      expect(instance1.getHookCount()).toBe(1);
      
      resetHookManager();
      const instance2 = HookManager.getInstance();
      
      expect(instance2.getHookCount()).toBe(0);
    });
  });
  
  describe('Hook Registration', () => {
    it('should register a hook successfully', () => {
      const unregister = hookManager.register({
        point: HookPoint.BEFORE_TASK,
        mode: 'sync',
        name: 'test-hook',
        handler: async () => {},
      });
      
      expect(hookManager.getHookCount(HookPoint.BEFORE_TASK)).toBe(1);
      expect(hookManager.hasHooks(HookPoint.BEFORE_TASK)).toBe(true);
      expect(typeof unregister).toBe('function');
    });
    
    it('should unregister a hook when calling the returned function', () => {
      const unregister = hookManager.register({
        point: HookPoint.AFTER_TASK,
        mode: 'sync',
        handler: async () => {},
      });
      
      expect(hookManager.getHookCount(HookPoint.AFTER_TASK)).toBe(1);
      
      unregister();
      
      expect(hookManager.getHookCount(HookPoint.AFTER_TASK)).toBe(0);
    });
    
    it('should register multiple hooks for the same point', () => {
      hookManager.register({
        point: HookPoint.BEFORE_TASK,
        mode: 'sync',
        handler: async () => {},
      });
      
      hookManager.register({
        point: HookPoint.BEFORE_TASK,
        mode: 'async',
        handler: async () => {},
      });
      
      expect(hookManager.getHookCount(HookPoint.BEFORE_TASK)).toBe(2);
    });
    
    it('should respect priority ordering', () => {
      hookManager.register({
        point: HookPoint.BEFORE_TASK,
        mode: 'sync',
        name: 'low-priority',
        priority: 100,
        handler: async () => {},
      });
      
      hookManager.register({
        point: HookPoint.BEFORE_TASK,
        mode: 'sync',
        name: 'high-priority',
        priority: 10,
        handler: async () => {},
      });
      
      hookManager.register({
        point: HookPoint.BEFORE_TASK,
        mode: 'sync',
        name: 'default-priority',
        handler: async () => {},
      });
      
      const hooks = hookManager.listHooks(HookPoint.BEFORE_TASK);
      
      expect(hooks[0].name).toBe('high-priority');
      expect(hooks[1].name).toBe('default-priority');
      expect(hooks[2].name).toBe('low-priority');
    });
    
    it('should skip disabled hooks', () => {
      hookManager.register({
        point: HookPoint.BEFORE_TASK,
        mode: 'sync',
        enabled: false,
        handler: async () => {},
      });
      
      expect(hookManager.getHookCount(HookPoint.BEFORE_TASK)).toBe(0);
    });
    
    it('should clear hooks for a specific point', () => {
      hookManager.register({
        point: HookPoint.BEFORE_TASK,
        mode: 'sync',
        handler: async () => {},
      });
      
      hookManager.register({
        point: HookPoint.AFTER_TASK,
        mode: 'sync',
        handler: async () => {},
      });
      
      hookManager.clearHooks(HookPoint.BEFORE_TASK);
      
      expect(hookManager.getHookCount(HookPoint.BEFORE_TASK)).toBe(0);
      expect(hookManager.getHookCount(HookPoint.AFTER_TASK)).toBe(1);
    });
    
    it('should clear all hooks when no point specified', () => {
      hookManager.register({
        point: HookPoint.BEFORE_TASK,
        mode: 'sync',
        handler: async () => {},
      });
      
      hookManager.register({
        point: HookPoint.AFTER_TASK,
        mode: 'sync',
        handler: async () => {},
      });
      
      hookManager.clearHooks();
      
      expect(hookManager.getHookCount()).toBe(0);
    });
  });
  
  describe('Hook Execution', () => {
    it('should execute sync hooks in order', async () => {
      const executionOrder: number[] = [];
      
      hookManager.register({
        point: HookPoint.BEFORE_TASK,
        mode: 'sync',
        priority: 10,
        handler: async () => { executionOrder.push(1); },
      });
      
      hookManager.register({
        point: HookPoint.BEFORE_TASK,
        mode: 'sync',
        priority: 20,
        handler: async () => { executionOrder.push(2); },
      });
      
      const mockContext = createMockBeforeTaskContext();
      await hookManager.executeBeforeTask(mockContext);
      
      expect(executionOrder).toEqual([1, 2]);
    });
    
    it('should return execution results', async () => {
      hookManager.register({
        point: HookPoint.BEFORE_TASK,
        mode: 'sync',
        name: 'test-hook',
        handler: async () => {},
      });
      
      const mockContext = createMockBeforeTaskContext();
      const results = await hookManager.executeBeforeTask(mockContext);
      
      expect(results.length).toBe(1);
      expect(results[0].success).toBe(true);
      expect(results[0].handlerName).toBe('test-hook');
      expect(typeof results[0].duration).toBe('number');
    });
    
    it('should handle hook errors gracefully', async () => {
      hookManager.configure({ continueOnError: true });
      
      hookManager.register({
        point: HookPoint.BEFORE_TASK,
        mode: 'sync',
        name: 'error-hook',
        handler: async () => { throw new Error('Test error'); },
      });
      
      hookManager.register({
        point: HookPoint.BEFORE_TASK,
        mode: 'sync',
        name: 'normal-hook',
        handler: async () => {},
      });
      
      const mockContext = createMockBeforeTaskContext();
      const results = await hookManager.executeBeforeTask(mockContext);
      
      expect(results.length).toBe(2);
      expect(results[0].success).toBe(false);
      expect(results[0].error?.message).toBe('Test error');
      expect(results[1].success).toBe(true);
    });
    
    it('should stop on error when continueOnError is false', async () => {
      hookManager.configure({ continueOnError: false });
      
      const secondHandlerCalled = { value: false };
      
      hookManager.register({
        point: HookPoint.BEFORE_TASK,
        mode: 'sync',
        name: 'error-hook',
        handler: async () => { throw new Error('Stop here'); },
      });
      
      hookManager.register({
        point: HookPoint.BEFORE_TASK,
        mode: 'sync',
        name: 'second-hook',
        handler: async () => { secondHandlerCalled.value = true; },
      });
      
      const mockContext = createMockBeforeTaskContext();
      const results = await hookManager.executeBeforeTask(mockContext);
      
      expect(results.length).toBe(1);
      expect(secondHandlerCalled.value).toBe(false);
    });
    
    it('should execute async hooks in background', async () => {
      const asyncStarted = { value: false };
      
      hookManager.register({
        point: HookPoint.ON_LANE_END,
        mode: 'async',
        handler: async () => {
          asyncStarted.value = true;
          await new Promise(resolve => setTimeout(resolve, 100));
        },
      });
      
      const mockContext = createMockBeforeTaskContext();
      const results = await hookManager.execute(HookPoint.ON_LANE_END, mockContext);
      
      // Async hooks don't return results immediately
      expect(results.length).toBe(0);
      
      // But they should have started
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(asyncStarted.value).toBe(true);
    });
    
    it('should return empty results when no hooks registered', async () => {
      const mockContext = createMockBeforeTaskContext();
      const results = await hookManager.executeBeforeTask(mockContext);
      
      expect(results).toEqual([]);
    });
  });
  
  describe('Configuration', () => {
    it('should update configuration', () => {
      hookManager.configure({
        timeout: 60000,
        debug: true,
      });
      
      const config = hookManager.getConfig();
      expect(config.timeout).toBe(60000);
      expect(config.debug).toBe(true);
    });
    
    it('should preserve existing config when updating', () => {
      hookManager.configure({ timeout: 60000 });
      hookManager.configure({ debug: true });
      
      const config = hookManager.getConfig();
      expect(config.timeout).toBe(60000);
      expect(config.debug).toBe(true);
    });
  });
  
  describe('Hook Listing', () => {
    it('should list all registered hooks', () => {
      hookManager.register({
        point: HookPoint.BEFORE_TASK,
        mode: 'sync',
        name: 'hook-1',
        handler: async () => {},
      });
      
      hookManager.register({
        point: HookPoint.AFTER_TASK,
        mode: 'async',
        name: 'hook-2',
        priority: 10,
        handler: async () => {},
      });
      
      const allHooks = hookManager.listHooks();
      
      expect(allHooks.length).toBe(2);
      expect(allHooks.some(h => h.name === 'hook-1' && h.point === HookPoint.BEFORE_TASK)).toBe(true);
      expect(allHooks.some(h => h.name === 'hook-2' && h.point === HookPoint.AFTER_TASK)).toBe(true);
    });
    
    it('should list hooks for a specific point', () => {
      hookManager.register({
        point: HookPoint.BEFORE_TASK,
        mode: 'sync',
        name: 'hook-1',
        handler: async () => {},
      });
      
      hookManager.register({
        point: HookPoint.AFTER_TASK,
        mode: 'sync',
        name: 'hook-2',
        handler: async () => {},
      });
      
      const beforeHooks = hookManager.listHooks(HookPoint.BEFORE_TASK);
      
      expect(beforeHooks.length).toBe(1);
      expect(beforeHooks[0].name).toBe('hook-1');
    });
  });
});

// ============================================================================
// Helper Functions
// ============================================================================

function createMockBeforeTaskContext(): BeforeTaskContext {
  return {
    laneName: 'test-lane',
    runId: 'test-run-123',
    taskIndex: 0,
    totalTasks: 3,
    task: {
      name: 'test-task',
      prompt: 'Test prompt',
      model: 'claude-sonnet-4-20250514',
    },
    flow: createMockFlowController(),
    getData: createMockDataAccessor(),
  };
}

function createMockFlowController() {
  return {
    pause: jest.fn().mockResolvedValue(undefined),
    resume: jest.fn(),
    abort: jest.fn(),
    retry: jest.fn(),
    injectTask: jest.fn(),
    modifyCurrentPrompt: jest.fn(),
    modifyNextTask: jest.fn(),
    replaceRemainingTasks: jest.fn(),
    sendMessage: jest.fn().mockResolvedValue(''),
    callAI: jest.fn().mockResolvedValue(''),
  };
}

function createMockDataAccessor() {
  return {
    git: {
      getChangedFiles: jest.fn().mockResolvedValue([]),
      getDiff: jest.fn().mockResolvedValue(''),
      getRecentCommits: jest.fn().mockResolvedValue([]),
      getCurrentBranch: jest.fn().mockReturnValue('main'),
      getConflictFiles: jest.fn().mockResolvedValue([]),
    },
    conversation: {
      getCurrentTaskMessages: jest.fn().mockResolvedValue([]),
      getAllMessages: jest.fn().mockResolvedValue([]),
      getRecentMessages: jest.fn().mockResolvedValue([]),
      getLastResponse: jest.fn().mockResolvedValue(null),
    },
    tasks: {
      getCompletedTasks: jest.fn().mockReturnValue([]),
      getPendingTasks: jest.fn().mockReturnValue([]),
      getTaskResult: jest.fn().mockReturnValue(null),
      getDependencyResults: jest.fn().mockReturnValue([]),
    },
    logs: {
      getRawOutput: jest.fn().mockResolvedValue(''),
      getToolCalls: jest.fn().mockResolvedValue([]),
      getErrors: jest.fn().mockResolvedValue([]),
    },
    timing: {
      taskStartTime: Date.now(),
      laneStartTime: Date.now(),
      getElapsedTime: jest.fn().mockReturnValue(0),
    },
  };
}


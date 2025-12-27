/**
 * Flow Controller Unit Tests
 * 
 * FlowController의 플로우 제어 및 태스크 조작 기능을 테스트합니다.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  FlowControllerImpl,
  FlowAbortError,
  FlowRetryError,
  createFlowController,
  FlowControllerOptions,
} from '../../../src/hooks';

describe('FlowController', () => {
  let tempDir: string;
  let tasksFile: string;
  let options: FlowControllerOptions;
  
  beforeEach(() => {
    // 임시 디렉토리 생성
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-test-'));
    tasksFile = path.join(tempDir, 'tasks.json');
    
    // 기본 tasks.json 생성
    const initialTasks = {
      tasks: [
        { name: 'task-1', prompt: 'Task 1 prompt' },
        { name: 'task-2', prompt: 'Task 2 prompt' },
        { name: 'task-3', prompt: 'Task 3 prompt' },
      ],
    };
    fs.writeFileSync(tasksFile, JSON.stringify(initialTasks, null, 2));
    
    options = {
      laneName: 'test-lane',
      runDir: tempDir,
      worktreeDir: tempDir,
      currentTaskIndex: 0,
      tasks: initialTasks.tasks,
      tasksFile,
      chatId: 'test-chat-123',
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
  
  describe('Task Manipulation', () => {
    it('should inject a task at the next position', () => {
      const controller = createFlowController(options);
      
      controller.injectTask({
        name: 'injected-task',
        prompt: 'Injected task prompt',
      });
      
      expect(options.tasks.length).toBe(4);
      expect(options.tasks[1].name).toBe('injected-task');
      expect(options.tasks[2].name).toBe('task-2');
      
      // 파일에도 저장되었는지 확인
      const savedTasks = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
      expect(savedTasks.tasks.length).toBe(4);
      expect(savedTasks.tasks[1].name).toBe('injected-task');
    });
    
    it('should modify current prompt', () => {
      const controller = createFlowController(options);
      
      controller.modifyCurrentPrompt('Modified prompt');
      
      const state = controller.getState();
      expect(controller.getModifiedPrompt()).toBe('Modified prompt');
    });
    
    it('should modify next task', () => {
      const controller = createFlowController(options);
      
      controller.modifyNextTask((task) => ({
        ...task,
        prompt: task.prompt + ' [MODIFIED]',
      }));
      
      expect(options.tasks[1].prompt).toBe('Task 2 prompt [MODIFIED]');
    });
    
    it('should replace remaining tasks', () => {
      const controller = createFlowController(options);
      
      controller.replaceRemainingTasks([
        { name: 'new-task-1', prompt: 'New task 1' },
        { name: 'new-task-2', prompt: 'New task 2' },
      ]);
      
      expect(options.tasks.length).toBe(3); // task-1 + 2 new tasks
      expect(options.tasks[0].name).toBe('task-1');
      expect(options.tasks[1].name).toBe('new-task-1');
      expect(options.tasks[2].name).toBe('new-task-2');
    });
  });
  
  describe('Flow Control', () => {
    it('should throw FlowAbortError when abort is called', () => {
      const controller = createFlowController(options);
      
      expect(() => {
        controller.abort('Test abort reason');
      }).toThrow(FlowAbortError);
      
      const state = controller.getState();
      expect(state.isAborted).toBe(true);
      expect(state.reason).toBe('Test abort reason');
    });
    
    it('should throw FlowRetryError when retry is called', () => {
      const controller = createFlowController(options);
      
      expect(() => {
        controller.retry();
      }).toThrow(FlowRetryError);
      
      const state = controller.getState();
      expect(state.shouldRetry).toBe(true);
    });
    
    it('should throw FlowRetryError with modified prompt', () => {
      const controller = createFlowController(options);
      
      try {
        controller.retry({ modifiedPrompt: 'Retry with this prompt' });
      } catch (e) {
        expect(e).toBeInstanceOf(FlowRetryError);
        expect((e as FlowRetryError).modifiedPrompt).toBe('Retry with this prompt');
      }
    });
    
    it('should pause and resume flow', async () => {
      const controller = createFlowController(options);
      
      // 백그라운드에서 pause
      const pausePromise = controller.pause('Waiting for approval');
      
      // pause 상태 확인
      const state = controller.getState();
      expect(state.isPaused).toBe(true);
      expect(state.reason).toBe('Waiting for approval');
      
      // pause 파일 생성 확인
      const pauseFile = path.join(tempDir, 'paused.json');
      expect(fs.existsSync(pauseFile)).toBe(true);
      
      // 약간의 지연 후 resume
      setTimeout(() => {
        controller.resume({ approved: true });
      }, 50);
      
      // pause가 해제될 때까지 대기
      await pausePromise;
      
      const resumedState = controller.getState();
      expect(resumedState.isPaused).toBe(false);
      expect(controller.getResumeData()).toEqual({ approved: true });
      
      // pause 파일 삭제 확인
      expect(fs.existsSync(pauseFile)).toBe(false);
    });
    
    it('should reset state correctly', () => {
      const controller = createFlowController(options);
      
      controller.modifyCurrentPrompt('Modified');
      
      controller.resetState();
      
      const state = controller.getState();
      expect(state.isPaused).toBe(false);
      expect(state.isAborted).toBe(false);
      expect(state.shouldRetry).toBe(false);
      expect(controller.getModifiedPrompt()).toBeUndefined();
    });
  });
  
  describe('Edge Cases', () => {
    it('should handle modifyNextTask when there is no next task', () => {
      options.currentTaskIndex = options.tasks.length - 1;
      const controller = createFlowController(options);
      
      // Should not throw, just log warning
      expect(() => {
        controller.modifyNextTask((task) => ({ ...task, prompt: 'Modified' }));
      }).not.toThrow();
    });
    
    it('should handle missing tasks file gracefully', () => {
      fs.unlinkSync(tasksFile);
      const controller = createFlowController(options);
      
      // Should not throw when persisting
      expect(() => {
        controller.injectTask({ name: 'new', prompt: 'New' });
      }).not.toThrow();
    });
    
    it('should ignore duplicate pause requests', async () => {
      const controller = createFlowController(options);
      
      // First pause
      const pausePromise = controller.pause('First pause');
      
      // Second pause should be ignored
      const secondPausePromise = controller.pause('Second pause');
      
      // Resume
      setTimeout(() => controller.resume(), 50);
      
      await pausePromise;
      
      // Second pause should resolve immediately (no-op)
      expect(secondPausePromise).resolves.toBeUndefined();
    });
    
    it('should ignore resume when not paused', () => {
      const controller = createFlowController(options);
      
      // Should not throw
      expect(() => {
        controller.resume();
      }).not.toThrow();
    });
  });
  
  describe('Factory Function', () => {
    it('should create FlowControllerImpl instance', () => {
      const controller = createFlowController(options);
      
      expect(controller).toBeInstanceOf(FlowControllerImpl);
    });
  });
});

describe('Flow Control Errors', () => {
  describe('FlowAbortError', () => {
    it('should have correct name and message', () => {
      const error = new FlowAbortError('Test reason');
      
      expect(error.name).toBe('FlowAbortError');
      expect(error.message).toBe('Flow aborted: Test reason');
    });
  });
  
  describe('FlowRetryError', () => {
    it('should have correct name and message', () => {
      const error = new FlowRetryError();
      
      expect(error.name).toBe('FlowRetryError');
      expect(error.message).toBe('Flow retry requested');
    });
    
    it('should store modified prompt', () => {
      const error = new FlowRetryError('Modified prompt');
      
      expect(error.modifiedPrompt).toBe('Modified prompt');
    });
  });
});


/**
 * CursorFlow Hook System - Flow Controller Implementation
 * 
 * Hook 핸들러에서 실행 플로우를 제어하기 위한 구현체입니다.
 * pause, resume, injectTask 등의 기능을 제공합니다.
 */

import * as fs from 'fs';
import { safeJoin } from '../utils/path';
import * as logger from '../utils/logger';
import { events } from '../utils/events';
import {
  FlowController,
  TaskDefinition,
  AICallOptions,
} from './types';

// ============================================================================
// Flow Controller Options
// ============================================================================

export interface FlowControllerOptions {
  /** Lane 이름 */
  laneName: string;
  /** Run 디렉토리 */
  runDir: string;
  /** Worktree 디렉토리 */
  worktreeDir: string;
  /** 현재 태스크 인덱스 */
  currentTaskIndex: number;
  /** 태스크 목록 (수정 가능) */
  tasks: TaskDefinition[];
  /** 태스크 파일 경로 */
  tasksFile: string;
  /** Chat ID */
  chatId: string;
  /** AgentSupervisor 인스턴스 (AI 호출용) */
  agentSupervisor?: any;
}

// ============================================================================
// Flow Control State
// ============================================================================

/**
 * 플로우 제어 상태
 */
export interface FlowControlState {
  /** 일시 중지 여부 */
  isPaused: boolean;
  /** 중단 여부 */
  isAborted: boolean;
  /** 재시도 요청 여부 */
  shouldRetry: boolean;
  /** 재시도 시 사용할 수정된 프롬프트 */
  retryPrompt?: string;
  /** 수정된 현재 프롬프트 */
  modifiedCurrentPrompt?: string;
  /** 중지/중단 사유 */
  reason?: string;
  /** 재개 시 전달할 데이터 */
  resumeData?: any;
}

// ============================================================================
// Flow Controller Implementation
// ============================================================================

/**
 * FlowController 구현체
 */
export class FlowControllerImpl implements FlowController {
  private options: FlowControllerOptions;
  private state: FlowControlState;
  private pauseResolver: ((data?: any) => void) | null = null;
  
  constructor(options: FlowControllerOptions) {
    this.options = options;
    this.state = {
      isPaused: false,
      isAborted: false,
      shouldRetry: false,
    };
  }
  
  // ==========================================================================
  // Flow Control Methods
  // ==========================================================================
  
  /**
   * 플로우 일시 중지
   */
  async pause(reason: string): Promise<void> {
    if (this.state.isPaused) {
      logger.warn(`[Hook] Already paused, ignoring duplicate pause request`);
      return;
    }
    
    this.state.isPaused = true;
    this.state.reason = reason;
    
    logger.info(`[Hook] Flow paused: ${reason}`);
    
    // 이벤트 발행
    events.emit('lane.paused' as any, {
      laneName: this.options.laneName,
      reason,
    });
    
    // Pause 상태 파일 생성 (외부에서 확인 가능)
    const pauseFile = safeJoin(this.options.runDir, 'paused.json');
    fs.writeFileSync(pauseFile, JSON.stringify({
      paused: true,
      reason,
      timestamp: Date.now(),
    }, null, 2));
    
    // resume이 호출될 때까지 대기
    return new Promise((resolve) => {
      this.pauseResolver = (data) => {
        this.state.isPaused = false;
        this.state.resumeData = data;
        
        // Pause 파일 삭제
        try {
          fs.unlinkSync(pauseFile);
        } catch {
          // Ignore
        }
        
        resolve();
      };
    });
  }
  
  /**
   * 플로우 재개
   */
  resume(data?: any): void {
    if (!this.state.isPaused) {
      logger.warn(`[Hook] Not paused, ignoring resume request`);
      return;
    }
    
    logger.info(`[Hook] Flow resumed`);
    
    // 이벤트 발행
    events.emit('lane.resumed' as any, {
      laneName: this.options.laneName,
    });
    
    if (this.pauseResolver) {
      this.pauseResolver(data);
      this.pauseResolver = null;
    }
  }
  
  /**
   * Lane 중단
   */
  abort(reason: string): void {
    this.state.isAborted = true;
    this.state.reason = reason;
    
    logger.error(`[Hook] Flow aborted: ${reason}`);
    
    // 이벤트 발행
    events.emit('lane.failed' as any, {
      laneName: this.options.laneName,
      exitCode: 1,
      error: reason,
    });
    
    // Abort 예외 던지기 (Runner에서 catch)
    throw new FlowAbortError(reason);
  }
  
  /**
   * 현재 태스크 재시도
   */
  retry(options?: { modifiedPrompt?: string }): void {
    this.state.shouldRetry = true;
    this.state.retryPrompt = options?.modifiedPrompt;
    
    logger.info(`[Hook] Task retry requested${options?.modifiedPrompt ? ' with modified prompt' : ''}`);
    
    throw new FlowRetryError(options?.modifiedPrompt);
  }
  
  // ==========================================================================
  // Task Manipulation Methods
  // ==========================================================================
  
  /**
   * 다음에 실행할 태스크 삽입
   */
  injectTask(task: TaskDefinition): void {
    const insertIndex = this.options.currentTaskIndex + 1;
    
    // 태스크 배열에 삽입
    this.options.tasks.splice(insertIndex, 0, task);
    
    logger.info(`[Hook] Injected task "${task.name}" at index ${insertIndex}`);
    
    // tasks.json 파일 업데이트
    this.persistTasks();
  }
  
  /**
   * 현재 태스크 프롬프트 수정 (beforeTask에서만 유효)
   */
  modifyCurrentPrompt(newPrompt: string): void {
    this.state.modifiedCurrentPrompt = newPrompt;
    
    const currentTask = this.options.tasks[this.options.currentTaskIndex];
    if (currentTask) {
      logger.info(`[Hook] Modified prompt for task "${currentTask.name}"`);
    }
  }
  
  /**
   * 다음 태스크 수정
   */
  modifyNextTask(modifier: (task: TaskDefinition) => TaskDefinition): void {
    const nextIndex = this.options.currentTaskIndex + 1;
    
    if (nextIndex >= this.options.tasks.length) {
      logger.warn(`[Hook] No next task to modify`);
      return;
    }
    
    const nextTask = this.options.tasks[nextIndex];
    const modifiedTask = modifier(nextTask);
    this.options.tasks[nextIndex] = modifiedTask;
    
    logger.info(`[Hook] Modified next task "${modifiedTask.name}"`);
    
    // tasks.json 파일 업데이트
    this.persistTasks();
  }
  
  /**
   * 남은 태스크 전체 교체
   */
  replaceRemainingTasks(tasks: TaskDefinition[]): void {
    const currentIndex = this.options.currentTaskIndex;
    
    // 현재까지의 태스크 유지, 이후 교체
    const completedTasks = this.options.tasks.slice(0, currentIndex + 1);
    this.options.tasks.length = 0;
    this.options.tasks.push(...completedTasks, ...tasks);
    
    logger.info(`[Hook] Replaced remaining tasks with ${tasks.length} new tasks`);
    
    // tasks.json 파일 업데이트
    this.persistTasks();
  }
  
  /**
   * tasks.json 파일에 변경사항 저장
   */
  private persistTasks(): void {
    try {
      const tasksFile = this.options.tasksFile;
      
      if (fs.existsSync(tasksFile)) {
        const config = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
        config.tasks = this.options.tasks;
        fs.writeFileSync(tasksFile, JSON.stringify(config, null, 2));
      }
    } catch (error) {
      logger.warn(`[Hook] Failed to persist tasks: ${error}`);
    }
  }
  
  // ==========================================================================
  // Agent Communication Methods
  // ==========================================================================
  
  /**
   * AI 에이전트에게 메시지 전송 (현재 세션)
   */
  async sendMessage(message: string): Promise<string> {
    const { agentSupervisor, worktreeDir, chatId, laneName, runDir } = this.options;
    
    if (!agentSupervisor) {
      throw new Error('AgentSupervisor not available');
    }
    
    logger.info(`[Hook] Sending message to agent`);
    
    try {
      const result = await agentSupervisor.sendTaskPrompt({
        workspaceDir: worktreeDir,
        chatId,
        prompt: message,
        laneName,
        signalDir: runDir,
        taskName: 'hook-intervention',
      });
      
      return result.resultText || '';
    } catch (error: any) {
      logger.error(`[Hook] Failed to send message: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * 별도 AI 호출 (새 세션)
   */
  async callAI(prompt: string, options?: AICallOptions): Promise<string> {
    const { agentSupervisor, worktreeDir, laneName, runDir } = this.options;
    
    if (!agentSupervisor) {
      throw new Error('AgentSupervisor not available');
    }
    
    logger.info(`[Hook] Calling AI with new session`);
    
    try {
      // 새 채팅 세션 생성
      const newChatId = agentSupervisor.createChat(worktreeDir);
      
      const result = await agentSupervisor.sendTaskPrompt({
        workspaceDir: worktreeDir,
        chatId: newChatId,
        prompt,
        model: options?.model,
        laneName,
        signalDir: runDir,
        timeout: options?.timeout,
        taskName: 'hook-ai-call',
      });
      
      return result.resultText || '';
    } catch (error: any) {
      logger.error(`[Hook] Failed to call AI: ${error.message}`);
      throw error;
    }
  }
  
  // ==========================================================================
  // State Access Methods
  // ==========================================================================
  
  /**
   * 현재 상태 조회
   */
  getState(): FlowControlState {
    return { ...this.state };
  }
  
  /**
   * 수정된 프롬프트 조회 (beforeTask에서 설정된 경우)
   */
  getModifiedPrompt(): string | undefined {
    return this.state.modifiedCurrentPrompt;
  }
  
  /**
   * 재개 데이터 조회
   */
  getResumeData(): any {
    return this.state.resumeData;
  }
  
  /**
   * 상태 리셋
   */
  resetState(): void {
    this.state = {
      isPaused: false,
      isAborted: false,
      shouldRetry: false,
    };
    this.pauseResolver = null;
  }
  
  /**
   * 옵션 업데이트
   */
  updateOptions(updates: Partial<FlowControllerOptions>): void {
    this.options = { ...this.options, ...updates };
  }
}

// ============================================================================
// Custom Errors
// ============================================================================

/**
 * Flow 중단 에러
 */
export class FlowAbortError extends Error {
  constructor(reason: string) {
    super(`Flow aborted: ${reason}`);
    this.name = 'FlowAbortError';
  }
}

/**
 * Flow 재시도 에러
 */
export class FlowRetryError extends Error {
  public modifiedPrompt?: string;
  
  constructor(modifiedPrompt?: string) {
    super('Flow retry requested');
    this.name = 'FlowRetryError';
    this.modifiedPrompt = modifiedPrompt;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * FlowController 인스턴스 생성
 */
export function createFlowController(options: FlowControllerOptions): FlowControllerImpl {
  return new FlowControllerImpl(options);
}


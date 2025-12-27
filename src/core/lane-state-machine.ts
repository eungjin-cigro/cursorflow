/**
 * Lane State Machine
 * 
 * Lane의 생명주기를 세분화된 상태로 관리하는 상태 머신입니다.
 * 
 * 핵심 원칙:
 * 1. 명시적 상태 전이 (Explicit State Transitions)
 * 2. 단일 상태 저장소 (Single Source of Truth)
 * 3. 상태 전이 검증 (Transition Validation)
 * 4. 복구/재시도 로직 중앙화 (Centralized Recovery)
 * 
 * 상태 계층:
 * - 주 상태 (Primary State): Lane의 기본 상태 (pending, running, completed 등)
 * - 부 상태 (Sub State): 세부 작업 상태 (preparing_git, executing_task 등)
 * - 복구 상태 (Recovery State): 복구 진행 상태 (idle, monitoring, recovering 등)
 */

import * as fs from 'fs';
import { events } from '../utils/events';
import { safeJoin } from '../utils/path';
import * as logger from '../utils/logger';
import { 
  StateEventType,
  StateTransitionPayload,
  StateTransitionFailedPayload,
} from '../types/event-categories';

// ============================================================================
// State Definitions (상태 정의)
// ============================================================================

/**
 * Lane 주 상태 (Primary State)
 * 
 * 상태 전이 규칙:
 * - PENDING → INITIALIZING → RUNNING → COMPLETED | FAILED
 * - RUNNING ↔ WAITING (의존성 대기)
 * - RUNNING ↔ PAUSED (사용자 요청)
 * - RUNNING → RECOVERING → RUNNING | FAILED
 * - * → ABORTED (강제 중단)
 */
export enum LanePrimaryState {
  /** 대기 중 - 아직 시작되지 않음 */
  PENDING = 'pending',
  /** 초기화 중 - 워크트리/브랜치 준비 */
  INITIALIZING = 'initializing',
  /** 실행 중 */
  RUNNING = 'running',
  /** 의존성 대기 중 */
  WAITING = 'waiting',
  /** 일시 중지 */
  PAUSED = 'paused',
  /** 복구 중 */
  RECOVERING = 'recovering',
  /** 완료 */
  COMPLETED = 'completed',
  /** 실패 */
  FAILED = 'failed',
  /** 강제 중단 */
  ABORTED = 'aborted',
}

/**
 * Lane 부 상태 (Sub State) - RUNNING 상태의 세부 단계
 */
export enum LaneSubState {
  /** 없음 (비실행 상태) */
  NONE = 'none',
  
  // --- Git 관련 ---
  /** Git 워크트리 준비 */
  PREPARING_GIT = 'preparing_git',
  /** 의존성 브랜치 머지 */
  MERGING_DEPENDENCIES = 'merging_dependencies',
  /** Task 브랜치 생성 */
  CREATING_TASK_BRANCH = 'creating_task_branch',
  /** 변경사항 커밋 */
  COMMITTING = 'committing',
  /** 푸시 */
  PUSHING = 'pushing',
  /** 머지 */
  MERGING = 'merging',
  
  // --- Task 관련 ---
  /** Task 실행 준비 */
  PREPARING_TASK = 'preparing_task',
  /** AI 에이전트와 통신 중 */
  EXECUTING_AGENT = 'executing_agent',
  /** Task 실행 완료 처리 */
  FINALIZING_TASK = 'finalizing_task',
  
  // --- 대기 관련 ---
  /** 의존성 완료 대기 */
  WAITING_DEPENDENCY = 'waiting_dependency',
  /** 사용자 입력 대기 */
  WAITING_USER_INPUT = 'waiting_user_input',
  /** Rate limit 대기 */
  WAITING_RATE_LIMIT = 'waiting_rate_limit',
}

/**
 * 복구 상태 (Recovery State)
 */
export enum RecoveryState {
  /** 복구 필요 없음 */
  IDLE = 'idle',
  /** 모니터링 중 (Stall 감지) */
  MONITORING = 'monitoring',
  /** Continue 신호 발송됨 */
  CONTINUE_SENT = 'continue_sent',
  /** Stronger prompt 발송됨 */
  STRONGER_PROMPT_SENT = 'stronger_prompt_sent',
  /** 재시작 요청됨 */
  RESTART_REQUESTED = 'restart_requested',
  /** 진단 실행됨 */
  DIAGNOSED = 'diagnosed',
  /** 복구 포기 */
  EXHAUSTED = 'exhausted',
}

// ============================================================================
// State Transition Triggers (상태 전이 트리거)
// ============================================================================

/**
 * 상태 전이를 발생시키는 트리거
 */
export enum StateTransitionTrigger {
  // --- Lifecycle Triggers ---
  /** Lane 시작 */
  START = 'start',
  /** 초기화 완료 */
  INITIALIZED = 'initialized',
  /** Task 완료 */
  TASK_COMPLETED = 'task_completed',
  /** 모든 Task 완료 */
  ALL_TASKS_COMPLETED = 'all_tasks_completed',
  /** 실패 발생 */
  FAILURE = 'failure',
  /** 강제 중단 요청 */
  ABORT = 'abort',
  
  // --- Dependency Triggers ---
  /** 의존성 대기 시작 */
  WAIT_DEPENDENCY = 'wait_dependency',
  /** 의존성 해결됨 */
  DEPENDENCY_RESOLVED = 'dependency_resolved',
  /** 의존성 타임아웃 */
  DEPENDENCY_TIMEOUT = 'dependency_timeout',
  /** 의존성 실패 */
  DEPENDENCY_FAILED = 'dependency_failed',
  
  // --- Pause/Resume Triggers ---
  /** 일시 중지 요청 */
  PAUSE = 'pause',
  /** 재개 요청 */
  RESUME = 'resume',
  
  // --- Recovery Triggers ---
  /** 복구 시작 */
  RECOVERY_START = 'recovery_start',
  /** 복구 성공 */
  RECOVERY_SUCCESS = 'recovery_success',
  /** 복구 실패 */
  RECOVERY_FAILED = 'recovery_failed',
  /** Stall 감지 */
  STALL_DETECTED = 'stall_detected',
  /** Continue 신호 발송 */
  CONTINUE_SIGNAL_SENT = 'continue_signal_sent',
  /** Stronger prompt 발송 */
  STRONGER_PROMPT_SENT = 'stronger_prompt_sent',
  /** 재시작 요청 */
  RESTART_REQUESTED = 'restart_requested',
  /** 진단 완료 */
  DIAGNOSIS_COMPLETE = 'diagnosis_complete',
  
  // --- Sub-state Triggers ---
  /** Git 작업 시작 */
  GIT_START = 'git_start',
  /** Git 작업 완료 */
  GIT_COMPLETE = 'git_complete',
  /** Task 실행 시작 */
  TASK_START = 'task_start',
  /** Agent 통신 시작 */
  AGENT_START = 'agent_start',
  /** Agent 응답 수신 */
  AGENT_RESPONSE = 'agent_response',
}

// ============================================================================
// State Machine Configuration
// ============================================================================

/**
 * 상태 전이 규칙 정의
 */
interface TransitionRule {
  from: LanePrimaryState | LanePrimaryState[];
  to: LanePrimaryState;
  trigger: StateTransitionTrigger;
  /** 전이 전 검증 함수 */
  guard?: (context: LaneStateContext) => boolean;
  /** 전이 후 실행 함수 */
  onTransition?: (context: LaneStateContext) => void;
}

/**
 * Lane 상태 컨텍스트 (전체 상태 정보)
 */
export interface LaneStateContext {
  /** Lane 이름 */
  laneName: string;
  /** Run ID */
  runId: string;
  /** 주 상태 */
  primaryState: LanePrimaryState;
  /** 부 상태 */
  subState: LaneSubState;
  /** 복구 상태 */
  recoveryState: RecoveryState;
  /** 현재 Task 인덱스 */
  currentTaskIndex: number;
  /** 전체 Task 수 */
  totalTasks: number;
  /** 완료된 Task 목록 */
  completedTasks: string[];
  /** 현재 Task 이름 */
  currentTaskName?: string;
  /** 대기 중인 의존성 */
  waitingFor?: string[];
  /** 마지막 오류 */
  lastError?: string;
  /** 재시작 횟수 */
  restartCount: number;
  /** 시작 시간 */
  startTime: number;
  /** 종료 시간 */
  endTime?: number;
  /** 마지막 상태 변경 시간 */
  lastTransitionTime: number;
  /** 워크트리 디렉토리 */
  worktreeDir?: string;
  /** 파이프라인 브랜치 */
  pipelineBranch?: string;
  /** 현재 Task 브랜치 */
  taskBranch?: string;
  /** 프로세스 ID */
  pid?: number;
  /** 채팅 세션 ID */
  chatId?: string;
  /** 추가 메타데이터 */
  metadata?: Record<string, any>;
}

/**
 * 상태 전이 결과
 */
export interface StateTransitionResult {
  /** 성공 여부 */
  success: boolean;
  /** 이전 상태 */
  fromState: LanePrimaryState;
  /** 새 상태 */
  toState: LanePrimaryState;
  /** 트리거 */
  trigger: StateTransitionTrigger;
  /** 오류 메시지 (실패 시) */
  error?: string;
}

/**
 * 상태 전이 규칙 테이블
 */
const TRANSITION_RULES: TransitionRule[] = [
  // --- 시작 및 초기화 ---
  { from: LanePrimaryState.PENDING, to: LanePrimaryState.INITIALIZING, trigger: StateTransitionTrigger.START },
  { from: LanePrimaryState.INITIALIZING, to: LanePrimaryState.RUNNING, trigger: StateTransitionTrigger.INITIALIZED },
  { from: LanePrimaryState.INITIALIZING, to: LanePrimaryState.FAILED, trigger: StateTransitionTrigger.FAILURE },
  
  // --- 실행 중 → 완료/실패 ---
  { from: LanePrimaryState.RUNNING, to: LanePrimaryState.COMPLETED, trigger: StateTransitionTrigger.ALL_TASKS_COMPLETED },
  { from: LanePrimaryState.RUNNING, to: LanePrimaryState.FAILED, trigger: StateTransitionTrigger.FAILURE },
  
  // --- 의존성 대기 ---
  { from: LanePrimaryState.RUNNING, to: LanePrimaryState.WAITING, trigger: StateTransitionTrigger.WAIT_DEPENDENCY },
  { from: LanePrimaryState.WAITING, to: LanePrimaryState.RUNNING, trigger: StateTransitionTrigger.DEPENDENCY_RESOLVED },
  { from: LanePrimaryState.WAITING, to: LanePrimaryState.FAILED, trigger: StateTransitionTrigger.DEPENDENCY_TIMEOUT },
  { from: LanePrimaryState.WAITING, to: LanePrimaryState.FAILED, trigger: StateTransitionTrigger.DEPENDENCY_FAILED },
  
  // --- 일시 중지/재개 ---
  { from: LanePrimaryState.RUNNING, to: LanePrimaryState.PAUSED, trigger: StateTransitionTrigger.PAUSE },
  { from: LanePrimaryState.WAITING, to: LanePrimaryState.PAUSED, trigger: StateTransitionTrigger.PAUSE },
  { from: LanePrimaryState.PAUSED, to: LanePrimaryState.RUNNING, trigger: StateTransitionTrigger.RESUME },
  
  // --- 복구 ---
  { from: LanePrimaryState.RUNNING, to: LanePrimaryState.RECOVERING, trigger: StateTransitionTrigger.RECOVERY_START },
  { from: LanePrimaryState.RECOVERING, to: LanePrimaryState.RUNNING, trigger: StateTransitionTrigger.RECOVERY_SUCCESS },
  { from: LanePrimaryState.RECOVERING, to: LanePrimaryState.FAILED, trigger: StateTransitionTrigger.RECOVERY_FAILED },
  
  // --- 강제 중단 (모든 상태에서 가능) ---
  { 
    from: [
      LanePrimaryState.PENDING,
      LanePrimaryState.INITIALIZING,
      LanePrimaryState.RUNNING,
      LanePrimaryState.WAITING,
      LanePrimaryState.PAUSED,
      LanePrimaryState.RECOVERING,
    ], 
    to: LanePrimaryState.ABORTED, 
    trigger: StateTransitionTrigger.ABORT 
  },
];

// ============================================================================
// Lane State Machine
// ============================================================================

/**
 * Lane 상태 머신
 * 
 * 사용 예:
 * ```typescript
 * const sm = LaneStateMachine.getInstance();
 * 
 * // Lane 등록
 * sm.registerLane('lane-1', 'run-123', {
 *   totalTasks: 5,
 *   pipelineBranch: 'cursorflow/pipeline/lane-1'
 * });
 * 
 * // 상태 전이
 * sm.transition('lane-1', StateTransitionTrigger.START);
 * sm.transition('lane-1', StateTransitionTrigger.INITIALIZED);
 * 
 * // 부 상태 업데이트
 * sm.setSubState('lane-1', LaneSubState.EXECUTING_AGENT);
 * 
 * // 상태 조회
 * const ctx = sm.getContext('lane-1');
 * console.log(ctx.primaryState, ctx.subState);
 * ```
 */
export class LaneStateMachine {
  private static instance: LaneStateMachine | null = null;
  
  /** Lane별 상태 컨텍스트 */
  private contexts: Map<string, LaneStateContext> = new Map();
  
  /** 상태 히스토리 (디버깅/감사용) */
  private history: Map<string, Array<{
    timestamp: number;
    fromState: LanePrimaryState;
    toState: LanePrimaryState;
    trigger: StateTransitionTrigger;
  }>> = new Map();
  
  /** 상태 변경 콜백 */
  private onTransitionCallbacks: Array<(laneName: string, result: StateTransitionResult) => void> = [];
  
  /** 디버그 모드 */
  private verbose: boolean = false;
  
  private constructor() {
    this.verbose = process.env['DEBUG_STATE'] === 'true';
  }
  
  /**
   * 싱글톤 인스턴스 획득
   */
  static getInstance(): LaneStateMachine {
    if (!LaneStateMachine.instance) {
      LaneStateMachine.instance = new LaneStateMachine();
    }
    return LaneStateMachine.instance;
  }
  
  /**
   * 인스턴스 리셋 (테스트용)
   */
  static resetInstance(): void {
    LaneStateMachine.instance = null;
  }
  
  // --------------------------------------------------------------------------
  // Lane Registration
  // --------------------------------------------------------------------------
  
  /**
   * Lane 등록
   */
  registerLane(
    laneName: string, 
    runId: string, 
    options: {
      totalTasks?: number;
      pipelineBranch?: string;
      worktreeDir?: string;
      metadata?: Record<string, any>;
    } = {}
  ): LaneStateContext {
    const now = Date.now();
    
    const context: LaneStateContext = {
      laneName,
      runId,
      primaryState: LanePrimaryState.PENDING,
      subState: LaneSubState.NONE,
      recoveryState: RecoveryState.IDLE,
      currentTaskIndex: 0,
      totalTasks: options.totalTasks || 0,
      completedTasks: [],
      restartCount: 0,
      startTime: now,
      lastTransitionTime: now,
      pipelineBranch: options.pipelineBranch,
      worktreeDir: options.worktreeDir,
      metadata: options.metadata,
    };
    
    this.contexts.set(laneName, context);
    this.history.set(laneName, []);
    
    this.log(`[${laneName}] Registered (runId: ${runId}, tasks: ${options.totalTasks || 0})`);
    
    return context;
  }
  
  /**
   * Lane 해제
   */
  unregisterLane(laneName: string): void {
    this.contexts.delete(laneName);
    this.history.delete(laneName);
    this.log(`[${laneName}] Unregistered`);
  }
  
  /**
   * Lane 컨텍스트 조회
   */
  getContext(laneName: string): LaneStateContext | undefined {
    return this.contexts.get(laneName);
  }
  
  /**
   * 모든 Lane 컨텍스트 조회
   */
  getAllContexts(): Map<string, LaneStateContext> {
    return new Map(this.contexts);
  }
  
  // --------------------------------------------------------------------------
  // State Transitions
  // --------------------------------------------------------------------------
  
  /**
   * 상태 전이 실행
   */
  transition(
    laneName: string, 
    trigger: StateTransitionTrigger,
    options: {
      error?: string;
      force?: boolean;
    } = {}
  ): StateTransitionResult {
    const context = this.contexts.get(laneName);
    
    if (!context) {
      return {
        success: false,
        fromState: LanePrimaryState.PENDING,
        toState: LanePrimaryState.PENDING,
        trigger,
        error: `Lane not found: ${laneName}`,
      };
    }
    
    const currentState = context.primaryState;
    
    // 전이 규칙 찾기
    const rule = this.findTransitionRule(currentState, trigger);
    
    if (!rule && !options.force) {
      const result: StateTransitionResult = {
        success: false,
        fromState: currentState,
        toState: currentState,
        trigger,
        error: `Invalid transition: ${currentState} + ${trigger}`,
      };
      
      this.emitTransitionFailed(laneName, context, trigger, result.error!);
      
      return result;
    }
    
    const targetState = rule?.to || currentState;
    
    // Guard 체크
    if (rule?.guard && !rule.guard(context)) {
      const result: StateTransitionResult = {
        success: false,
        fromState: currentState,
        toState: currentState,
        trigger,
        error: 'Transition guard failed',
      };
      
      this.emitTransitionFailed(laneName, context, trigger, result.error!);
      
      return result;
    }
    
    // 상태 전이 실행
    const previousState = context.primaryState;
    context.primaryState = targetState;
    context.lastTransitionTime = Date.now();
    
    // 오류 정보 업데이트
    if (options.error) {
      context.lastError = options.error;
    }
    
    // 종료 상태 처리
    if (this.isTerminalState(targetState)) {
      context.endTime = Date.now();
    }
    
    // 부 상태 리셋 (필요한 경우)
    if (this.shouldResetSubState(previousState, targetState)) {
      context.subState = LaneSubState.NONE;
    }
    
    // 히스토리 기록
    const historyEntry = {
      timestamp: Date.now(),
      fromState: previousState,
      toState: targetState,
      trigger,
    };
    this.history.get(laneName)?.push(historyEntry);
    
    // 콜백 및 이벤트 발행
    const result: StateTransitionResult = {
      success: true,
      fromState: previousState,
      toState: targetState,
      trigger,
    };
    
    rule?.onTransition?.(context);
    this.notifyTransition(laneName, result);
    this.emitTransition(laneName, context, previousState, trigger);
    
    this.log(`[${laneName}] ${previousState} → ${targetState} (trigger: ${trigger})`);
    
    return result;
  }
  
  /**
   * 전이 규칙 찾기
   */
  private findTransitionRule(currentState: LanePrimaryState, trigger: StateTransitionTrigger): TransitionRule | undefined {
    return TRANSITION_RULES.find(rule => {
      const fromStates = Array.isArray(rule.from) ? rule.from : [rule.from];
      return fromStates.includes(currentState) && rule.trigger === trigger;
    });
  }
  
  /**
   * 종료 상태인지 확인
   */
  private isTerminalState(state: LanePrimaryState): boolean {
    return [
      LanePrimaryState.COMPLETED,
      LanePrimaryState.FAILED,
      LanePrimaryState.ABORTED,
    ].includes(state);
  }
  
  /**
   * 부 상태 리셋 필요 여부
   */
  private shouldResetSubState(from: LanePrimaryState, to: LanePrimaryState): boolean {
    // RUNNING을 벗어날 때 부 상태 리셋
    return from === LanePrimaryState.RUNNING && to !== LanePrimaryState.RUNNING;
  }
  
  // --------------------------------------------------------------------------
  // Sub-State Management
  // --------------------------------------------------------------------------
  
  /**
   * 부 상태 설정
   */
  setSubState(laneName: string, subState: LaneSubState): boolean {
    const context = this.contexts.get(laneName);
    if (!context) return false;
    
    const previousSubState = context.subState;
    context.subState = subState;
    
    this.log(`[${laneName}] SubState: ${previousSubState} → ${subState}`);
    
    return true;
  }
  
  /**
   * 부 상태 조회
   */
  getSubState(laneName: string): LaneSubState {
    return this.contexts.get(laneName)?.subState || LaneSubState.NONE;
  }
  
  // --------------------------------------------------------------------------
  // Recovery State Management
  // --------------------------------------------------------------------------
  
  /**
   * 복구 상태 설정
   */
  setRecoveryState(laneName: string, recoveryState: RecoveryState): boolean {
    const context = this.contexts.get(laneName);
    if (!context) return false;
    
    const previousState = context.recoveryState;
    context.recoveryState = recoveryState;
    
    this.log(`[${laneName}] RecoveryState: ${previousState} → ${recoveryState}`);
    
    return true;
  }
  
  /**
   * 복구 상태 조회
   */
  getRecoveryState(laneName: string): RecoveryState {
    return this.contexts.get(laneName)?.recoveryState || RecoveryState.IDLE;
  }
  
  /**
   * 재시작 횟수 증가
   */
  incrementRestartCount(laneName: string): number {
    const context = this.contexts.get(laneName);
    if (!context) return 0;
    
    context.restartCount++;
    return context.restartCount;
  }
  
  // --------------------------------------------------------------------------
  // Context Updates
  // --------------------------------------------------------------------------
  
  /**
   * Task 진행 상황 업데이트
   */
  updateTaskProgress(
    laneName: string, 
    taskIndex: number, 
    taskName?: string,
    taskBranch?: string
  ): boolean {
    const context = this.contexts.get(laneName);
    if (!context) return false;
    
    context.currentTaskIndex = taskIndex;
    if (taskName) context.currentTaskName = taskName;
    if (taskBranch) context.taskBranch = taskBranch;
    
    return true;
  }
  
  /**
   * Task 완료 기록
   */
  recordTaskCompletion(laneName: string, taskName: string): boolean {
    const context = this.contexts.get(laneName);
    if (!context) return false;
    
    if (!context.completedTasks.includes(taskName)) {
      context.completedTasks.push(taskName);
    }
    
    return true;
  }
  
  /**
   * 대기 중인 의존성 설정
   */
  setWaitingFor(laneName: string, dependencies: string[]): boolean {
    const context = this.contexts.get(laneName);
    if (!context) return false;
    
    context.waitingFor = dependencies;
    return true;
  }
  
  /**
   * 오류 설정
   */
  setError(laneName: string, error: string): boolean {
    const context = this.contexts.get(laneName);
    if (!context) return false;
    
    context.lastError = error;
    return true;
  }
  
  /**
   * 프로세스 ID 설정
   */
  setPid(laneName: string, pid: number): boolean {
    const context = this.contexts.get(laneName);
    if (!context) return false;
    
    context.pid = pid;
    return true;
  }
  
  /**
   * 채팅 세션 ID 설정
   */
  setChatId(laneName: string, chatId: string): boolean {
    const context = this.contexts.get(laneName);
    if (!context) return false;
    
    context.chatId = chatId;
    return true;
  }
  
  /**
   * 메타데이터 업데이트
   */
  updateMetadata(laneName: string, metadata: Record<string, any>): boolean {
    const context = this.contexts.get(laneName);
    if (!context) return false;
    
    context.metadata = { ...context.metadata, ...metadata };
    return true;
  }
  
  // --------------------------------------------------------------------------
  // State Persistence
  // --------------------------------------------------------------------------
  
  /**
   * 상태를 파일로 저장
   */
  persistState(laneName: string, stateDir: string): boolean {
    const context = this.contexts.get(laneName);
    if (!context) return false;
    
    const statePath = safeJoin(stateDir, 'state.json');
    
    // LaneState 형식으로 변환 (기존 호환성)
    const laneState = this.contextToLaneState(context);
    
    try {
      const stateParent = require('path').dirname(statePath);
      if (!fs.existsSync(stateParent)) {
        fs.mkdirSync(stateParent, { recursive: true });
      }
      
      const tempPath = `${statePath}.tmp.${process.pid}`;
      fs.writeFileSync(tempPath, JSON.stringify(laneState, null, 2), 'utf8');
      fs.renameSync(tempPath, statePath);
      
      events.emit(StateEventType.PERSISTED as any, {
        laneName,
        filePath: statePath,
      });
      
      return true;
    } catch (error: any) {
      logger.error(`[StateMachine] Failed to persist state for ${laneName}: ${error.message}`);
      return false;
    }
  }
  
  /**
   * 파일에서 상태 복구
   */
  restoreState(laneName: string, runId: string, stateDir: string): LaneStateContext | null {
    const statePath = safeJoin(stateDir, 'state.json');
    
    if (!fs.existsSync(statePath)) {
      return null;
    }
    
    try {
      const content = fs.readFileSync(statePath, 'utf8');
      const laneState = JSON.parse(content);
      
      // LaneState에서 컨텍스트로 변환
      const context = this.laneStateToContext(laneName, runId, laneState);
      
      this.contexts.set(laneName, context);
      this.history.set(laneName, []);
      
      events.emit(StateEventType.RESTORED as any, {
        laneName,
        filePath: statePath,
        state: laneState,
      });
      
      this.log(`[${laneName}] State restored from ${statePath}`);
      
      return context;
    } catch (error: any) {
      logger.error(`[StateMachine] Failed to restore state for ${laneName}: ${error.message}`);
      
      events.emit(StateEventType.CORRUPTED as any, {
        laneName,
        filePath: statePath,
        issues: [error.message],
      });
      
      return null;
    }
  }
  
  /**
   * 컨텍스트를 기존 LaneState 형식으로 변환
   */
  private contextToLaneState(context: LaneStateContext): Record<string, any> {
    return {
      label: context.laneName,
      status: context.primaryState,
      currentTaskIndex: context.currentTaskIndex,
      totalTasks: context.totalTasks,
      worktreeDir: context.worktreeDir || null,
      pipelineBranch: context.pipelineBranch || null,
      startTime: context.startTime,
      endTime: context.endTime || null,
      error: context.lastError || null,
      dependencyRequest: null,
      updatedAt: Date.now(),
      tasksFile: context.metadata?.tasksFile,
      pid: context.pid,
      completedTasks: context.completedTasks,
      waitingFor: context.waitingFor,
      chatId: context.chatId,
      // 확장 필드
      subState: context.subState,
      recoveryState: context.recoveryState,
      restartCount: context.restartCount,
      currentTaskName: context.currentTaskName,
      taskBranch: context.taskBranch,
    };
  }
  
  /**
   * 기존 LaneState에서 컨텍스트로 변환
   */
  private laneStateToContext(
    laneName: string, 
    runId: string, 
    laneState: Record<string, any>
  ): LaneStateContext {
    return {
      laneName,
      runId,
      primaryState: (laneState.status as LanePrimaryState) || LanePrimaryState.PENDING,
      subState: (laneState.subState as LaneSubState) || LaneSubState.NONE,
      recoveryState: (laneState.recoveryState as RecoveryState) || RecoveryState.IDLE,
      currentTaskIndex: laneState.currentTaskIndex || 0,
      totalTasks: laneState.totalTasks || 0,
      completedTasks: laneState.completedTasks || [],
      currentTaskName: laneState.currentTaskName,
      waitingFor: laneState.waitingFor,
      lastError: laneState.error,
      restartCount: laneState.restartCount || 0,
      startTime: laneState.startTime || Date.now(),
      endTime: laneState.endTime,
      lastTransitionTime: laneState.updatedAt || Date.now(),
      worktreeDir: laneState.worktreeDir,
      pipelineBranch: laneState.pipelineBranch,
      taskBranch: laneState.taskBranch,
      pid: laneState.pid,
      chatId: laneState.chatId,
      metadata: {
        tasksFile: laneState.tasksFile,
      },
    };
  }
  
  // --------------------------------------------------------------------------
  // Event Handling
  // --------------------------------------------------------------------------
  
  /**
   * 상태 전이 콜백 등록
   */
  onTransition(callback: (laneName: string, result: StateTransitionResult) => void): () => void {
    this.onTransitionCallbacks.push(callback);
    
    return () => {
      const index = this.onTransitionCallbacks.indexOf(callback);
      if (index > -1) {
        this.onTransitionCallbacks.splice(index, 1);
      }
    };
  }
  
  /**
   * 전이 콜백 실행
   */
  private notifyTransition(laneName: string, result: StateTransitionResult): void {
    for (const callback of this.onTransitionCallbacks) {
      try {
        callback(laneName, result);
      } catch (error) {
        logger.error(`[StateMachine] Callback error: ${error}`);
      }
    }
  }
  
  /**
   * 전이 이벤트 발행
   */
  private emitTransition(
    laneName: string, 
    context: LaneStateContext, 
    fromState: LanePrimaryState,
    trigger: StateTransitionTrigger
  ): void {
    const payload: StateTransitionPayload = {
      laneName,
      fromState,
      toState: context.primaryState,
      trigger,
      timestamp: Date.now(),
    };
    
    events.emit(StateEventType.TRANSITION as any, payload);
  }
  
  /**
   * 전이 실패 이벤트 발행
   */
  private emitTransitionFailed(
    laneName: string,
    context: LaneStateContext,
    trigger: StateTransitionTrigger,
    reason: string
  ): void {
    const payload: StateTransitionFailedPayload = {
      laneName,
      fromState: context.primaryState,
      attemptedState: 'unknown',
      trigger,
      reason,
    };
    
    events.emit(StateEventType.TRANSITION_FAILED as any, payload);
  }
  
  // --------------------------------------------------------------------------
  // Query Methods
  // --------------------------------------------------------------------------
  
  /**
   * 특정 상태의 Lane들 조회
   */
  getLanesInState(state: LanePrimaryState): string[] {
    const result: string[] = [];
    for (const [laneName, context] of this.contexts) {
      if (context.primaryState === state) {
        result.push(laneName);
      }
    }
    return result;
  }
  
  /**
   * 활성 상태 Lane들 조회 (종료되지 않은)
   */
  getActiveLanes(): string[] {
    const result: string[] = [];
    for (const [laneName, context] of this.contexts) {
      if (!this.isTerminalState(context.primaryState)) {
        result.push(laneName);
      }
    }
    return result;
  }
  
  /**
   * 전이 히스토리 조회
   */
  getHistory(laneName: string): Array<{
    timestamp: number;
    fromState: LanePrimaryState;
    toState: LanePrimaryState;
    trigger: StateTransitionTrigger;
  }> {
    return this.history.get(laneName) || [];
  }
  
  /**
   * 전체 상태 요약 조회
   */
  getSummary(): Record<LanePrimaryState, number> {
    const summary: Record<string, number> = {};
    
    for (const state of Object.values(LanePrimaryState)) {
      summary[state] = 0;
    }
    
    for (const context of this.contexts.values()) {
      summary[context.primaryState]++;
    }
    
    return summary as Record<LanePrimaryState, number>;
  }
  
  // --------------------------------------------------------------------------
  // Utility
  // --------------------------------------------------------------------------
  
  /**
   * 로깅
   */
  private log(message: string): void {
    if (this.verbose) {
      logger.debug(`[StateMachine] ${message}`);
    }
  }
  
  /**
   * 디버그 모드 설정
   */
  setVerbose(verbose: boolean): void {
    this.verbose = verbose;
  }
  
  /**
   * 디버그 덤프
   */
  dumpState(laneName: string): string {
    const context = this.contexts.get(laneName);
    if (!context) return `Lane not found: ${laneName}`;
    
    return JSON.stringify({
      ...context,
      historyLength: this.history.get(laneName)?.length || 0,
    }, null, 2);
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * 싱글톤 인스턴스 획득
 */
export function getStateMachine(): LaneStateMachine {
  return LaneStateMachine.getInstance();
}

/**
 * 인스턴스 리셋 (테스트용)
 */
export function resetStateMachine(): void {
  LaneStateMachine.resetInstance();
}

/**
 * LanePrimaryState를 기존 LaneStatus로 변환 (호환성)
 */
export function primaryStateToLaneStatus(state: LanePrimaryState): string {
  switch (state) {
    case LanePrimaryState.PENDING:
    case LanePrimaryState.INITIALIZING:
      return 'pending';
    case LanePrimaryState.RUNNING:
      return 'running';
    case LanePrimaryState.WAITING:
      return 'waiting';
    case LanePrimaryState.PAUSED:
      return 'paused';
    case LanePrimaryState.RECOVERING:
      return 'running'; // 복구 중은 running으로 표시
    case LanePrimaryState.COMPLETED:
      return 'completed';
    case LanePrimaryState.FAILED:
    case LanePrimaryState.ABORTED:
      return 'failed';
    default:
      return 'unknown';
  }
}


/**
 * CursorFlow Hook System - Type Definitions
 * 
 * 외부 개발자가 Supervisor AI, 모니터링 시스템 등을 구현할 수 있도록
 * 제공하는 Hook API의 타입 정의입니다.
 * 
 * @example
 * ```typescript
 * import { hooks, HookPoint, HookContext } from '@litmers/cursorflow-orchestrator';
 * 
 * hooks.register({
 *   point: HookPoint.AFTER_TASK,
 *   mode: 'sync',
 *   handler: async (ctx) => {
 *     const files = await ctx.getData.git.getChangedFiles();
 *     // ... your logic
 *   },
 * });
 * ```
 */

// ============================================================================
// Hook Point Definitions
// ============================================================================

/**
 * Hook Point - Hook이 트리거되는 시점
 * 
 * 5개의 핵심 Hook Point만 제공하여 단순성을 유지합니다.
 */
export enum HookPoint {
  /** 태스크 실행 직전 - 프롬프트 검토/수정, 사전 조건 검증 */
  BEFORE_TASK = 'beforeTask',
  /** 태스크 완료 직후 - 결과 리뷰, 품질 검사, 추가 태스크 삽입 */
  AFTER_TASK = 'afterTask',
  /** 에러 발생 시 - 에러 분석, 복구 전략 결정 */
  ON_ERROR = 'onError',
  /** 응답 없음 감지 시 - 상황 분석, 개입 메시지 전송 */
  ON_STALL = 'onStall',
  /** Lane 종료 시 - 최종 리뷰, 보고서 생성 */
  ON_LANE_END = 'onLaneEnd',
}

/**
 * Hook 실행 모드
 */
export type HookMode = 'sync' | 'async';

// ============================================================================
// Data Types
// ============================================================================

/**
 * Git 변경 파일 정보
 */
export interface ChangedFile {
  /** 파일 경로 */
  path: string;
  /** 변경 상태 */
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  /** 추가된 라인 수 */
  additions: number;
  /** 삭제된 라인 수 */
  deletions: number;
  /** 개별 파일 diff (선택적 로드) */
  diff?: string;
}

/**
 * Git 커밋 정보
 */
export interface Commit {
  /** 커밋 해시 */
  hash: string;
  /** 커밋 메시지 */
  message: string;
  /** 작성자 */
  author: string;
  /** 작성 일시 */
  date: string;
  /** 변경된 파일 목록 */
  files: string[];
}

/**
 * 대화 메시지
 */
export interface Message {
  /** 메시지 역할 */
  role: 'user' | 'assistant' | 'system';
  /** 메시지 내용 */
  content: string;
  /** 타임스탬프 (ISO 8601) */
  timestamp: string;
  /** 해당 태스크 이름 */
  taskName?: string;
  /** 추가 메타데이터 */
  metadata?: Record<string, any>;
}

/**
 * 태스크 실행 결과
 */
export interface TaskResult {
  /** 태스크 이름 */
  name: string;
  /** 실행 상태 */
  status: 'success' | 'error' | 'blocked' | 'skipped';
  /** 소요 시간 (ms) */
  duration: number;
  /** 출력 결과 */
  output?: string;
  /** 에러 메시지 */
  error?: string;
}

/**
 * 태스크 정의 (새 태스크 삽입 시 사용)
 */
export interface TaskDefinition {
  /** 태스크 이름 */
  name: string;
  /** 프롬프트 */
  prompt: string;
  /** AI 모델 (선택) */
  model?: string;
  /** 타임아웃 (ms, 선택) */
  timeout?: number;
  /** 의존성 태스크 (선택) */
  dependsOn?: string[];
}

/**
 * Tool Call 정보 (AI가 호출한 도구)
 */
export interface ToolCall {
  /** 도구 이름 */
  name: string;
  /** 파라미터 */
  parameters: Record<string, any>;
  /** 결과 */
  result?: any;
  /** 타임스탬프 */
  timestamp: string;
}

/**
 * 에러 로그 항목
 */
export interface ErrorLog {
  /** 로그 레벨 */
  level: 'error' | 'warn';
  /** 메시지 */
  message: string;
  /** 타임스탬프 */
  timestamp: string;
  /** 추가 컨텍스트 */
  context?: Record<string, any>;
}

/**
 * 의존성 태스크 결과 (dependsOn으로 지정된 태스크의 결과)
 */
export interface DependencyResult {
  /** 의존성 태스크 이름 */
  taskName: string;
  /** Lane 이름 */
  laneName: string;
  /** 실행 상태 */
  status: 'success' | 'error' | 'pending';
  /** 출력 결과 */
  output?: string;
  /** 브랜치 이름 */
  branch?: string;
}

// ============================================================================
// Data Accessor Interface
// ============================================================================

/**
 * Hook에서 데이터에 접근하기 위한 인터페이스
 * 
 * 모든 메서드는 Lazy Loading으로 필요할 때만 데이터를 로드합니다.
 */
export interface HookDataAccessor {
  /**
   * Git 관련 데이터 접근
   */
  git: {
    /** 현재 태스크에서 수정된 파일 목록 */
    getChangedFiles(): Promise<ChangedFile[]>;
    /** 현재 브랜치의 전체 diff */
    getDiff(): Promise<string>;
    /** 최근 N개 커밋 (기본: 10) */
    getRecentCommits(count?: number): Promise<Commit[]>;
    /** 현재 브랜치 이름 */
    getCurrentBranch(): string;
    /** 충돌 파일 목록 (있는 경우) */
    getConflictFiles(): Promise<string[]>;
  };
  
  /**
   * 대화 기록 접근
   */
  conversation: {
    /** 현재 태스크의 대화 기록 */
    getCurrentTaskMessages(): Promise<Message[]>;
    /** 전체 Lane의 대화 기록 */
    getAllMessages(): Promise<Message[]>;
    /** 최근 N개 메시지 (기본: 10) */
    getRecentMessages(count?: number): Promise<Message[]>;
    /** AI의 마지막 응답 */
    getLastResponse(): Promise<string | null>;
  };
  
  /**
   * 태스크 상태 접근
   */
  tasks: {
    /** 완료된 태스크 목록 */
    getCompletedTasks(): TaskResult[];
    /** 남은 태스크 목록 */
    getPendingTasks(): TaskDefinition[];
    /** 특정 태스크의 결과 */
    getTaskResult(taskName: string): TaskResult | null;
    /** 의존성 태스크 결과 (dependsOn으로 지정된) */
    getDependencyResults(): DependencyResult[];
  };
  
  /**
   * 로그/출력 접근
   */
  logs: {
    /** 현재 태스크의 raw 출력 */
    getRawOutput(): Promise<string>;
    /** 파싱된 tool_call 목록 */
    getToolCalls(): Promise<ToolCall[]>;
    /** 에러 로그 */
    getErrors(): Promise<ErrorLog[]>;
  };
  
  /**
   * 타이밍 정보
   */
  timing: {
    /** 태스크 시작 시간 (Unix timestamp) */
    taskStartTime: number;
    /** Lane 시작 시간 (Unix timestamp) */
    laneStartTime: number;
    /** 현재 태스크 소요 시간 (ms) */
    getElapsedTime(): number;
  };
}

// ============================================================================
// Flow Controller Interface
// ============================================================================

/**
 * AI 호출 옵션
 */
export interface AICallOptions {
  /** 사용할 모델 */
  model?: string;
  /** 타임아웃 (ms) */
  timeout?: number;
  /** 추가 컨텍스트 */
  context?: Record<string, any>;
}

/**
 * 플로우 제어 인터페이스
 * 
 * Hook 핸들러에서 실행 플로우를 제어하기 위한 메서드들을 제공합니다.
 */
export interface FlowController {
  // === 플로우 제어 ===
  
  /**
   * 플로우 일시 중지
   * @param reason 중지 사유
   */
  pause(reason: string): Promise<void>;
  
  /**
   * 플로우 재개
   * @param data 재개 시 전달할 데이터 (선택)
   */
  resume(data?: any): void;
  
  /**
   * Lane 중단
   * @param reason 중단 사유
   */
  abort(reason: string): void;
  
  /**
   * 현재 태스크 재시도
   * @param options 재시도 옵션
   */
  retry(options?: { modifiedPrompt?: string }): void;
  
  // === 태스크 조작 ===
  
  /**
   * 다음에 실행할 태스크 삽입
   * @param task 삽입할 태스크 정의
   */
  injectTask(task: TaskDefinition): void;
  
  /**
   * 현재 태스크 프롬프트 수정 (beforeTask에서만 유효)
   * @param newPrompt 새 프롬프트
   */
  modifyCurrentPrompt(newPrompt: string): void;
  
  /**
   * 다음 태스크 수정
   * @param modifier 수정 함수
   */
  modifyNextTask(modifier: (task: TaskDefinition) => TaskDefinition): void;
  
  /**
   * 남은 태스크 전체 교체
   * @param tasks 새 태스크 목록
   */
  replaceRemainingTasks(tasks: TaskDefinition[]): void;
  
  // === 에이전트 통신 ===
  
  /**
   * AI 에이전트에게 메시지 전송 (현재 세션)
   * @param message 전송할 메시지
   * @returns AI 응답
   */
  sendMessage(message: string): Promise<string>;
  
  /**
   * 별도 AI 호출 (새 세션)
   * @param prompt 프롬프트
   * @param options 옵션
   * @returns AI 응답
   */
  callAI(prompt: string, options?: AICallOptions): Promise<string>;
}

// ============================================================================
// Hook Context Interfaces
// ============================================================================

/**
 * 기본 Hook 컨텍스트 (모든 Hook 공통)
 */
export interface HookContext {
  // === 기본 정보 ===
  
  /** Lane 이름 */
  laneName: string;
  /** Run ID */
  runId: string;
  /** 현재 태스크 인덱스 (0-based) */
  taskIndex: number;
  /** 전체 태스크 수 */
  totalTasks: number;
  
  // === 현재 태스크 정보 ===
  
  /** 현재 태스크 */
  task: {
    /** 태스크 이름 */
    name: string;
    /** 원본 프롬프트 */
    prompt: string;
    /** AI 모델 */
    model: string;
    /** 의존성 태스크 목록 */
    dependsOn?: string[];
  };
  
  // === 플로우 제어 ===
  
  /** 플로우 컨트롤러 */
  flow: FlowController;
  
  // === 데이터 접근 ===
  
  /** 데이터 접근자 */
  getData: HookDataAccessor;
}

/**
 * beforeTask Hook 컨텍스트
 * 
 * 태스크 실행 직전에 호출됩니다.
 * `flow.modifyCurrentPrompt()`로 프롬프트를 수정할 수 있습니다.
 */
export interface BeforeTaskContext extends HookContext {
  // 추가 필드 없음 - 기본 컨텍스트만 사용
}

/**
 * afterTask Hook 컨텍스트
 * 
 * 태스크 완료 직후에 호출됩니다.
 * 결과를 분석하고 추가 태스크를 삽입하거나 재시도를 요청할 수 있습니다.
 */
export interface AfterTaskContext extends HookContext {
  /** 태스크 실행 결과 */
  result: {
    /** 실행 상태 */
    status: 'success' | 'error' | 'blocked';
    /** 종료 코드 */
    exitCode?: number;
    /** 에러 메시지 */
    error?: string;
  };
}

/**
 * onError Hook 컨텍스트
 * 
 * 에러 발생 시 호출됩니다.
 * 에러를 분석하고 복구 전략을 결정할 수 있습니다.
 */
export interface OnErrorContext extends HookContext {
  /** 에러 정보 */
  error: {
    /** 에러 타입 */
    type: 'agent_error' | 'git_error' | 'timeout' | 'unknown';
    /** 에러 메시지 */
    message: string;
    /** 스택 트레이스 */
    stack?: string;
    /** 재시도 가능 여부 */
    retryable: boolean;
  };
}

/**
 * onStall Hook 컨텍스트
 * 
 * AI 응답이 없을 때(Stall) 호출됩니다.
 * 상황을 분석하고 개입 메시지를 전송할 수 있습니다.
 */
export interface OnStallContext extends HookContext {
  /** Stall 정보 */
  stall: {
    /** 유휴 시간 (ms) */
    idleTimeMs: number;
    /** 마지막 활동 내용 */
    lastActivity: string;
    /** 수신된 바이트 수 */
    bytesReceived: number;
    /** Stall 단계 */
    phase: 'initial' | 'warning' | 'critical';
  };
}

/**
 * onLaneEnd Hook 컨텍스트
 * 
 * Lane 종료 시 호출됩니다.
 * 최종 리뷰나 보고서 생성에 활용할 수 있습니다.
 */
export interface OnLaneEndContext extends HookContext {
  /** Lane 종료 요약 */
  summary: {
    /** 종료 상태 */
    status: 'completed' | 'failed' | 'aborted';
    /** 완료된 태스크 수 */
    completedTasks: number;
    /** 실패한 태스크 수 */
    failedTasks: number;
    /** 총 소요 시간 (ms) */
    totalDuration: number;
  };
}

// ============================================================================
// Hook Registration Types
// ============================================================================

/**
 * Hook 핸들러 타입 맵
 */
export interface HookHandlerMap {
  [HookPoint.BEFORE_TASK]: (ctx: BeforeTaskContext) => void | Promise<void>;
  [HookPoint.AFTER_TASK]: (ctx: AfterTaskContext) => void | Promise<void>;
  [HookPoint.ON_ERROR]: (ctx: OnErrorContext) => void | Promise<void>;
  [HookPoint.ON_STALL]: (ctx: OnStallContext) => void | Promise<void>;
  [HookPoint.ON_LANE_END]: (ctx: OnLaneEndContext) => void | Promise<void>;
}

/**
 * Hook 등록 옵션
 */
export interface HookRegistration<T extends HookPoint = HookPoint> {
  /** Hook Point */
  point: T;
  /** 실행 모드: 'sync' (블로킹) | 'async' (논블로킹) */
  mode: HookMode;
  /** 핸들러 함수 */
  handler: HookHandlerMap[T];
  /** 실행 우선순위 (낮을수록 먼저 실행, 기본: 50) */
  priority?: number;
  /** 핸들러 이름 (디버깅용) */
  name?: string;
  /** 활성화 여부 (기본: true) */
  enabled?: boolean;
}

/**
 * Hook 실행 결과
 */
export interface HookExecutionResult {
  /** 성공 여부 */
  success: boolean;
  /** 에러 (실패 시) */
  error?: Error;
  /** 실행 시간 (ms) */
  duration: number;
  /** 핸들러 이름 */
  handlerName?: string;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Hook 시스템 설정 (cursorflow.json에서 사용)
 */
export interface HooksConfig {
  /** Hook 정의 파일 경로 */
  file?: string;
  /** Hook 실행 타임아웃 (ms, 기본: 30000) */
  timeout?: number;
  /** 에러 시 계속 진행 여부 (기본: false) */
  continueOnError?: boolean;
  /** 디버그 모드 */
  debug?: boolean;
}


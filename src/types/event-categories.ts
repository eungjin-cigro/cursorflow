/**
 * Event Categories & Registry System
 * 
 * 이벤트를 출처와 책임에 따라 명확하게 분류합니다.
 * 
 * 카테고리:
 * - ORCHESTRATION: 전체 실행 흐름 관리 이벤트
 * - LANE: 개별 Lane 생명주기 이벤트
 * - TASK: Task 실행 관련 이벤트
 * - GIT: Git 작업 관련 이벤트
 * - RECOVERY: 복구 및 재시도 관련 이벤트
 * - AGENT: AI Agent 통신 관련 이벤트
 * - STATE: 상태 전이 관련 이벤트
 * - SYSTEM: 시스템 수준 이벤트
 */

// ============================================================================
// Event Categories (출처별 분류)
// ============================================================================

/**
 * 이벤트 카테고리 - 이벤트의 출처와 책임을 정의
 */
export enum EventCategory {
  /** 전체 실행 흐름 관리 (Orchestrator 책임) */
  ORCHESTRATION = 'orchestration',
  /** 개별 Lane 생명주기 (Runner 책임) */
  LANE = 'lane',
  /** Task 실행 (Runner/Pipeline 책임) */
  TASK = 'task',
  /** Git 작업 (GitLifecycleManager 책임) */
  GIT = 'git',
  /** 복구 및 재시도 (RecoveryManager 책임) */
  RECOVERY = 'recovery',
  /** AI Agent 통신 (AgentSupervisor 책임) */
  AGENT = 'agent',
  /** 상태 전이 (StateMachine 책임) */
  STATE = 'state',
  /** 시스템 수준 (Infrastructure 책임) */
  SYSTEM = 'system',
}

// ============================================================================
// Event Types per Category
// ============================================================================

/**
 * Orchestration 이벤트 타입
 */
export enum OrchestrationEventType {
  /** 오케스트레이션 시작 */
  STARTED = 'orchestration.started',
  /** 모든 Lane 완료 */
  COMPLETED = 'orchestration.completed',
  /** 오케스트레이션 실패 */
  FAILED = 'orchestration.failed',
  /** 의존성 사이클 감지 */
  CYCLE_DETECTED = 'orchestration.cycle_detected',
  /** 교착 상태 감지 */
  DEADLOCK_DETECTED = 'orchestration.deadlock_detected',
}

/**
 * Lane 이벤트 타입
 */
export enum LaneEventType {
  /** Lane 시작 */
  STARTED = 'lane.started',
  /** Lane 완료 */
  COMPLETED = 'lane.completed',
  /** Lane 실패 */
  FAILED = 'lane.failed',
  /** Lane 일시 중지 */
  PAUSED = 'lane.paused',
  /** Lane 재개 */
  RESUMED = 'lane.resumed',
  /** 의존성 대기 시작 */
  WAITING = 'lane.waiting',
  /** 의존성 블록 (외부 개입 필요) */
  BLOCKED = 'lane.blocked',
  /** 의존성 요청 */
  DEPENDENCY_REQUESTED = 'lane.dependency_requested',
}

/**
 * Task 이벤트 타입
 */
export enum TaskEventType {
  /** Task 시작 */
  STARTED = 'task.started',
  /** Task 완료 */
  COMPLETED = 'task.completed',
  /** Task 실패 */
  FAILED = 'task.failed',
  /** Task 재시도 */
  RETRY = 'task.retry',
  /** Task 스킵 */
  SKIPPED = 'task.skipped',
  /** Task 의존성 대기 */
  WAITING_DEPENDENCY = 'task.waiting_dependency',
  /** Task 의존성 해결됨 */
  DEPENDENCY_RESOLVED = 'task.dependency_resolved',
}

/**
 * Git 이벤트 타입
 */
export enum GitEventType {
  /** 브랜치 생성 */
  BRANCH_CREATED = 'git.branch_created',
  /** 브랜치 체크아웃 */
  BRANCH_CHECKED_OUT = 'git.branch_checked_out',
  /** 워크트리 생성 */
  WORKTREE_CREATED = 'git.worktree_created',
  /** 워크트리 정리 */
  WORKTREE_CLEANED = 'git.worktree_cleaned',
  /** 커밋 생성 */
  COMMITTED = 'git.committed',
  /** 푸시 완료 */
  PUSHED = 'git.pushed',
  /** 머지 시작 */
  MERGE_STARTED = 'git.merge_started',
  /** 머지 완료 */
  MERGE_COMPLETED = 'git.merge_completed',
  /** 머지 충돌 감지 */
  MERGE_CONFLICT = 'git.merge_conflict',
  /** 푸시 거부 */
  PUSH_REJECTED = 'git.push_rejected',
  /** Git 오류 */
  ERROR = 'git.error',
  /** 의존성 브랜치 동기화 */
  DEPENDENCY_SYNCED = 'git.dependency_synced',
}

/**
 * Recovery 이벤트 타입
 */
export enum RecoveryEventType {
  /** 복구 시작 */
  STARTED = 'recovery.started',
  /** Continue 신호 발송 */
  CONTINUE_SIGNAL = 'recovery.continue_signal',
  /** Stronger prompt 발송 */
  STRONGER_PROMPT = 'recovery.stronger_prompt',
  /** 프로세스 재시작 */
  RESTART = 'recovery.restart',
  /** 진단 실행 */
  DIAGNOSED = 'recovery.diagnosed',
  /** 복구 성공 */
  RECOVERED = 'recovery.recovered',
  /** 복구 실패 (포기) */
  ABORTED = 'recovery.aborted',
  /** 충돌 해결 */
  CONFLICT_RESOLVED = 'recovery.conflict_resolved',
}

/**
 * Agent 이벤트 타입
 */
export enum AgentEventType {
  /** 프롬프트 전송 */
  PROMPT_SENT = 'agent.prompt_sent',
  /** 응답 수신 */
  RESPONSE_RECEIVED = 'agent.response_received',
  /** 스트리밍 시작 */
  STREAMING_STARTED = 'agent.streaming_started',
  /** 스트리밍 종료 */
  STREAMING_ENDED = 'agent.streaming_ended',
  /** 연결 오류 */
  CONNECTION_ERROR = 'agent.connection_error',
  /** 인증 오류 */
  AUTH_ERROR = 'agent.auth_error',
  /** Rate limit */
  RATE_LIMITED = 'agent.rate_limited',
  /** 타임아웃 */
  TIMEOUT = 'agent.timeout',
}

/**
 * State 이벤트 타입 (상태 머신 전이)
 */
export enum StateEventType {
  /** 상태 전이 */
  TRANSITION = 'state.transition',
  /** 상태 전이 실패 (잘못된 전이) */
  TRANSITION_FAILED = 'state.transition_failed',
  /** 상태 저장 */
  PERSISTED = 'state.persisted',
  /** 상태 복구 */
  RESTORED = 'state.restored',
  /** 상태 손상 감지 */
  CORRUPTED = 'state.corrupted',
  /** 상태 복구 완료 */
  REPAIRED = 'state.repaired',
}

/**
 * System 이벤트 타입
 */
export enum SystemEventType {
  /** 시스템 시작 */
  STARTUP = 'system.startup',
  /** 시스템 종료 */
  SHUTDOWN = 'system.shutdown',
  /** Health check 완료 */
  HEALTH_CHECK = 'system.health_check',
  /** 설정 로드 */
  CONFIG_LOADED = 'system.config_loaded',
  /** 로그 파일 로테이션 */
  LOG_ROTATED = 'system.log_rotated',
  /** 시그널 수신 (SIGINT, SIGTERM 등) */
  SIGNAL_RECEIVED = 'system.signal_received',
}

// ============================================================================
// Union Type for All Event Types
// ============================================================================

export type AllEventTypes =
  | OrchestrationEventType
  | LaneEventType
  | TaskEventType
  | GitEventType
  | RecoveryEventType
  | AgentEventType
  | StateEventType
  | SystemEventType;

// ============================================================================
// Event Payloads per Category
// ============================================================================

// --- Orchestration Payloads ---

export interface OrchestrationStartedPayload {
  runId: string;
  tasksDir: string;
  laneCount: number;
  runRoot: string;
  pipelineBranch?: string;
}

export interface OrchestrationCompletedPayload {
  runId: string;
  laneCount: number;
  completedCount: number;
  failedCount: number;
  duration: number;
}

export interface OrchestrationFailedPayload {
  runId: string;
  error: string;
  blockedLanes?: string[];
  failedLanes?: string[];
}

export interface CycleDetectedPayload {
  runId: string;
  cycle: string[];
  affectedLanes: string[];
}

// --- Lane Payloads ---

export interface LaneStartedPayload {
  laneName: string;
  pid?: number;
  logPath: string;
  worktreeDir?: string;
  pipelineBranch?: string;
}

export interface LaneCompletedPayload {
  laneName: string;
  exitCode: number;
  duration: number;
  tasksCompleted: number;
}

export interface LaneFailedPayload {
  laneName: string;
  exitCode: number;
  error: string;
  taskIndex?: number;
  taskName?: string;
}

export interface LaneWaitingPayload {
  laneName: string;
  waitingFor: string[];
  timeout?: number;
}

export interface LaneBlockedPayload {
  laneName: string;
  dependencyRequest: {
    commands?: string[];
    changes?: string[];
    reason: string;
  };
}

// --- Task Payloads ---

export interface TaskStartedPayload {
  laneName: string;
  taskName: string;
  taskIndex: number;
  taskBranch: string;
  dependencies?: string[];
}

export interface TaskCompletedPayload {
  laneName: string;
  taskName: string;
  taskIndex: number;
  taskBranch: string;
  duration: number;
  status: 'success' | 'partial';
}

export interface TaskFailedPayload {
  laneName: string;
  taskName: string;
  taskIndex: number;
  taskBranch: string;
  error: string;
  retryable: boolean;
}

export interface TaskRetryPayload {
  laneName: string;
  taskName: string;
  taskIndex: number;
  retryCount: number;
  maxRetries: number;
  reason: string;
}

export interface TaskWaitingDependencyPayload {
  laneName: string;
  taskName: string;
  taskIndex: number;
  waitingFor: string[];
  startedAt: number;
}

// --- Git Payloads ---

export interface GitBranchCreatedPayload {
  laneName?: string;
  branchName: string;
  baseBranch: string;
  worktreeDir?: string;
}

export interface GitCommittedPayload {
  laneName?: string;
  branchName: string;
  commitHash: string;
  message: string;
  filesChanged: number;
}

export interface GitPushedPayload {
  laneName?: string;
  branchName: string;
  remote: string;
  commitHash: string;
}

export interface GitMergeStartedPayload {
  laneName?: string;
  sourceBranch: string;
  targetBranch: string;
  mergeType: 'task_to_pipeline' | 'dependency' | 'final';
}

export interface GitMergeCompletedPayload {
  laneName?: string;
  sourceBranch: string;
  targetBranch: string;
  mergeCommit: string;
  filesChanged: number;
}

export interface GitMergeConflictPayload {
  laneName?: string;
  sourceBranch: string;
  targetBranch: string;
  conflictingFiles: string[];
  preCheck: boolean;
}

export interface GitPushRejectedPayload {
  laneName?: string;
  branchName: string;
  reason: string;
  hint?: string;
}

export interface GitErrorPayload {
  laneName?: string;
  operation: string;
  error: string;
  recoverable: boolean;
}

// --- Recovery Payloads ---

export interface RecoveryStartedPayload {
  laneName: string;
  reason: string;
  phase: number;
}

export interface RecoveryContinueSignalPayload {
  laneName: string;
  idleSeconds: number;
  signalCount: number;
}

export interface RecoveryStrongerPromptPayload {
  laneName: string;
  prompt?: string;
  previousAttempts: number;
}

export interface RecoveryRestartPayload {
  laneName: string;
  restartCount: number;
  maxRestarts: number;
  reason: string;
}

export interface RecoveryDiagnosedPayload {
  laneName: string;
  diagnostic: {
    timestamp: number;
    agentHealthy: boolean;
    authHealthy: boolean;
    systemHealthy: boolean;
    suggestedAction: string;
    details: string;
    issues?: string[];
  };
}

export interface RecoveryConflictResolvedPayload {
  laneName?: string;
  strategy: string;
  resolvedFiles: string[];
  unresolvedFiles: string[];
  success: boolean;
}

// --- Agent Payloads ---

export interface AgentPromptSentPayload {
  laneName: string;
  taskName: string;
  model: string;
  promptLength: number;
  chatId?: string;
}

export interface AgentResponseReceivedPayload {
  laneName: string;
  taskName: string;
  ok: boolean;
  duration: number;
  responseLength: number;
  error?: string;
}

export interface AgentConnectionErrorPayload {
  laneName: string;
  error: string;
  retryable: boolean;
}

// --- State Payloads ---

export interface StateTransitionPayload {
  laneName: string;
  fromState: string;
  toState: string;
  trigger: string;
  timestamp: number;
}

export interface StateTransitionFailedPayload {
  laneName: string;
  fromState: string;
  attemptedState: string;
  trigger: string;
  reason: string;
}

export interface StateCorruptedPayload {
  laneName: string;
  filePath: string;
  issues: string[];
}

export interface StateRepairedPayload {
  laneName: string;
  filePath: string;
  repairedFields: string[];
}

// --- System Payloads ---

export interface SystemHealthCheckPayload {
  healthy: boolean;
  checks: Array<{
    name: string;
    ok: boolean;
    message: string;
  }>;
}

export interface SystemSignalReceivedPayload {
  signal: string;
  action: 'shutdown' | 'restart' | 'ignore';
}

// ============================================================================
// Event Payload Map (타입-페이로드 매핑)
// ============================================================================

export interface EventPayloadMap {
  // Orchestration
  [OrchestrationEventType.STARTED]: OrchestrationStartedPayload;
  [OrchestrationEventType.COMPLETED]: OrchestrationCompletedPayload;
  [OrchestrationEventType.FAILED]: OrchestrationFailedPayload;
  [OrchestrationEventType.CYCLE_DETECTED]: CycleDetectedPayload;
  [OrchestrationEventType.DEADLOCK_DETECTED]: OrchestrationFailedPayload;
  
  // Lane
  [LaneEventType.STARTED]: LaneStartedPayload;
  [LaneEventType.COMPLETED]: LaneCompletedPayload;
  [LaneEventType.FAILED]: LaneFailedPayload;
  [LaneEventType.PAUSED]: { laneName: string; reason: string };
  [LaneEventType.RESUMED]: { laneName: string };
  [LaneEventType.WAITING]: LaneWaitingPayload;
  [LaneEventType.BLOCKED]: LaneBlockedPayload;
  [LaneEventType.DEPENDENCY_REQUESTED]: LaneBlockedPayload;
  
  // Task
  [TaskEventType.STARTED]: TaskStartedPayload;
  [TaskEventType.COMPLETED]: TaskCompletedPayload;
  [TaskEventType.FAILED]: TaskFailedPayload;
  [TaskEventType.RETRY]: TaskRetryPayload;
  [TaskEventType.SKIPPED]: { laneName: string; taskName: string; reason: string };
  [TaskEventType.WAITING_DEPENDENCY]: TaskWaitingDependencyPayload;
  [TaskEventType.DEPENDENCY_RESOLVED]: { laneName: string; taskName: string; resolvedDependency: string };
  
  // Git
  [GitEventType.BRANCH_CREATED]: GitBranchCreatedPayload;
  [GitEventType.BRANCH_CHECKED_OUT]: { laneName?: string; branchName: string };
  [GitEventType.WORKTREE_CREATED]: { laneName?: string; worktreeDir: string; branchName: string };
  [GitEventType.WORKTREE_CLEANED]: { laneName?: string; worktreeDir: string };
  [GitEventType.COMMITTED]: GitCommittedPayload;
  [GitEventType.PUSHED]: GitPushedPayload;
  [GitEventType.MERGE_STARTED]: GitMergeStartedPayload;
  [GitEventType.MERGE_COMPLETED]: GitMergeCompletedPayload;
  [GitEventType.MERGE_CONFLICT]: GitMergeConflictPayload;
  [GitEventType.PUSH_REJECTED]: GitPushRejectedPayload;
  [GitEventType.ERROR]: GitErrorPayload;
  [GitEventType.DEPENDENCY_SYNCED]: { laneName?: string; sourceBranch: string; targetBranch: string };
  
  // Recovery
  [RecoveryEventType.STARTED]: RecoveryStartedPayload;
  [RecoveryEventType.CONTINUE_SIGNAL]: RecoveryContinueSignalPayload;
  [RecoveryEventType.STRONGER_PROMPT]: RecoveryStrongerPromptPayload;
  [RecoveryEventType.RESTART]: RecoveryRestartPayload;
  [RecoveryEventType.DIAGNOSED]: RecoveryDiagnosedPayload;
  [RecoveryEventType.RECOVERED]: { laneName: string; recoveryAction: string };
  [RecoveryEventType.ABORTED]: { laneName: string; reason: string };
  [RecoveryEventType.CONFLICT_RESOLVED]: RecoveryConflictResolvedPayload;
  
  // Agent
  [AgentEventType.PROMPT_SENT]: AgentPromptSentPayload;
  [AgentEventType.RESPONSE_RECEIVED]: AgentResponseReceivedPayload;
  [AgentEventType.STREAMING_STARTED]: { laneName: string; taskName: string };
  [AgentEventType.STREAMING_ENDED]: { laneName: string; taskName: string; totalBytes: number };
  [AgentEventType.CONNECTION_ERROR]: AgentConnectionErrorPayload;
  [AgentEventType.AUTH_ERROR]: { laneName: string; message: string };
  [AgentEventType.RATE_LIMITED]: { laneName: string; retryAfterMs: number };
  [AgentEventType.TIMEOUT]: { laneName: string; taskName: string; timeoutMs: number };
  
  // State
  [StateEventType.TRANSITION]: StateTransitionPayload;
  [StateEventType.TRANSITION_FAILED]: StateTransitionFailedPayload;
  [StateEventType.PERSISTED]: { laneName: string; filePath: string };
  [StateEventType.RESTORED]: { laneName: string; filePath: string; state: any };
  [StateEventType.CORRUPTED]: StateCorruptedPayload;
  [StateEventType.REPAIRED]: StateRepairedPayload;
  
  // System
  [SystemEventType.STARTUP]: { version: string; nodeVersion: string };
  [SystemEventType.SHUTDOWN]: { reason: string; exitCode: number };
  [SystemEventType.HEALTH_CHECK]: SystemHealthCheckPayload;
  [SystemEventType.CONFIG_LOADED]: { configPath: string };
  [SystemEventType.LOG_ROTATED]: { oldPath: string; newPath: string };
  [SystemEventType.SIGNAL_RECEIVED]: SystemSignalReceivedPayload;
}

// ============================================================================
// Typed Event Interface
// ============================================================================

/**
 * 타입이 지정된 CursorFlow 이벤트
 */
export interface TypedCursorFlowEvent<T extends keyof EventPayloadMap = keyof EventPayloadMap> {
  /** 고유 이벤트 ID */
  id: string;
  /** 이벤트 타입 */
  type: T;
  /** 이벤트 카테고리 */
  category: EventCategory;
  /** 발생 시간 (ISO 8601) */
  timestamp: string;
  /** 실행 ID */
  runId: string;
  /** Lane 이름 (해당하는 경우) */
  laneName?: string;
  /** 페이로드 */
  payload: EventPayloadMap[T];
}

/**
 * 이벤트 타입에서 카테고리 추출
 */
export function getCategoryFromEventType(eventType: string): EventCategory {
  const prefix = eventType.split('.')[0];
  switch (prefix) {
    case 'orchestration': return EventCategory.ORCHESTRATION;
    case 'lane': return EventCategory.LANE;
    case 'task': return EventCategory.TASK;
    case 'git': return EventCategory.GIT;
    case 'recovery': return EventCategory.RECOVERY;
    case 'agent': return EventCategory.AGENT;
    case 'state': return EventCategory.STATE;
    case 'system': return EventCategory.SYSTEM;
    default: return EventCategory.SYSTEM;
  }
}

/**
 * 타입화된 이벤트 핸들러
 */
export type TypedEventHandler<T extends keyof EventPayloadMap> = 
  (event: TypedCursorFlowEvent<T>) => void | Promise<void>;

/**
 * 범용 이벤트 핸들러
 */
export type GenericEventHandler = (event: TypedCursorFlowEvent) => void | Promise<void>;


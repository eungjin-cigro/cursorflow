# Phase 1: 타입 정리

## 목표

모든 타입 정의를 중앙 집중화하여 일관성과 재사용성을 높입니다.

## 현재 상태

### 문제점
1. `utils/types.ts` (382줄)에 모든 타입이 혼재
2. 일부 모듈에서 로컬 타입 중복 정의
3. 도메인 구분 없이 평면 구조

### 현재 타입 분포

```
utils/types.ts (382줄)
├── Config 관련: CursorFlowConfig, LaneConfig, WebhookConfig, EnhancedLogConfig
├── Event 관련: CursorFlowEvent, EventHandler, *Payload (15개)
├── Lane 관련: LaneInfo, LaneState, LaneFileInfo
├── Task 관련: Task, TaskDirInfo, RunnerConfig, TaskExecutionResult
├── Run 관련: RunInfo, RunStatus
├── Review 관련: ReviewResult, ReviewIssue, TaskResult
├── Agent 관련: AgentSendResult, DependencyPolicy, DependencyRequestPlan
└── Log 관련: LogImportance, ConversationEntry, GitLogEntry, EventEntry

enhanced-logger.ts (로컬 정의)
├── ParsedMessage
├── JsonLogEntry
└── LogSession

log-buffer.ts (로컬 정의)
├── JsonLogEntry (중복!)
├── BufferedLogEntry
├── LogBufferOptions
└── LogFilter
```

## 목표 구조

```
src/types/
├── index.ts              # 모든 타입 re-export
├── config.ts             # 설정 관련 타입
├── lane.ts               # 레인 관련 타입
├── task.ts               # 태스크 관련 타입
├── events.ts             # 이벤트 페이로드 타입
├── logging.ts            # 로깅 관련 타입
├── review.ts             # 리뷰 관련 타입
└── agent.ts              # 에이전트 통신 타입
```

## 상세 작업

### 1. `types/config.ts` 생성

```typescript
// src/types/config.ts

export interface LaneConfig {
  devPort: number;
  autoCreatePr: boolean;
}

export interface WebhookConfig {
  enabled?: boolean;
  url: string;
  secret?: string;
  events?: string[];
  headers?: Record<string, string>;
  retries?: number;
  timeoutMs?: number;
}

export interface EnhancedLogConfig {
  enabled: boolean;
  stripAnsi: boolean;
  addTimestamps: boolean;
  maxFileSize: number;
  maxFiles: number;
  keepRawLogs: boolean;
  keepAbsoluteRawLogs: boolean;
  raw?: boolean;
  writeJsonLog: boolean;
  timestampFormat: 'iso' | 'relative' | 'short';
}

export interface CursorFlowConfig {
  tasksDir: string;
  logsDir: string;
  pofDir: string;
  baseBranch: string;
  branchPrefix: string;
  executor: 'cursor-agent' | 'cloud';
  pollInterval: number;
  allowDependencyChange: boolean;
  lockfileReadOnly: boolean;
  enableReview: boolean;
  reviewModel: string;
  reviewAllTasks?: boolean;
  maxReviewIterations: number;
  defaultLaneConfig: LaneConfig;
  logLevel: string;
  verboseGit: boolean;
  worktreePrefix: string;
  maxConcurrentLanes: number;
  projectRoot: string;
  agentOutputFormat: 'stream-json' | 'json' | 'plain';
  webhooks?: WebhookConfig[];
  enhancedLogging?: Partial<EnhancedLogConfig>;
}
```

### 2. `types/lane.ts` 생성

```typescript
// src/types/lane.ts

import { DependencyRequestPlan } from './agent';

export type LaneStatus = 
  | 'pending' 
  | 'running' 
  | 'completed' 
  | 'failed' 
  | 'paused' 
  | 'waiting' 
  | 'reviewing';

export interface LaneInfo {
  name: string;
  status: string;
  currentTask: number;
  totalTasks: number;
  pid?: number;
  pipelineBranch?: string;
}

export interface LaneState {
  label: string;
  status: LaneStatus;
  currentTaskIndex: number;
  totalTasks: number;
  worktreeDir: string | null;
  pipelineBranch: string | null;
  startTime: number;
  endTime: number | null;
  error: string | null;
  dependencyRequest: DependencyRequestPlan | null;
  updatedAt?: number;
  tasksFile?: string;
  dependsOn?: string[];
  pid?: number;
  completedTasks?: string[];
  waitingFor?: string[];
}

export interface LaneFileInfo {
  fileName: string;
  laneName: string;
  preset: string;
  taskCount: number;
  taskFlow: string;
  dependsOn: string[];
}
```

### 3. `types/task.ts` 생성

```typescript
// src/types/task.ts

import { DependencyPolicy } from './agent';

export interface Task {
  name: string;
  prompt: string;
  model?: string;
  acceptanceCriteria?: string[];
  dependsOn?: string[];
  timeout?: number;
}

export interface RunnerConfig {
  tasks: Task[];
  dependsOn?: string[];
  pipelineBranch?: string;
  worktreeDir?: string;
  branchPrefix?: string;
  worktreeRoot?: string;
  baseBranch?: string;
  model?: string;
  dependencyPolicy: DependencyPolicy;
  enableReview?: boolean;
  agentOutputFormat?: 'stream-json' | 'json' | 'plain';
  reviewModel?: string;
  reviewAllTasks?: boolean;
  maxReviewIterations?: number;
  acceptanceCriteria?: string[];
  timeout?: number;
  enableIntervention?: boolean;
  noGit?: boolean;
}

export interface TaskDirInfo {
  name: string;
  path: string;
  timestamp: Date;
  featureName: string;
  lanes: import('./lane').LaneFileInfo[];
  validationStatus: ValidationStatus;
  lastValidated?: number;
}

export interface TaskExecutionResult {
  taskName: string;
  taskBranch: string;
  status: 'FINISHED' | 'ERROR' | 'BLOCKED_DEPENDENCY';
  error?: string;
  dependencyRequest?: import('./agent').DependencyRequestPlan | null;
}

export interface TaskResult {
  taskName: string;
  taskBranch: string;
  acceptanceCriteria?: string[];
  [key: string]: any;
}

export type ValidationStatus = 'valid' | 'warnings' | 'errors' | 'unknown';
```

### 4. `types/events.ts` 생성

```typescript
// src/types/events.ts

import { DependencyRequestPlan } from './agent';

export interface CursorFlowEvent<T = Record<string, any>> {
  id: string;
  type: string;
  timestamp: string;
  runId: string;
  payload: T;
}

export type EventHandler<T = any> = (event: CursorFlowEvent<T>) => void | Promise<void>;

// Orchestration Events
export interface OrchestrationStartedPayload {
  runId: string;
  tasksDir: string;
  laneCount: number;
  runRoot: string;
}

export interface OrchestrationCompletedPayload {
  runId: string;
  laneCount: number;
  completedCount: number;
  failedCount: number;
}

export interface OrchestrationFailedPayload {
  error: string;
  blockedLanes?: string[];
}

// Lane Events
export interface LaneStartedPayload {
  laneName: string;
  pid?: number;
  logPath: string;
}

export interface LaneCompletedPayload {
  laneName: string;
  exitCode: number;
}

export interface LaneFailedPayload {
  laneName: string;
  exitCode: number;
  error: string;
}

export interface LaneDependencyRequestedPayload {
  laneName: string;
  dependencyRequest: DependencyRequestPlan;
}

// Task Events
export interface TaskStartedPayload {
  taskName: string;
  taskBranch: string;
  index: number;
}

export interface TaskCompletedPayload {
  taskName: string;
  taskBranch: string;
  status: string;
}

export interface TaskFailedPayload {
  taskName: string;
  taskBranch: string;
  error: string;
}

// Agent Events
export interface AgentPromptSentPayload {
  taskName: string;
  model: string;
  promptLength: number;
}

export interface AgentResponseReceivedPayload {
  taskName: string;
  ok: boolean;
  duration: number;
  responseLength: number;
  error?: string;
}

// Review Events
export interface ReviewStartedPayload {
  taskName: string;
  taskBranch: string;
}

export interface ReviewCompletedPayload {
  taskName: string;
  status: 'approved' | 'needs_changes';
  issueCount: number;
  summary: string;
  raw: string;
}

export interface ReviewApprovedPayload {
  taskName: string;
  iterations: number;
}

export interface ReviewRejectedPayload {
  taskName: string;
  reason: string;
  iterations: number;
}
```

### 5. `types/logging.ts` 생성

```typescript
// src/types/logging.ts

export enum LogImportance {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
  INFO = 'info',
  DEBUG = 'debug'
}

export type MessageType = 
  | 'system' 
  | 'user' 
  | 'assistant' 
  | 'tool' 
  | 'tool_result' 
  | 'result' 
  | 'thinking';

export interface ParsedMessage {
  type: MessageType;
  role: string;
  content: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface JsonLogEntry {
  timestamp: string;
  level: 'stdout' | 'stderr' | 'info' | 'error' | 'debug' | 'session';
  source?: string;
  task?: string;
  lane?: string;
  message: string;
  raw?: string;
  metadata?: Record<string, any>;
}

export interface BufferedLogEntry {
  id: string;
  timestamp: Date;
  laneName: string;
  level: string;
  message: string;
  raw?: string;
  importance: LogImportance;
  laneColor: string;
  metadata?: Record<string, any>;
}

export interface LogSession {
  id: string;
  laneName: string;
  taskName?: string;
  model?: string;
  startTime: number;
  metadata?: Record<string, any>;
}

export interface ConversationEntry {
  timestamp: string;
  role: 'user' | 'assistant' | 'reviewer' | 'system' | 'intervention';
  task: string | null;
  fullText: string;
  textLength: number;
  model: string | null;
}

export interface GitLogEntry {
  timestamp: string;
  operation: string;
  [key: string]: any;
}

export interface EventEntry {
  timestamp: string;
  event: string;
  [key: string]: any;
}
```

### 6. `types/agent.ts` 생성

```typescript
// src/types/agent.ts

export interface DependencyPolicy {
  allowDependencyChange: boolean;
  lockfileReadOnly: boolean;
}

export interface DependencyRequestPlan {
  reason: string;
  changes: string[];
  commands: string[];
  notes?: string;
}

export interface AgentSendResult {
  ok: boolean;
  exitCode: number;
  error?: string;
  sessionId?: string;
  resultText?: string;
}
```

### 7. `types/review.ts` 생성

```typescript
// src/types/review.ts

export interface ReviewIssue {
  severity: 'critical' | 'major' | 'minor';
  description: string;
  file?: string;
  suggestion?: string;
}

export interface ReviewResult {
  status: 'approved' | 'needs_changes';
  buildSuccess: boolean;
  issues: ReviewIssue[];
  suggestions: string[];
  summary: string;
  raw: string;
}
```

### 8. `types/run.ts` 생성

```typescript
// src/types/run.ts

import { LaneInfo } from './lane';

export type RunStatus = 'running' | 'completed' | 'failed' | 'partial' | 'pending';

export interface RunInfo {
  id: string;
  path: string;
  taskName: string;
  status: RunStatus;
  startTime: number;
  endTime?: number;
  duration: number;
  lanes: LaneInfo[];
  branches: string[];
  worktrees: string[];
}
```

### 9. `types/index.ts` 생성 (통합 export)

```typescript
// src/types/index.ts

// Config
export * from './config';

// Lane
export * from './lane';

// Task
export * from './task';

// Events
export * from './events';

// Logging
export * from './logging';

// Agent
export * from './agent';

// Review
export * from './review';

// Run
export * from './run';
```

## 마이그레이션 가이드

### Before
```typescript
import { LaneState, RunnerConfig, Task } from '../utils/types';
import { ParsedMessage } from '../utils/enhanced-logger';
```

### After
```typescript
import { LaneState, RunnerConfig, Task, ParsedMessage } from '../types';
```

### 자동 마이그레이션 스크립트

```bash
# 모든 파일에서 import 경로 변경
find src -name "*.ts" -exec sed -i \
  "s|from '../utils/types'|from '../types'|g" {} \;

find src -name "*.ts" -exec sed -i \
  "s|from './types'|from '../types'|g" {} \;
```

## 테스트 계획

1. **컴파일 테스트**: `npm run build` 성공 확인
2. **타입 검증**: 모든 타입이 올바르게 export되는지 확인
3. **기존 테스트**: `npm test` 모든 테스트 통과
4. **IDE 검증**: import 자동완성 동작 확인

## 롤백 계획

1. `types/` 디렉토리 삭제
2. `utils/types.ts` 복원
3. Git에서 import 변경 revert

## 체크리스트

- [ ] `types/` 디렉토리 생성
- [ ] `types/config.ts` 작성
- [ ] `types/lane.ts` 작성
- [ ] `types/task.ts` 작성
- [ ] `types/events.ts` 작성
- [ ] `types/logging.ts` 작성
- [ ] `types/agent.ts` 작성
- [ ] `types/review.ts` 작성
- [ ] `types/run.ts` 작성
- [ ] `types/index.ts` 작성
- [ ] 모든 파일 import 경로 변경
- [ ] `utils/types.ts` 삭제 (또는 re-export로 변경)
- [ ] 빌드 테스트
- [ ] 유닛 테스트 실행


/**
 * Shared type definitions for CursorFlow
 */

export interface LaneConfig {
  devPort: number;
  autoCreatePr: boolean;
}

export interface CursorFlowConfig {
  tasksDir: string;
  logsDir: string;
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
  /** Output format for cursor-agent (default: 'stream-json') */
  agentOutputFormat: 'stream-json' | 'json' | 'plain';
  webhooks?: WebhookConfig[];
  /** Enhanced logging configuration */
  enhancedLogging?: Partial<EnhancedLogConfig>;
}

export interface WebhookConfig {
  enabled?: boolean;
  url: string;
  secret?: string;
  events?: string[]; // ['*'] for all, ['task.*'] for wildcards
  headers?: Record<string, string>;
  retries?: number;
  timeoutMs?: number;
}

/**
 * Enhanced logging configuration
 */
export interface EnhancedLogConfig {
  /** Enable enhanced logging features (default: true) */
  enabled: boolean;
  
  /** Strip ANSI escape codes from clean logs (default: true) */
  stripAnsi: boolean;
  
  /** Add timestamps to each line (default: true) */
  addTimestamps: boolean;
  
  /** Maximum size in bytes before rotation (default: 50MB) */
  maxFileSize: number;
  
  /** Number of rotated files to keep (default: 5) */
  maxFiles: number;
  
  /** Write raw output with ANSI codes to separate file (default: true) */
  keepRawLogs: boolean;
  
  /** Write structured JSON log entries (default: true) */
  writeJsonLog: boolean;
  
  /** Timestamp format: 'iso' | 'relative' | 'short' (default: 'iso') */
  timestampFormat: 'iso' | 'relative' | 'short';
}

export interface CursorFlowEvent<T = Record<string, any>> {
  id: string;
  type: string;
  timestamp: string;
  runId: string;
  payload: T;
}

export type EventHandler<T = any> = (event: CursorFlowEvent<T>) => void | Promise<void>;

// Specific Event Payloads
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

export interface ReviewStartedPayload {
  taskName: string;
  taskBranch: string;
}

export interface ReviewCompletedPayload {
  taskName: string;
  status: 'approved' | 'needs_changes';
  issueCount: number;
  summary: string;
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

export interface DependencyPolicy {
  allowDependencyChange: boolean;
  lockfileReadOnly: boolean;
}

export interface Task {
  name: string;
  prompt: string;
  model?: string;
  /** Acceptance criteria for the AI reviewer to validate */
  acceptanceCriteria?: string[];
  /** Task-level dependencies (format: "lane:task") */
  dependsOn?: string[];
  /** Task execution timeout in milliseconds. Overrides lane-level timeout. */
  timeout?: number;
}

export interface RunnerConfig {
  tasks: Task[];
  dependsOn?: string[];
  pipelineBranch?: string;
  branchPrefix?: string;
  worktreeRoot?: string;
  baseBranch?: string;
  model?: string;
  dependencyPolicy: DependencyPolicy;
  enableReview?: boolean;
  /** Output format for cursor-agent (default: 'stream-json') */
  agentOutputFormat?: 'stream-json' | 'json' | 'plain';
  reviewModel?: string;
  reviewAllTasks?: boolean;
  maxReviewIterations?: number;
  acceptanceCriteria?: string[];
  /** Task execution timeout in milliseconds. Default: 600000 (10 minutes) */
  timeout?: number;
  /** 
   * Enable intervention feature (stdin piping for message injection).
   * Warning: May cause stdout buffering issues on some systems.
   * Default: false
   */
  enableIntervention?: boolean;
  /**
   * Disable Git operations (worktree, branch, push, commit).
   * Useful for testing or environments without Git remote.
   * Default: false
   */
  noGit?: boolean;
}

export interface DependencyRequestPlan {
  reason: string;
  changes: string[];
  commands: string[];
  notes?: string;
}

export interface TaskExecutionResult {
  taskName: string;
  taskBranch: string;
  status: 'FINISHED' | 'ERROR' | 'BLOCKED_DEPENDENCY';
  error?: string;
  dependencyRequest?: DependencyRequestPlan | null;
}

export interface AgentSendResult {
  ok: boolean;
  exitCode: number;
  error?: string;
  sessionId?: string;
  resultText?: string;
}

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

export interface TaskResult {
  taskName: string;
  taskBranch: string;
  acceptanceCriteria?: string[];
  [key: string]: any;
}

export interface LaneState {
  label: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused' | 'waiting' | 'reviewing';
  currentTaskIndex: number;
  totalTasks: number;
  worktreeDir: string | null;
  pipelineBranch: string | null;
  startTime: number;
  endTime: number | null;
  error: string | null;
  dependencyRequest: DependencyRequestPlan | null;
  updatedAt?: number;
  tasksFile?: string; // Original tasks file path
  dependsOn?: string[];
  pid?: number;
  /** List of completed task names in this lane */
  completedTasks?: string[];
  /** Task-level dependencies currently being waited for (format: "lane:task") */
  waitingFor?: string[];
}

export interface ConversationEntry {
  timestamp: string;
  role: 'user' | 'assistant' | 'reviewer' | 'system';
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


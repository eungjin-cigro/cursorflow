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
  maxReviewIterations: number;
  defaultLaneConfig: LaneConfig;
  logLevel: string;
  verboseGit: boolean;
  worktreePrefix: string;
  maxConcurrentLanes: number;
  projectRoot: string;
}

export interface DependencyPolicy {
  allowDependencyChange: boolean;
  lockfileReadOnly: boolean;
}

export interface Task {
  name: string;
  prompt: string;
  model?: string;
}

export interface RunnerConfig {
  tasks: Task[];
  pipelineBranch?: string;
  branchPrefix?: string;
  worktreeRoot?: string;
  baseBranch?: string;
  model?: string;
  dependencyPolicy: DependencyPolicy;
  reviewModel?: string;
  maxReviewIterations?: number;
  acceptanceCriteria?: string[];
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


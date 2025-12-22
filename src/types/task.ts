
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

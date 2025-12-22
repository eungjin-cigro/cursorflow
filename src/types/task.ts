/**
 * Task-related type definitions
 */

import type { DependencyPolicy, DependencyRequestPlan } from './agent';
import type { LaneFileInfo } from './lane';

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
  worktreeDir?: string;
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

export interface TaskDirInfo {
  name: string;
  path: string;
  timestamp: Date;
  featureName: string;
  lanes: LaneFileInfo[];
  validationStatus: ValidationStatus;
  lastValidated?: number;
}

export interface TaskExecutionResult {
  taskName: string;
  taskBranch: string;
  status: 'FINISHED' | 'ERROR' | 'BLOCKED_DEPENDENCY';
  error?: string;
  dependencyRequest?: DependencyRequestPlan | null;
}

export interface TaskResult {
  taskName: string;
  taskBranch: string;
  acceptanceCriteria?: string[];
  [key: string]: any;
}

export type ValidationStatus = 'valid' | 'warnings' | 'errors' | 'unknown';


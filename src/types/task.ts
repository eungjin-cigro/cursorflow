/**
 * Task-related type definitions
 */

import type { DependencyPolicy, DependencyRequestPlan } from './agent';
import type { LaneFileInfo } from './lane';

export interface Task {
  name: string;
  prompt: string;
  model?: string;
  /** Task-level dependencies (format: "lane:task") */
  dependsOn?: string[];
  /** Task execution timeout in milliseconds. Overrides lane-level timeout. */
  timeout?: number;
  /** Enable browser automation for this task. Required for web testing/scraping. */
  browser?: boolean;
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
  /** Output format for cursor-agent (default: 'json') */
  agentOutputFormat?: 'json' | 'stream-json';
  /** Task execution timeout in milliseconds. Default: 600000 (10 minutes) */
  timeout?: number;
  /** 
   * Enable intervention feature (stdin piping for message injection).
   * Warning: May cause stdout buffering issues on some systems.
   * Default: true
   */
  enableIntervention?: boolean;
  /**
   * Enable verbose Git logging.
   * Default: false
   */
  verboseGit?: boolean;
  /** 
   * Enable browser automation for all tasks in this config. 
   * Required for web testing/scraping.
   */
  browser?: boolean;
  /** Auto-approve commands (--force flag). Default: true */
  autoApproveCommands?: boolean;
  /** Auto-approve MCP servers (--approve-mcps flag). Default: true */
  autoApproveMcps?: boolean;
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
  [key: string]: any;
}

export type ValidationStatus = 'valid' | 'warnings' | 'errors' | 'unknown';


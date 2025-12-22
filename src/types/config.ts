
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

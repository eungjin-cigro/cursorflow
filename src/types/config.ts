/**
 * Configuration-related type definitions
 */

export interface LaneConfig {
  devPort: number;
  autoCreatePr: boolean;
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
  
  /** Keep absolute raw logs without any processing */
  keepAbsoluteRawLogs?: boolean;
  
  /** Write structured JSON log entries (default: true) */
  writeJsonLog: boolean;
  
  /** Timestamp format: 'iso' | 'relative' | 'short' (default: 'iso') */
  timestampFormat: 'iso' | 'relative' | 'short';
  
  /** Raw output mode */
  raw?: boolean;
}

export interface CursorFlowConfig {
  tasksDir: string;
  /** New flows directory (replaces tasksDir in new architecture) */
  flowsDir: string;
  logsDir: string;
  pofDir: string;
  /** Base branch (optional, auto-detected from current branch if not specified) */
  baseBranch?: string;
  branchPrefix: string;
  executor: 'cursor-agent' | 'cloud';
  pollInterval: number;
  allowDependencyChange: boolean;
  lockfileReadOnly: boolean;
  defaultLaneConfig: LaneConfig;
  logLevel: string;
  verboseGit: boolean;
  worktreePrefix: string;
  maxConcurrentLanes: number;
  projectRoot: string;
  /** Output format for cursor-agent (default: 'json') */
  agentOutputFormat: 'json' | 'plain' | 'stream-json';
  webhooks?: WebhookConfig[];
  /** Enable intervention feature (stdin piping for message injection) */
  enableIntervention?: boolean;
  /** Enhanced logging configuration */
  enhancedLogging?: Partial<EnhancedLogConfig>;
  /** Default AI model for tasks (default: 'gemini-3-flash') */
  defaultModel: string;
}


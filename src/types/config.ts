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
  
  /** Strip ANSI escape codes from logs (default: true) */
  stripAnsi: boolean;
  
  /** Maximum size in bytes before rotation (default: 50MB) */
  maxFileSize: number;
  
  /** Number of rotated files to keep (default: 5) */
  maxFiles: number;
  
  /** Write structured JSON log entries (default: true) */
  writeJsonLog: boolean;
  
  /** Timestamp format: 'iso' | 'relative' | 'short' (default: 'iso') */
  timestampFormat: 'iso' | 'relative' | 'short';
}

/**
 * Hook 시스템 설정
 */
export interface HooksConfig {
  /** Hook 정의 파일 경로 (e.g., './cursorflow.hooks.ts') */
  file?: string;
  /** Hook 실행 타임아웃 (ms, 기본: 30000) */
  timeout?: number;
  /** 에러 시 계속 진행 여부 (기본: false) */
  continueOnError?: boolean;
  /** 디버그 모드 */
  debug?: boolean;
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
  agentOutputFormat: 'json' | 'stream-json';
  webhooks?: WebhookConfig[];
  /** Enable intervention feature (stdin piping for message injection) */
  enableIntervention?: boolean;
  /** Enhanced logging configuration */
  enhancedLogging?: Partial<EnhancedLogConfig>;
  /** Default AI model for tasks (default: 'gemini-3-flash') */
  defaultModel: string;
  /** Auto-approve agent commands (--force flag). Default: true for automation. */
  autoApproveCommands?: boolean;
  /** Auto-approve MCP servers (--approve-mcps flag). Default: true for automation. */
  autoApproveMcps?: boolean;
  /** Enable browser automation (--browser flag). Required for web testing/scraping. */
  browser?: boolean;
  /** Hook 시스템 설정 */
  hooks?: HooksConfig;
}


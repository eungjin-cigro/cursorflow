/**
 * Logging utilities for CursorFlow
 * 
 * 통일된 로그 형식: [HH:MM:SS] emoji TYPE message
 * 컨텍스트 포함 시: [HH:MM:SS] [context] emoji TYPE message
 */

export enum LogLevel {
  error = 0,
  warn = 1,
  info = 2,
  debug = 3,
}

export const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
  bold: '\x1b[1m',
  white: '\x1b[37m',
};

let currentLogLevel: number = LogLevel.info;

/**
 * Set log level
 */
export function setLogLevel(level: string | number): void {
  if (typeof level === 'string') {
    currentLogLevel = (LogLevel as any)[level] ?? LogLevel.info;
  } else {
    currentLogLevel = level;
  }
}

/**
 * Get current log level
 */
export function getLogLevel(): number {
  return currentLogLevel;
}

/**
 * Format timestamp as [HH:MM:SS] in local time
 */
export function formatTimestamp(date: Date = new Date()): string {
  return date.toLocaleTimeString('en-US', { hour12: false });
}

/**
 * Log options interface for contextual logging
 */
export interface LogOptions {
  /** Context label (e.g., lane name) */
  context?: string;
  /** Custom emoji override */
  emoji?: string;
  /** Skip timestamp */
  noTimestamp?: boolean;
  /** Custom color */
  color?: string;
}

/**
 * Format message with timestamp and optional context
 * Output format: [HH:MM:SS] [context] emoji TYPE message
 */
function formatMessage(level: string, message: string, options: LogOptions = {}): string {
  const { context, emoji = '', noTimestamp = false } = options;
  
  const timestamp = noTimestamp ? '' : `[${formatTimestamp()}]`;
  const contextPart = context ? ` [${context}]` : '';
  const emojiPart = emoji ? `${emoji} ` : '';
  const levelPart = level.toUpperCase().padEnd(5);
  
  const lines = String(message).split('\n');
  const prefix = `${timestamp}${contextPart} ${emojiPart}${levelPart}`;
  
  return lines.map(line => `${prefix} ${line}`).join('\n');
}

/**
 * Format message for colored console output
 * Output format: [HH:MM:SS] [context] emoji TYPE message
 */
function formatColoredMessage(
  levelColor: string, 
  level: string, 
  message: string, 
  options: LogOptions = {}
): string {
  const { context, emoji = '', noTimestamp = false, color } = options;
  
  const timestamp = noTimestamp 
    ? '' 
    : `${COLORS.gray}[${formatTimestamp()}]${COLORS.reset}`;
  
  const contextPart = context 
    ? ` ${COLORS.magenta}[${context}]${COLORS.reset}` 
    : '';
  
  const emojiPart = emoji ? `${emoji} ` : '';
  const effectiveColor = color || levelColor;
  const levelPart = `${effectiveColor}${level.toUpperCase().padEnd(5)}${COLORS.reset}`;
  
  const lines = String(message).split('\n');
  const prefix = `${timestamp}${contextPart} ${emojiPart}${levelPart}`;
  
  return lines.map(line => `${prefix} ${line}`).join('\n');
}

/**
 * Internal log function with color support
 */
function logWithColor(
  color: string, 
  level: keyof typeof LogLevel, 
  message: string, 
  options: LogOptions = {}
): void {
  if (LogLevel[level] > currentLogLevel) {
    return;
  }
  
  const formatted = formatColoredMessage(color, level, message, options);
  console.log(formatted);
}

// ============================================================================
// Primary Logging Functions (with optional context support)
// ============================================================================

/**
 * Error log
 * @example logger.error('Connection failed')
 * @example logger.error('Task failed', { context: 'lane-01' })
 */
export function error(message: string, options?: LogOptions | string): void {
  const opts = normalizeOptions(options, '❌');
  logWithColor(COLORS.red, 'error', message, opts);
}

/**
 * Warning log
 */
export function warn(message: string, options?: LogOptions | string): void {
  const opts = normalizeOptions(options, '⚠️');
  logWithColor(COLORS.yellow, 'warn', message, opts);
}

/**
 * Info log
 */
export function info(message: string, options?: LogOptions | string): void {
  const opts = normalizeOptions(options, 'ℹ️');
  logWithColor(COLORS.cyan, 'info', message, opts);
}

/**
 * Success log
 */
export function success(message: string, options?: LogOptions | string): void {
  const opts = normalizeOptions(options, '✅');
  logWithColor(COLORS.green, 'info', message, opts);
}

/**
 * Debug log
 */
export function debug(message: string, options?: LogOptions | string): void {
  const opts = normalizeOptions(options, '🔍');
  logWithColor(COLORS.gray, 'debug', message, opts);
}

/**
 * Progress log
 */
export function progress(message: string, options?: LogOptions | string): void {
  const opts = normalizeOptions(options, '🔄');
  logWithColor(COLORS.blue, 'info', message, opts);
}

/**
 * Normalize options - supports both legacy string emoji and new LogOptions
 */
function normalizeOptions(options: LogOptions | string | undefined, defaultEmoji: string): LogOptions {
  if (typeof options === 'string') {
    // Legacy: options is emoji string
    return { emoji: options };
  }
  return { emoji: defaultEmoji, ...options };
}

// ============================================================================
// Context-aware Logging (for lane-specific output)
// ============================================================================

/**
 * Create a context-bound logger for a specific lane/component
 * @example const laneLog = logger.withContext('lane-01');
 *          laneLog.info('Starting task');
 */
export function withContext(context: string) {
  return {
    error: (message: string, options?: Omit<LogOptions, 'context'>) => 
      error(message, { ...options, context }),
    warn: (message: string, options?: Omit<LogOptions, 'context'>) => 
      warn(message, { ...options, context }),
    info: (message: string, options?: Omit<LogOptions, 'context'>) => 
      info(message, { ...options, context }),
    success: (message: string, options?: Omit<LogOptions, 'context'>) => 
      success(message, { ...options, context }),
    debug: (message: string, options?: Omit<LogOptions, 'context'>) => 
      debug(message, { ...options, context }),
    progress: (message: string, options?: Omit<LogOptions, 'context'>) => 
      progress(message, { ...options, context }),
    log: (message: string, options?: Omit<LogOptions, 'context'>) => 
      contextLog(message, { ...options, context }),
  };
}

/**
 * Generic contextual log (no level)
 */
function contextLog(message: string, options: LogOptions = {}): void {
  const { context, noTimestamp = false } = options;
  
  const timestamp = noTimestamp 
    ? '' 
    : `${COLORS.gray}[${formatTimestamp()}]${COLORS.reset}`;
  
  const contextPart = context 
    ? ` ${COLORS.magenta}[${context}]${COLORS.reset}` 
    : '';
  
  console.log(`${timestamp}${contextPart} ${message}`);
}

// ============================================================================
// Lane-specific output (matching run command format)
// ============================================================================

/**
 * Format a lane output line (for orchestrator/runner use)
 * Format: [HH:MM:SS] laneName    message
 */
export function laneOutput(laneName: string, message: string, isError = false): void {
  const timestamp = `${COLORS.gray}[${formatTimestamp()}]${COLORS.reset}`;
  const laneLabel = `${COLORS.magenta}${laneName.padEnd(10)}${COLORS.reset}`;
  const output = isError ? `${COLORS.red}${message}${COLORS.reset}` : message;
  
  if (isError) {
    process.stderr.write(`${timestamp} ${laneLabel} ${output}\n`);
  } else {
    process.stdout.write(`${timestamp} ${laneLabel} ${output}\n`);
  }
}

/**
 * Format a lane error line
 * Format: [HH:MM:SS] [laneName] ERROR: message
 */
export function laneError(laneName: string, message: string): void {
  const timestamp = `${COLORS.gray}[${formatTimestamp()}]${COLORS.reset}`;
  const output = `${COLORS.red}[${laneName}] ERROR: ${message}${COLORS.reset}`;
  process.stderr.write(`${timestamp} ${output}\n`);
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Section header
 */
export function section(message: string): void {
  console.log('');
  console.log(`${COLORS.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.reset}`);
  console.log(`${COLORS.cyan}  ${message}${COLORS.reset}`);
  console.log(`${COLORS.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.reset}`);
  console.log('');
}

/**
 * Simple log without formatting
 */
export function log(message: string | any): void {
  console.log(message);
}

/**
 * Raw output (no formatting, direct to stdout)
 */
export function raw(message: string): void {
  process.stdout.write(message);
}

/**
 * Log JSON data (pretty print in debug mode)
 */
export function json(data: any): void {
  if (currentLogLevel >= LogLevel.debug) {
    console.log(JSON.stringify(data, null, 2));
  }
}

/**
 * Print a formatted table row
 */
export function tableRow(columns: string[], widths: number[]): void {
  const formatted = columns.map((col, i) => {
    const width = widths[i] || 10;
    return String(col).padEnd(width);
  }).join('  ');
  console.log(formatted);
}

/**
 * Print a table separator
 */
export function tableSeparator(widths: number[]): void {
  const line = widths.map(w => '─'.repeat(w)).join('──');
  console.log(`${COLORS.gray}${line}${COLORS.reset}`);
}

// ============================================================================
// Spinner
// ============================================================================

export interface Spinner {
  start(): void;
  stop(finalMessage?: string | null): void;
  succeed(message: string): void;
  fail(message: string): void;
  update(message: string): void;
}

/**
 * Create spinner (simple implementation)
 */
export function createSpinner(message: string): Spinner {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  let interval: NodeJS.Timeout | null = null;
  let currentMessage = message;
  
  const spinner: Spinner = {
    start() {
      process.stdout.write(`${currentMessage} ${frames[0]}`);
      interval = setInterval(() => {
        i = (i + 1) % frames.length;
        process.stdout.write(`\r${currentMessage} ${frames[i]}`);
      }, 80);
    },
    
    stop(finalMessage: string | null = null) {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      process.stdout.write('\r\x1b[K'); // Clear line
      if (finalMessage) {
        console.log(finalMessage);
      }
    },
    
    succeed(message: string) {
      this.stop(`${COLORS.green}✓${COLORS.reset} ${message}`);
    },
    
    fail(message: string) {
      this.stop(`${COLORS.red}✗${COLORS.reset} ${message}`);
    },
    
    update(message: string) {
      currentMessage = message;
    },
  };

  return spinner;
}

// ============================================================================
// Status Indicators
// ============================================================================

export const STATUS = {
  running: `${COLORS.blue}🔄${COLORS.reset}`,
  done: `${COLORS.green}✅${COLORS.reset}`,
  failed: `${COLORS.red}❌${COLORS.reset}`,
  warning: `${COLORS.yellow}⚠️${COLORS.reset}`,
  pending: `${COLORS.gray}⏳${COLORS.reset}`,
  paused: `${COLORS.yellow}⏸️${COLORS.reset}`,
  waiting: `${COLORS.gray}⏳${COLORS.reset}`,
};

/**
 * Get status indicator emoji
 */
export function getStatusIndicator(status: string): string {
  return (STATUS as any)[status.toLowerCase()] || STATUS.pending;
}

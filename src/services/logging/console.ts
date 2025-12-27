/**
 * Console Logging Utilities
 * 
 * Provides formatted console output with colors, timestamps, and context support.
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
} as const;

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
  context?: string;
  emoji?: string;
  noTimestamp?: boolean;
  color?: string;
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
  if (LogLevel[level] > currentLogLevel) return;

  const { context, emoji = '', noTimestamp = false } = options;
  const timestamp = noTimestamp ? '' : `${COLORS.gray}[${formatTimestamp()}]${COLORS.reset}`;
  const contextPart = context ? ` ${COLORS.magenta}[${context}]${COLORS.reset}` : '';
  const emojiPart = emoji ? `${emoji} ` : '';
  const levelPart = `${color}${level.toUpperCase().padEnd(5)}${COLORS.reset}`;

  const lines = String(message).split('\n');
  const prefix = `${timestamp}${contextPart} ${emojiPart}${levelPart}`;

  for (const line of lines) {
    console.log(`${prefix} ${line}`);
  }
}

function normalizeOptions(options: LogOptions | string | undefined, defaultEmoji: string): LogOptions {
  if (typeof options === 'string') {
    return { emoji: options };
  }
  return { emoji: defaultEmoji, ...options };
}

// Primary logging functions
// Color rules:
// - Important (colored): error(red), warn(yellow), success(green)
// - Less important (gray): info, debug

export function error(message: string, options?: LogOptions | string): void {
  logWithColor(COLORS.red, 'error', message, normalizeOptions(options, '❌'));
}

export function warn(message: string, options?: LogOptions | string): void {
  logWithColor(COLORS.yellow, 'warn', message, normalizeOptions(options, '⚠️'));
}

export function info(message: string, options?: LogOptions | string): void {
  // Info is gray (less important) - focus on important messages
  logWithColor(COLORS.gray, 'info', message, normalizeOptions(options, 'ℹ️'));
}

export function success(message: string, options?: LogOptions | string): void {
  logWithColor(COLORS.green, 'info', message, normalizeOptions(options, '✅'));
}

export function debug(message: string, options?: LogOptions | string): void {
  logWithColor(COLORS.gray, 'debug', message, normalizeOptions(options, '🔍'));
}

export function progress(message: string, options?: LogOptions | string): void {
  // Progress is blue (visible but not critical)
  logWithColor(COLORS.blue, 'info', message, normalizeOptions(options, '🔄'));
}

/**
 * Create a context-bound logger
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
  };
}

/**
 * Lane-specific output
 * @param laneName - Lane name
 * @param message - Message to output
 * @param isError - Whether this is an error message
 * @param laneIndex - Optional lane index
 * @param taskIndex - Optional task index
 * @param taskName - Optional task name
 */
export function laneOutput(laneName: string, message: string, isError = false, laneIndex?: number, taskIndex?: number, taskName?: string): void {
  const timestamp = `${COLORS.gray}[${formatTimestamp()}]${COLORS.reset}`;
  // Format: [laneIdx-taskIdx-laneName] padded to 18 chars inside brackets
  const lIdx = laneIndex ?? 1;
  const tIdx = taskIndex ?? 1;
  const combined = `${lIdx}-${tIdx}-${laneName}`;
  const label = combined.substring(0, 18).padEnd(18);
  const laneLabel = `${COLORS.magenta}[${label}]${COLORS.reset}`;
  const output = isError ? `${COLORS.red}${message}${COLORS.reset}` : message;
  
  if (isError) {
    process.stderr.write(`${timestamp} ${laneLabel} ${output}\n`);
  } else {
    process.stdout.write(`${timestamp} ${laneLabel} ${output}\n`);
  }
}

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
 * Raw output (no formatting)
 */
export function raw(message: string): void {
  process.stdout.write(message);
}

/**
 * Status indicators
 */
export const STATUS = {
  running: `${COLORS.blue}🔄${COLORS.reset}`,
  done: `${COLORS.green}✅${COLORS.reset}`,
  failed: `${COLORS.red}❌${COLORS.reset}`,
  warning: `${COLORS.yellow}⚠️${COLORS.reset}`,
  pending: `${COLORS.gray}⏳${COLORS.reset}`,
  paused: `${COLORS.yellow}⏸️${COLORS.reset}`,
  waiting: `${COLORS.gray}⏳${COLORS.reset}`,
} as const;


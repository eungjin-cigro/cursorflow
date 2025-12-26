/**
 * Logging utilities for CursorFlow
 * 
 * 통일된 로그 형식: [HH:MM:SS] emoji TYPE message
 * 컨텍스트 포함 시: [HH:MM:SS] [context] emoji TYPE message
 */

import { COLORS, LogLevel } from './log-constants';
import { formatMessageForConsole } from './log-formatter';

export { COLORS, LogLevel };

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
  /** Use box format */
  box?: boolean;
}

/**
 * Internal log function that uses formatMessageForConsole
 */
function logInternal(
  type: string,
  message: string,
  options: LogOptions = {}
): void {
  const level = (LogLevel as any)[type] ?? LogLevel.info;
  if (level > currentLogLevel) {
    return;
  }

  const formatted = formatMessageForConsole({
    type: type as any,
    role: 'system',
    content: message,
    timestamp: Date.now(),
  }, {
    includeTimestamp: !options.noTimestamp,
    context: options.context,
    compact: !options.box
  });

  console.log(formatted);
}

// ============================================================================
// Primary Logging Functions
// ============================================================================

/**
 * Error log
 */
export function error(message: string, options: LogOptions | string = {}): void {
  const opts = typeof options === 'string' ? { emoji: options } : options;
  logInternal('error', message, opts);
}

/**
 * Warning log
 */
export function warn(message: string, options: LogOptions | string = {}): void {
  const opts = typeof options === 'string' ? { emoji: options } : options;
  logInternal('warn', message, opts);
}

/**
 * Info log
 */
export function info(message: string, options: LogOptions | string = {}): void {
  const opts = typeof options === 'string' ? { emoji: options } : options;
  logInternal('info', message, opts);
}

/**
 * Success log
 */
export function success(message: string, options: LogOptions | string = {}): void {
  const opts = typeof options === 'string' ? { emoji: options } : options;
  logInternal('success', message, opts);
}

/**
 * Debug log
 */
export function debug(message: string, options: LogOptions | string = {}): void {
  const opts = typeof options === 'string' ? { emoji: options } : options;
  logInternal('debug', message, opts);
}

/**
 * Progress log
 */
export function progress(message: string, options: LogOptions | string = {}): void {
  const opts = typeof options === 'string' ? { emoji: options } : options;
  logInternal('progress', message, opts);
}

/**
 * Create a context-bound logger
 */
export function withContext(context: string) {
  return {
    error: (message: string, options?: Omit<LogOptions, 'context'>) => error(message, { ...options, context }),
    warn: (message: string, options?: Omit<LogOptions, 'context'>) => warn(message, { ...options, context }),
    info: (message: string, options?: Omit<LogOptions, 'context'>) => info(message, { ...options, context }),
    success: (message: string, options?: Omit<LogOptions, 'context'>) => success(message, { ...options, context }),
    debug: (message: string, options?: Omit<LogOptions, 'context'>) => debug(message, { ...options, context }),
    progress: (message: string, options?: Omit<LogOptions, 'context'>) => progress(message, { ...options, context }),
  };
}

/**
 * Section header
 */
export function section(message: string): void {
  console.log('');
  console.log(`${COLORS.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.reset}`);
  console.log(`${COLORS.cyan}  ${message}${COLORS.reset}`);
  console.log(`${COLORS.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.reset}`);
  console.log('');
}

/**
 * Raw output (direct to stdout)
 */
export function raw(message: string): void {
  process.stdout.write(message);
}

/**
 * Simple log without formatting
 */
export function log(message: string): void {
  console.log(message);
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

/**
 * Logging utilities for CursorFlow
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
 * Format message with timestamp
 */
function formatMessage(level: string, message: string, emoji = ''): string {
  const timestamp = new Date().toISOString();
  const prefix = emoji ? `${emoji} ` : '';
  const lines = String(message).split('\n');
  return lines.map(line => `[${timestamp}] [${level.toUpperCase()}] ${prefix}${line}`).join('\n');
}

/**
 * Log with color
 */
function logWithColor(color: string, level: keyof typeof LogLevel, message: string, emoji = ''): void {
  if (LogLevel[level] > currentLogLevel) {
    return;
  }
  
  const formatted = formatMessage(level, message, emoji);
  console.log(`${color}${formatted}${COLORS.reset}`);
}

/**
 * Error log
 */
export function error(message: string, emoji = '❌'): void {
  logWithColor(COLORS.red, 'error', message, emoji);
}

/**
 * Warning log
 */
export function warn(message: string, emoji = '⚠️'): void {
  logWithColor(COLORS.yellow, 'warn', message, emoji);
}

/**
 * Info log
 */
export function info(message: string, emoji = 'ℹ️'): void {
  logWithColor(COLORS.cyan, 'info', message, emoji);
}

/**
 * Success log
 */
export function success(message: string, emoji = '✅'): void {
  logWithColor(COLORS.green, 'info', message, emoji);
}

/**
 * Debug log
 */
export function debug(message: string, emoji = '🔍'): void {
  logWithColor(COLORS.gray, 'debug', message, emoji);
}

/**
 * Progress log
 */
export function progress(message: string, emoji = '🔄'): void {
  logWithColor(COLORS.blue, 'info', message, emoji);
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
 * Log JSON data (pretty print in debug mode)
 */
export function json(data: any): void {
  if (currentLogLevel >= LogLevel.debug) {
    console.log(JSON.stringify(data, null, 2));
  }
}

export interface Spinner {
  start(): void;
  stop(finalMessage?: string | null): void;
  succeed(message: string): void;
  fail(message: string): void;
}

/**
 * Create spinner (simple implementation)
 */
export function createSpinner(message: string): Spinner {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  let interval: NodeJS.Timeout | null = null;
  
  const spinner: Spinner = {
    start() {
      process.stdout.write(`${message} ${frames[0]}`);
      interval = setInterval(() => {
        i = (i + 1) % frames.length;
        process.stdout.write(`\r${message} ${frames[i]}`);
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
  };

  return spinner;
}

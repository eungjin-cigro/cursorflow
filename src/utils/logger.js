#!/usr/bin/env node
/**
 * Logging utilities for CursorFlow
 */

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

let currentLogLevel = LOG_LEVELS.info;

/**
 * Set log level
 */
function setLogLevel(level) {
  if (typeof level === 'string') {
    currentLogLevel = LOG_LEVELS[level] ?? LOG_LEVELS.info;
  } else {
    currentLogLevel = level;
  }
}

/**
 * Format message with timestamp
 */
function formatMessage(level, message, emoji = '') {
  const timestamp = new Date().toISOString();
  const prefix = emoji ? `${emoji} ` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${prefix}${message}`;
}

/**
 * Log with color
 */
function logWithColor(color, level, message, emoji = '') {
  if (LOG_LEVELS[level] > currentLogLevel) {
    return;
  }
  
  const formatted = formatMessage(level, message, emoji);
  console.log(`${color}${formatted}${COLORS.reset}`);
}

/**
 * Error log
 */
function error(message, emoji = '❌') {
  logWithColor(COLORS.red, 'error', message, emoji);
}

/**
 * Warning log
 */
function warn(message, emoji = '⚠️') {
  logWithColor(COLORS.yellow, 'warn', message, emoji);
}

/**
 * Info log
 */
function info(message, emoji = 'ℹ️') {
  logWithColor(COLORS.cyan, 'info', message, emoji);
}

/**
 * Success log
 */
function success(message, emoji = '✅') {
  logWithColor(COLORS.green, 'info', message, emoji);
}

/**
 * Debug log
 */
function debug(message, emoji = '🔍') {
  logWithColor(COLORS.gray, 'debug', message, emoji);
}

/**
 * Progress log
 */
function progress(message, emoji = '🔄') {
  logWithColor(COLORS.blue, 'info', message, emoji);
}

/**
 * Section header
 */
function section(message) {
  console.log('');
  console.log(`${COLORS.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.reset}`);
  console.log(`${COLORS.cyan}  ${message}${COLORS.reset}`);
  console.log(`${COLORS.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.reset}`);
  console.log('');
}

/**
 * Simple log without formatting
 */
function log(message) {
  console.log(message);
}

/**
 * Log JSON data (pretty print in debug mode)
 */
function json(data) {
  if (currentLogLevel >= LOG_LEVELS.debug) {
    console.log(JSON.stringify(data, null, 2));
  }
}

/**
 * Create spinner (simple implementation)
 */
function createSpinner(message) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  let interval = null;
  
  return {
    start() {
      process.stdout.write(`${message} ${frames[0]}`);
      interval = setInterval(() => {
        i = (i + 1) % frames.length;
        process.stdout.write(`\r${message} ${frames[i]}`);
      }, 80);
    },
    
    stop(finalMessage = null) {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      process.stdout.write('\r\x1b[K'); // Clear line
      if (finalMessage) {
        console.log(finalMessage);
      }
    },
    
    succeed(message) {
      this.stop(`${COLORS.green}✓${COLORS.reset} ${message}`);
    },
    
    fail(message) {
      this.stop(`${COLORS.red}✗${COLORS.reset} ${message}`);
    },
  };
}

module.exports = {
  setLogLevel,
  error,
  warn,
  info,
  success,
  debug,
  progress,
  section,
  log,
  json,
  createSpinner,
  COLORS,
  LOG_LEVELS,
};

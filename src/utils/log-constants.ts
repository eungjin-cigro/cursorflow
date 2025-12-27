/**
 * Shared log constants to avoid circular dependencies
 */

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

export const MAIN_LOG_FILENAME = 'main-raw.log';

export enum LogLevel {
  error = 0,
  warn = 1,
  info = 2,
  success = 2,
  progress = 2,
  debug = 3,
}

/**
 * LogBufferService - Scrollable log buffer for TUI monitor
 * 
 * This file is kept for backward compatibility.
 * New code should import from '../services/logging/buffer' directly.
 */

// Re-export everything from the new services/logging/buffer module
export { 
  LogBufferService, 
  createLogBuffer,
  type LogBufferOptions,
  type LogFilter,
  type LogBufferState,
} from '../services/logging/buffer';

// Re-export types from types/logging for backward compatibility
export type { JsonLogEntry, BufferedLogEntry } from '../types/logging';

/**
 * Log viewport interface for backward compatibility
 */
export interface LogViewport {
  entries: import('../types/logging').BufferedLogEntry[];
  totalCount: number;
  offset: number;
  visibleCount: number;
}

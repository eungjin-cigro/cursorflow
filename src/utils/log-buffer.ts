/**
 * LogBufferService - Scrollable log buffer for TUI monitor
 * 
 * Provides:
 * - Real-time log streaming from JSONL files
 * - In-memory log buffer with size limits
 * - Viewport-based retrieval (for scrolling)
 * - Lane filtering and text search
 * - New entry counting (for follow mode)
 */

import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { LogImportance, JsonLogEntry } from '../types';
import * as logger from './logger';

/**
 * Processed log entry for display
 */
export interface BufferedLogEntry {
  id: number;
  timestamp: Date;
  laneName: string;
  level: string;
  type: string;
  message: string;
  importance: LogImportance;
  laneColor: string;
  raw: JsonLogEntry;
}

/**
 * Buffer configuration options
 */
export interface LogBufferOptions {
  maxEntries?: number;
  pollInterval?: number;
}

/**
 * Filter options for log retrieval
 */
export interface LogFilter {
  lane?: string;
  importance?: LogImportance;
  search?: string;
  type?: string;
}

/**
 * Buffer state for external monitoring
 */
export interface LogBufferState {
  totalEntries: number;
  filteredCount: number;
  newCount: number;
  isStreaming: boolean;
  lanes: string[];
}

// Lane colors for consistent display
const LANE_COLORS = [
  logger.COLORS.cyan,
  logger.COLORS.magenta,
  logger.COLORS.yellow,
  logger.COLORS.green,
  logger.COLORS.blue,
  logger.COLORS.red,
];

export class LogBufferService extends EventEmitter {
  private runDir: string;
  private options: Required<LogBufferOptions>;
  private entries: BufferedLogEntry[] = [];
  private entryIdCounter = 0;
  private isStreaming = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private filePositions = new Map<string, number>();
  private lanes: string[] = [];
  private laneColorMap = new Map<string, string>();
  private newEntriesCount = 0;
  private lastAcknowledgedId = 0;

  constructor(runDir: string, options: LogBufferOptions = {}) {
    super();
    this.runDir = runDir;
    this.options = {
      maxEntries: options.maxEntries ?? 10000,
      pollInterval: options.pollInterval ?? 100,
    };
  }

  /**
   * Start streaming logs from all lane JSONL files
   */
  startStreaming(): void {
    if (this.isStreaming) return;
    this.isStreaming = true;

    // Discover lanes
    this.discoverLanes();

    // Initial load
    this.pollLogs();

    // Start polling
    this.pollTimer = setInterval(() => {
      this.pollLogs();
    }, this.options.pollInterval);

    this.emit('started');
  }

  /**
   * Stop streaming
   */
  stopStreaming(): void {
    if (!this.isStreaming) return;
    this.isStreaming = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    this.emit('stopped');
  }

  /**
   * Discover lane directories
   */
  private discoverLanes(): void {
    const lanesDir = path.join(this.runDir, 'lanes');
    if (!fs.existsSync(lanesDir)) return;

    const dirs = fs.readdirSync(lanesDir).filter(name => {
      const dirPath = path.join(lanesDir, name);
      return fs.statSync(dirPath).isDirectory();
    });

    this.lanes = dirs.sort();
    
    // Assign colors
    this.lanes.forEach((lane, index) => {
      this.laneColorMap.set(lane, LANE_COLORS[index % LANE_COLORS.length]);
    });
  }

  /**
   * Poll all lane log files for new entries
   */
  private pollLogs(): void {
    const lanesDir = path.join(this.runDir, 'lanes');
    if (!fs.existsSync(lanesDir)) return;

    const newEntries: BufferedLogEntry[] = [];

    for (const laneName of this.lanes) {
      const jsonlPath = path.join(lanesDir, laneName, 'terminal.jsonl');
      if (!fs.existsSync(jsonlPath)) continue;

      try {
        const stat = fs.statSync(jsonlPath);
        const lastPos = this.filePositions.get(jsonlPath) || 0;

        if (stat.size > lastPos) {
          // Read new content
          const fd = fs.openSync(jsonlPath, 'r');
          const buffer = Buffer.alloc(stat.size - lastPos);
          fs.readSync(fd, buffer, 0, buffer.length, lastPos);
          fs.closeSync(fd);

          const newContent = buffer.toString('utf-8');
          const lines = newContent.split('\n').filter(line => line.trim());

          for (const line of lines) {
            try {
              const entry = JSON.parse(line) as JsonLogEntry;
              const processed = this.processEntry(entry, laneName);
              if (processed) {
                newEntries.push(processed);
              }
            } catch {
              // Skip invalid JSON lines
            }
          }

          this.filePositions.set(jsonlPath, stat.size);
        }
      } catch (error) {
        // File might be in use, skip this poll
      }
    }

    if (newEntries.length > 0) {
      // Sort by timestamp
      newEntries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      // Add to buffer
      this.entries.push(...newEntries);
      this.newEntriesCount += newEntries.length;

      // Trim buffer if needed
      if (this.entries.length > this.options.maxEntries) {
        const excess = this.entries.length - this.options.maxEntries;
        this.entries.splice(0, excess);
      }

      this.emit('update', newEntries);
    }
  }

  /**
   * Process a raw JSON entry into a BufferedLogEntry
   */
  private processEntry(entry: JsonLogEntry, laneName: string): BufferedLogEntry | null {
    const timestamp = new Date(entry.timestamp || Date.now());
    const type = entry.type || 'unknown';
    const level = entry.level || this.inferLevel(type);
    const message = entry.content || entry.message || JSON.stringify(entry);
    const importance = this.inferImportance(type, level);

    return {
      id: ++this.entryIdCounter,
      timestamp,
      laneName,
      level,
      type,
      message: this.truncateMessage(message),
      importance,
      laneColor: this.laneColorMap.get(laneName) || logger.COLORS.white,
      raw: entry,
    };
  }

  /**
   * Infer log level from type
   */
  private inferLevel(type: string): string {
    switch (type.toLowerCase()) {
      case 'error':
      case 'stderr':
        return 'error';
      case 'warning':
        return 'warn';
      case 'debug':
      case 'thinking':
        return 'debug';
      default:
        return 'info';
    }
  }

  /**
   * Infer importance from type and level
   */
  private inferImportance(type: string, level: string): LogImportance {
    if (level === 'error' || type === 'error' || type === 'result') {
      return LogImportance.HIGH;
    }
    if (type === 'tool' || type === 'tool_result') {
      return LogImportance.MEDIUM;
    }
    if (type === 'thinking' || level === 'debug') {
      return LogImportance.DEBUG;
    }
    if (type === 'assistant' || type === 'user') {
      return LogImportance.MEDIUM;
    }
    return LogImportance.INFO;
  }

  /**
   * Truncate long messages
   */
  private truncateMessage(message: string, maxLength = 500): string {
    if (message.length <= maxLength) return message;
    return message.substring(0, maxLength) + '...';
  }

  /**
   * Get entries with filtering and pagination
   */
  getEntries(options: {
    offset?: number;
    limit?: number;
    filter?: LogFilter;
    fromEnd?: boolean;
  } = {}): BufferedLogEntry[] {
    const { offset = 0, limit = 100, filter, fromEnd = true } = options;

    let filtered = this.applyFilter(this.entries, filter);

    if (fromEnd) {
      // Return from the end (most recent) with offset going backwards
      const start = Math.max(0, filtered.length - offset - limit);
      const end = Math.max(0, filtered.length - offset);
      return filtered.slice(start, end);
    } else {
      // Return from the beginning with offset
      return filtered.slice(offset, offset + limit);
    }
  }

  /**
   * Apply filter to entries
   */
  private applyFilter(entries: BufferedLogEntry[], filter?: LogFilter): BufferedLogEntry[] {
    if (!filter) return entries;

    return entries.filter(entry => {
      // Lane filter
      if (filter.lane && entry.laneName !== filter.lane) {
        return false;
      }

      // Importance filter
      if (filter.importance) {
        const importanceOrder = [
          LogImportance.DEBUG,
          LogImportance.INFO,
          LogImportance.LOW,
          LogImportance.MEDIUM,
          LogImportance.HIGH,
          LogImportance.CRITICAL,
        ];
        const entryLevel = importanceOrder.indexOf(entry.importance);
        const filterLevel = importanceOrder.indexOf(filter.importance);
        if (entryLevel < filterLevel) {
          return false;
        }
      }

      // Type filter
      if (filter.type && entry.type !== filter.type) {
        return false;
      }

      // Search filter
      if (filter.search) {
        const searchLower = filter.search.toLowerCase();
        const messageMatch = entry.message.toLowerCase().includes(searchLower);
        const typeMatch = entry.type.toLowerCase().includes(searchLower);
        if (!messageMatch && !typeMatch) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Get total count with optional filter
   */
  getTotalCount(filter?: LogFilter): number {
    if (!filter) return this.entries.length;
    return this.applyFilter(this.entries, filter).length;
  }

  /**
   * Get count of new entries since last acknowledgment
   */
  getNewEntriesCount(): number {
    return this.newEntriesCount;
  }

  /**
   * Acknowledge new entries (reset counter)
   */
  acknowledgeNewEntries(): void {
    this.newEntriesCount = 0;
    this.lastAcknowledgedId = this.entryIdCounter;
  }

  /**
   * Get list of discovered lanes
   */
  getLanes(): string[] {
    return [...this.lanes];
  }

  /**
   * Get current state
   */
  getState(): LogBufferState {
    return {
      totalEntries: this.entries.length,
      filteredCount: this.entries.length,
      newCount: this.newEntriesCount,
      isStreaming: this.isStreaming,
      lanes: this.getLanes(),
    };
  }

  /**
   * Get lane color
   */
  getLaneColor(laneName: string): string {
    return this.laneColorMap.get(laneName) || logger.COLORS.white;
  }

  /**
   * Clear buffer
   */
  clear(): void {
    this.entries = [];
    this.entryIdCounter = 0;
    this.newEntriesCount = 0;
    this.lastAcknowledgedId = 0;
    this.filePositions.clear();
  }

  /**
   * Format entry for display
   */
  formatEntry(entry: BufferedLogEntry, options: { showLane?: boolean; showTimestamp?: boolean } = {}): string {
    const { showLane = true, showTimestamp = true } = options;
    
    const parts: string[] = [];
    
    if (showTimestamp) {
      const ts = entry.timestamp.toLocaleTimeString('en-US', { hour12: false });
      parts.push(`${logger.COLORS.gray}[${ts}]${logger.COLORS.reset}`);
    }
    
    if (showLane) {
      parts.push(`${entry.laneColor}[${entry.laneName.padEnd(12)}]${logger.COLORS.reset}`);
    }
    
    // Type indicator
    const typeIndicator = this.getTypeIndicator(entry.type);
    parts.push(typeIndicator);
    
    // Message
    parts.push(entry.message);
    
    return parts.join(' ');
  }

  /**
   * Get type indicator for display
   */
  private getTypeIndicator(type: string): string {
    switch (type.toLowerCase()) {
      case 'user':
        return `${logger.COLORS.cyan}[USER  ]${logger.COLORS.reset}`;
      case 'assistant':
        return `${logger.COLORS.green}[ASST  ]${logger.COLORS.reset}`;
      case 'tool':
        return `${logger.COLORS.yellow}[TOOL  ]${logger.COLORS.reset}`;
      case 'tool_result':
        return `${logger.COLORS.gray}[RESULT]${logger.COLORS.reset}`;
      case 'error':
      case 'stderr':
        return `${logger.COLORS.red}[ERROR ]${logger.COLORS.reset}`;
      case 'thinking':
        return `${logger.COLORS.gray}[THINK ]${logger.COLORS.reset}`;
      case 'result':
        return `${logger.COLORS.green}[DONE  ]${logger.COLORS.reset}`;
      case 'stdout':
        return `${logger.COLORS.white}[STDOUT]${logger.COLORS.reset}`;
      default:
        return `${logger.COLORS.gray}[${type.toUpperCase().padEnd(8)}]${logger.COLORS.reset}`;
    }
  }
}

/**
 * Create a LogBufferService for a run
 */
export function createLogBuffer(runDir: string, options?: LogBufferOptions): LogBufferService {
  return new LogBufferService(runDir, options);
}

/**
 * Log viewport interface for backward compatibility
 */
export interface LogViewport {
  entries: BufferedLogEntry[];
  totalCount: number;
  offset: number;
  visibleCount: number;
}

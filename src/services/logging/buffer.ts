/**
 * Log Buffer Service - In-memory log buffer for TUI
 * 
 * Provides real-time log streaming and filtering for the interactive monitor.
 */

import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { LogImportance, JsonLogEntry, BufferedLogEntry as BufferedLogEntryType, MessageType } from '../../types/logging';
import { COLORS } from './console';

// Re-export types for convenience
export type { BufferedLogEntry } from '../../types/logging';

export interface LogBufferOptions {
  maxEntries?: number;
  pollInterval?: number;
}

export interface LogFilter {
  lane?: string;
  importance?: LogImportance;
  search?: string;
  type?: string;
}

export interface LogBufferState {
  totalEntries: number;
  filteredCount: number;
  newCount: number;
  isStreaming: boolean;
  lanes: string[];
}

const LANE_COLORS = [
  COLORS.cyan,
  COLORS.magenta,
  COLORS.yellow,
  COLORS.green,
  COLORS.blue,
  COLORS.red,
];

export class LogBufferService extends EventEmitter {
  private runDir: string;
  private options: Required<LogBufferOptions>;
  private entries: BufferedLogEntryType[] = [];
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

  startStreaming(): void {
    if (this.isStreaming) return;
    this.isStreaming = true;
    this.discoverLanes();
    this.pollLogs();
    this.pollTimer = setInterval(() => this.pollLogs(), this.options.pollInterval);
    this.emit('started');
  }

  stopStreaming(): void {
    if (!this.isStreaming) return;
    this.isStreaming = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.emit('stopped');
  }

  private discoverLanes(): void {
    const lanesDir = path.join(this.runDir, 'lanes');
    if (!fs.existsSync(lanesDir)) return;

    const dirs = fs.readdirSync(lanesDir).filter(name => {
      const dirPath = path.join(lanesDir, name);
      return fs.statSync(dirPath).isDirectory();
    });

    this.lanes = dirs.sort();
    this.lanes.forEach((lane, index) => {
      this.laneColorMap.set(lane, LANE_COLORS[index % LANE_COLORS.length]);
    });
  }

  private pollLogs(): void {
    const lanesDir = path.join(this.runDir, 'lanes');
    if (!fs.existsSync(lanesDir)) return;

    // Re-discover lanes to pick up new ones
    this.discoverLanes();

    const newEntries: BufferedLogEntryType[] = [];

    for (const laneName of this.lanes) {
      const jsonlPath = path.join(lanesDir, laneName, 'terminal.jsonl');
      if (!fs.existsSync(jsonlPath)) continue;

      try {
        const stat = fs.statSync(jsonlPath);
        const lastPos = this.filePositions.get(jsonlPath) || 0;

        if (stat.size > lastPos) {
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
              if (processed) newEntries.push(processed);
            } catch { /* Skip invalid JSON */ }
          }

          this.filePositions.set(jsonlPath, stat.size);
        }
      } catch { /* File in use, skip */ }
    }

    if (newEntries.length > 0) {
      newEntries.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      this.entries.push(...newEntries);
      this.newEntriesCount += newEntries.length;

      if (this.entries.length > this.options.maxEntries) {
        const excess = this.entries.length - this.options.maxEntries;
        this.entries.splice(0, excess);
      }

      this.emit('update', newEntries);
    }
  }

  private processEntry(entry: JsonLogEntry, laneName: string): BufferedLogEntryType | null {
    const timestamp = new Date(entry.timestamp || Date.now());
    const type = (entry.type || 'unknown') as MessageType;
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
      laneColor: this.laneColorMap.get(laneName) || COLORS.white,
      raw: entry,
    };
  }

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

  private inferImportance(type: string, level: string): LogImportance {
    if (level === 'error' || type === 'error' || type === 'result') return LogImportance.HIGH;
    if (type === 'tool' || type === 'tool_result') return LogImportance.MEDIUM;
    if (type === 'thinking' || level === 'debug') return LogImportance.DEBUG;
    if (type === 'assistant' || type === 'user') return LogImportance.MEDIUM;
    return LogImportance.INFO;
  }

  private truncateMessage(message: string, maxLength = 500): string {
    if (message.length <= maxLength) return message;
    return message.substring(0, maxLength) + '...';
  }

  getEntries(options: {
    offset?: number;
    limit?: number;
    filter?: LogFilter;
    fromEnd?: boolean;
  } = {}): BufferedLogEntryType[] {
    const { offset = 0, limit = 100, filter, fromEnd = true } = options;
    let filtered = this.applyFilter(this.entries, filter);

    if (fromEnd) {
      const start = Math.max(0, filtered.length - offset - limit);
      const end = Math.max(0, filtered.length - offset);
      return filtered.slice(start, end);
    }
    return filtered.slice(offset, offset + limit);
  }

  private applyFilter(entries: BufferedLogEntryType[], filter?: LogFilter): BufferedLogEntryType[] {
    if (!filter) return entries;

    return entries.filter(entry => {
      if (filter.lane && entry.laneName !== filter.lane) return false;

      if (filter.importance) {
        const order = [LogImportance.DEBUG, LogImportance.INFO, LogImportance.LOW, 
                       LogImportance.MEDIUM, LogImportance.HIGH, LogImportance.CRITICAL];
        if (order.indexOf(entry.importance) < order.indexOf(filter.importance)) return false;
      }

      if (filter.type && entry.type !== filter.type) return false;

      if (filter.search) {
        const searchLower = filter.search.toLowerCase();
        if (!entry.message.toLowerCase().includes(searchLower) &&
            !entry.type.toLowerCase().includes(searchLower)) return false;
      }

      return true;
    });
  }

  getTotalCount(filter?: LogFilter): number {
    if (!filter) return this.entries.length;
    return this.applyFilter(this.entries, filter).length;
  }

  getNewEntriesCount(): number {
    return this.newEntriesCount;
  }

  acknowledgeNewEntries(): void {
    this.newEntriesCount = 0;
    this.lastAcknowledgedId = this.entryIdCounter;
  }

  getLanes(): string[] {
    return [...this.lanes];
  }

  getState(): LogBufferState {
    return {
      totalEntries: this.entries.length,
      filteredCount: this.entries.length,
      newCount: this.newEntriesCount,
      isStreaming: this.isStreaming,
      lanes: this.getLanes(),
    };
  }

  getLaneColor(laneName: string): string {
    return this.laneColorMap.get(laneName) || COLORS.white;
  }

  clear(): void {
    this.entries = [];
    this.entryIdCounter = 0;
    this.newEntriesCount = 0;
    this.lastAcknowledgedId = 0;
    this.filePositions.clear();
  }

  formatEntry(entry: BufferedLogEntryType, options: { showLane?: boolean; showTimestamp?: boolean } = {}): string {
    const { showLane = true, showTimestamp = true } = options;
    const parts: string[] = [];

    if (showTimestamp) {
      const ts = entry.timestamp.toLocaleTimeString('en-US', { hour12: false });
      parts.push(`${COLORS.gray}[${ts}]${COLORS.reset}`);
    }

    if (showLane) {
      parts.push(`${entry.laneColor}[${entry.laneName.padEnd(12)}]${COLORS.reset}`);
    }

    parts.push(this.getTypeIndicator(entry.type));
    parts.push(entry.message);

    return parts.join(' ');
  }

  private getTypeIndicator(type: string): string {
    const indicators: Record<string, string> = {
      user: `${COLORS.cyan}[USER  ]${COLORS.reset}`,
      assistant: `${COLORS.green}[ASST  ]${COLORS.reset}`,
      tool: `${COLORS.yellow}[TOOL  ]${COLORS.reset}`,
      tool_result: `${COLORS.gray}[RESULT]${COLORS.reset}`,
      error: `${COLORS.red}[ERROR ]${COLORS.reset}`,
      stderr: `${COLORS.red}[ERROR ]${COLORS.reset}`,
      thinking: `${COLORS.gray}[THINK ]${COLORS.reset}`,
      result: `${COLORS.green}[DONE  ]${COLORS.reset}`,
      stdout: `${COLORS.white}[STDOUT]${COLORS.reset}`,
    };
    return indicators[type.toLowerCase()] || `${COLORS.gray}[${type.toUpperCase().padEnd(6)}]${COLORS.reset}`;
  }
}

export function createLogBuffer(runDir: string, options?: LogBufferOptions): LogBufferService {
  return new LogBufferService(runDir, options);
}


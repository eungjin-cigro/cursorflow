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
import { stripAnsi } from './formatter';

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
      const readablePath = path.join(lanesDir, laneName, 'terminal-readable.log');

      let fd: number | null = null;
      try {
        // Read file content atomically to avoid TOCTOU race condition
        const lastPos = this.filePositions.get(readablePath) || 0;
        fd = fs.openSync(readablePath, 'r');
        const stat = fs.fstatSync(fd); // Use fstat on open fd to avoid race
        
        if (stat.size > lastPos) {
          const buffer = Buffer.alloc(stat.size - lastPos);
          fs.readSync(fd, buffer, 0, buffer.length, lastPos);
          
          const newContent = buffer.toString('utf-8');
          const lines = newContent.split('\n').filter(line => line.trim());

          for (const line of lines) {
            const processed = this.processReadableLine(line, laneName);
            if (processed) newEntries.push(processed);
          }

          this.filePositions.set(readablePath, stat.size);
        }
      } catch { /* File in use, skip */ }
      finally {
        if (fd !== null) {
          try { fs.closeSync(fd); } catch { /* ignore */ }
        }
      }
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

  private processReadableLine(line: string, laneName: string): BufferedLogEntryType | null {
    const cleaned = stripAnsi(line).trim();
    if (!cleaned) return null;

    const { timestamp, message, level, type } = this.parseReadableMessage(cleaned);
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
      raw: {
        timestamp: timestamp.toISOString(),
        level: level as JsonLogEntry['level'],
        lane: laneName,
        message,
      },
    };
  }

  private parseReadableMessage(line: string): {
    timestamp: Date;
    message: string;
    level: string;
    type: MessageType | string;
  } {
    let remaining = line;
    let timestamp = new Date();

    const isoMatch = remaining.match(/^\[(\d{4}-\d{2}-\d{2}T[^\]]+)\]\s*/);
    if (isoMatch) {
      timestamp = new Date(isoMatch[1]!);
      remaining = remaining.slice(isoMatch[0].length);
    } else {
      const timeMatch = remaining.match(/^\[(\d{2}:\d{2}:\d{2})\]\s*/);
      if (timeMatch) {
        const [hours, minutes, seconds] = timeMatch[1]!.split(':').map(Number);
        const now = new Date();
        now.setHours(hours || 0, minutes || 0, seconds || 0, 0);
        timestamp = now;
        remaining = remaining.slice(timeMatch[0].length);
      }
    }

    const labelMatch = remaining.match(/^\[[^\]]+\]\s*/);
    if (labelMatch) {
      remaining = remaining.slice(labelMatch[0].length);
    }

    const upper = remaining.toUpperCase();
    let level = 'info';
    let type: MessageType | string = 'stdout';

    if (remaining.includes('❌') || upper.includes('ERR') || upper.includes('ERROR')) {
      level = 'error';
      type = 'error';
    } else if (remaining.includes('⚠️') || upper.includes('WARN')) {
      level = 'warn';
      type = 'warn';
    } else if (remaining.includes('🔍') || upper.includes('DEBUG')) {
      level = 'debug';
      type = 'debug';
    } else if (remaining.includes('ℹ️') || upper.includes('INFO')) {
      level = 'info';
      type = 'info';
    }

    return { timestamp, message: remaining, level, type };
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
      // Lane label: fixed 14 chars inside brackets
      const truncatedLane = entry.laneName.length > 14 ? entry.laneName.substring(0, 14) : entry.laneName;
      parts.push(`${COLORS.magenta}[${truncatedLane.padEnd(14)}]${COLORS.reset}`);
    }

    const { indicator, messageColor } = this.getTypeIndicator(entry.type);
    parts.push(indicator);
    
    // Apply message color if needed
    const coloredMessage = messageColor ? `${messageColor}${entry.message}${COLORS.reset}` : entry.message;
    parts.push(coloredMessage);

    return parts.join(' ');
  }

  private getTypeIndicator(type: string): { indicator: string; messageColor: string } {
    // Color rules:
    // - Important (colored): user(cyan), assistant(green), result(green), error(red), warn(yellow)
    // - Less important (gray): tool, tool_result, thinking, system, debug, stdout, info, raw
    const indicators: Record<string, { indicator: string; messageColor: string }> = {
      user: { indicator: `${COLORS.cyan}🧑 USER${COLORS.reset}`, messageColor: '' },
      assistant: { indicator: `${COLORS.green}🤖 ASST${COLORS.reset}`, messageColor: '' },
      tool: { indicator: `${COLORS.gray}🔧 TOOL${COLORS.reset}`, messageColor: COLORS.gray },
      tool_result: { indicator: `${COLORS.gray}📄 RESL${COLORS.reset}`, messageColor: COLORS.gray },
      error: { indicator: `${COLORS.red}❌ ERR${COLORS.reset}`, messageColor: COLORS.red },
      stderr: { indicator: `${COLORS.red}   >>${COLORS.reset}`, messageColor: COLORS.red },
      thinking: { indicator: `${COLORS.gray}🤔 THNK${COLORS.reset}`, messageColor: COLORS.gray },
      result: { indicator: `${COLORS.green}✅ DONE${COLORS.reset}`, messageColor: '' },
      success: { indicator: `${COLORS.green}✅ DONE${COLORS.reset}`, messageColor: '' },
      stdout: { indicator: `${COLORS.gray}   >>${COLORS.reset}`, messageColor: COLORS.gray },
      raw: { indicator: `${COLORS.gray}   >>${COLORS.reset}`, messageColor: COLORS.gray },
      info: { indicator: `${COLORS.gray}ℹ️  INFO${COLORS.reset}`, messageColor: COLORS.gray },
      warn: { indicator: `${COLORS.yellow}⚠️  WARN${COLORS.reset}`, messageColor: '' },
      debug: { indicator: `${COLORS.gray}🔍 DBUG${COLORS.reset}`, messageColor: COLORS.gray },
      system: { indicator: `${COLORS.gray}⚙️  SYS${COLORS.reset}`, messageColor: COLORS.gray },
      progress: { indicator: `${COLORS.blue}🔄 PROG${COLORS.reset}`, messageColor: '' },
    };
    
    const match = indicators[type.toLowerCase()];
    if (match) return match;
    
    // Default: gray for unknown types
    return { 
      indicator: `${COLORS.gray}   ${type.toUpperCase().substring(0, 4).padEnd(4)}${COLORS.reset}`,
      messageColor: COLORS.gray 
    };
  }
}

export function createLogBuffer(runDir: string, options?: LogBufferOptions): LogBufferService {
  return new LogBufferService(runDir, options);
}

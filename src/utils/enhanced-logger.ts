/**
 * Enhanced Logger - Simplified terminal output capture
 * 
 * Features:
 * - Raw log: Original output as-is
 * - Readable log: Formatted with formatMessageForConsole style
 */

import * as fs from 'fs';
import * as path from 'path';
import { EnhancedLogConfig, ParsedMessage, LogSession } from '../types';
import { formatMessageForConsole } from './log-formatter';
import { safeJoin } from './path';

export { EnhancedLogConfig, ParsedMessage, LogSession };

// Re-export JsonLogEntry for backward compatibility (empty type)
export interface JsonLogEntry {
  timestamp: string;
  level: string;
  lane?: string;
  task?: string;
  message: string;
  metadata?: Record<string, any>;
  source?: string;
  raw?: string;
}

export const DEFAULT_LOG_CONFIG: EnhancedLogConfig = {
  enabled: true,
  stripAnsi: true,
  addTimestamps: true,
  maxFileSize: 50 * 1024 * 1024, // 50MB
  maxFiles: 5,
  keepRawLogs: true,
  keepAbsoluteRawLogs: false,
  raw: false,
  writeJsonLog: false, // Disabled by default now
  timestampFormat: 'iso',
};

/**
 * ANSI escape sequence regex pattern
 */
const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
const EXTENDED_ANSI_REGEX = /(?:\x1B[@-Z\\-_]|\x1B\[[0-?]*[ -/]*[@-~]|\x1B\][^\x07]*(?:\x07|\x1B\\)|\x1B[PX^_][^\x1B]*\x1B\\|\x1B.)/g;

/**
 * Strip ANSI escape sequences from text
 */
export function stripAnsi(text: string): string {
  return text
    .replace(EXTENDED_ANSI_REGEX, '')
    .replace(ANSI_REGEX, '')
    .replace(/\r[^\n]/g, '\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Format timestamp
 */
export function formatTimestamp(format: 'iso' | 'relative' | 'short', startTime?: number): string {
  const now = Date.now();
  
  switch (format) {
    case 'iso':
      return new Date(now).toISOString();
    case 'relative':
      if (startTime) {
        const elapsed = now - startTime;
        const seconds = Math.floor(elapsed / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        
        if (hours > 0) {
          return `+${hours}h${minutes % 60}m${seconds % 60}s`;
        } else if (minutes > 0) {
          return `+${minutes}m${seconds % 60}s`;
        } else {
          return `+${seconds}s`;
        }
      }
      return new Date(now).toISOString();
    case 'short':
      return new Date(now).toLocaleTimeString('en-US', { hour12: false });
    default:
      return new Date(now).toISOString();
  }
}

/**
 * Simplified Log Manager - Only raw and readable logs
 */
export class EnhancedLogManager {
  private config: EnhancedLogConfig;
  private session: LogSession;
  private logDir: string;
  
  private rawLogPath: string;
  private readableLogPath: string;
  
  private rawLogFd: number | null = null;
  private readableLogFd: number | null = null;
  
  private rawLogSize: number = 0;
  
  private onParsedMessage?: (msg: ParsedMessage) => void;

  constructor(logDir: string, session: LogSession, config: Partial<EnhancedLogConfig> = {}, onParsedMessage?: (msg: ParsedMessage) => void) {
    this.config = { ...DEFAULT_LOG_CONFIG, ...config };
    this.session = session;
    this.logDir = logDir;
    this.onParsedMessage = onParsedMessage;
    
    // Ensure log directory exists
    fs.mkdirSync(logDir, { recursive: true });
    
    // Set up log file paths (simplified)
    this.rawLogPath = safeJoin(logDir, 'terminal-raw.log');
    this.readableLogPath = safeJoin(logDir, 'terminal-readable.log');
    
    // Initialize log files
    this.initLogFiles();
  }

  /**
   * Get short time format (HH:MM:SS)
   */
  private getShortTime(): string {
    return new Date().toLocaleTimeString('en-US', { hour12: false });
  }

  /**
   * Get lane-task label like [L1-T2-lanename10]
   */
  private getLaneTaskLabel(): string {
    const laneNum = (this.session.laneIndex ?? 0) + 1;
    const taskNum = (this.session.taskIndex ?? 0) + 1;
    const shortLaneName = this.session.laneName.substring(0, 10);
    return `L${laneNum}-T${taskNum}-${shortLaneName}`;
  }

  /**
   * Initialize log files and write session headers
   */
  private initLogFiles(): void {
    // Check and rotate if necessary
    if (this.config.keepRawLogs) {
      this.rotateIfNeeded(this.rawLogPath);
      this.rawLogFd = fs.openSync(this.rawLogPath, 'a');
    }
    
    this.rotateIfNeeded(this.readableLogPath);
    this.readableLogFd = fs.openSync(this.readableLogPath, 'a');
    
    // Get initial file size for raw log if enabled
    if (this.rawLogFd !== null) {
      try {
        this.rawLogSize = fs.statSync(this.rawLogPath).size;
      } catch {
        this.rawLogSize = 0;
      }
    }
    
    // Write session header
    this.writeSessionHeader();
  }

  /**
   * Write session header to logs
   */
  private writeSessionHeader(): void {
    const header = `
╔══════════════════════════════════════════════════════════════════════════════╗
║  CursorFlow Session Log                                                       ║
╠══════════════════════════════════════════════════════════════════════════════╣
║  Session ID:  ${this.session.id.padEnd(62)}║
║  Lane:        ${this.session.laneName.padEnd(62)}║
║  Task:        ${(this.session.taskName || '-').padEnd(62)}║
║  Model:       ${(this.session.model || 'default').padEnd(62)}║
║  Started:     ${new Date(this.session.startTime).toISOString().padEnd(62)}║
╚══════════════════════════════════════════════════════════════════════════════╝

`;
    
    this.writeToRawLog(header);
    this.writeToReadableLog(header);
  }

  /**
   * Rotate log file if it exceeds max size
   */
  private rotateIfNeeded(logPath: string): void {
    if (!fs.existsSync(logPath)) return;
    
    try {
      const stats = fs.statSync(logPath);
      if (stats.size >= this.config.maxFileSize) {
        this.rotateLog(logPath);
      }
    } catch {
      // File doesn't exist or can't be read, ignore
    }
  }

  /**
   * Rotate a log file
   */
  private rotateLog(logPath: string): void {
    const dir = path.dirname(logPath);
    const ext = path.extname(logPath);
    const base = path.basename(logPath, ext);
    
    // Shift existing rotated files
    for (let i = this.config.maxFiles - 1; i >= 1; i--) {
      const oldPath = safeJoin(dir, `${base}.${i}${ext}`);
      const newPath = safeJoin(dir, `${base}.${i + 1}${ext}`);
      
      if (fs.existsSync(oldPath)) {
        if (i === this.config.maxFiles - 1) {
          fs.unlinkSync(oldPath); // Delete oldest
        } else {
          fs.renameSync(oldPath, newPath);
        }
      }
    }
    
    // Rotate current to .1
    const rotatedPath = safeJoin(dir, `${base}.1${ext}`);
    fs.renameSync(logPath, rotatedPath);
  }

  /**
   * Write to raw log with size tracking
   */
  private writeToRawLog(data: string | Buffer): void {
    if (this.rawLogFd === null) return;
    
    const buffer = typeof data === 'string' ? Buffer.from(data) : data;
    fs.writeSync(this.rawLogFd, buffer);
    this.rawLogSize += buffer.length;
    
    // Check if rotation needed
    if (this.rawLogSize >= this.config.maxFileSize) {
      fs.closeSync(this.rawLogFd);
      this.rotateLog(this.rawLogPath);
      this.rawLogFd = fs.openSync(this.rawLogPath, 'a');
      this.rawLogSize = 0;
    }
  }

  /**
   * Write to readable log
   */
  private writeToReadableLog(data: string): void {
    if (this.readableLogFd === null) return;
    
    try {
      fs.writeSync(this.readableLogFd, data);
    } catch {
      // Ignore write errors
    }
  }

  /**
   * Write a parsed message to the readable log using formatMessageForConsole style
   */
  public writeReadableMessage(msg: ParsedMessage): void {
    // Use formatMessageForConsole for consistent formatting
    // Use short lane-task label like [L01-T02]
    const formatted = formatMessageForConsole(msg, {
      laneLabel: `[${this.getLaneTaskLabel()}]`,
      includeTimestamp: false, // We'll add our own short timestamp
    });
    
    // Strip ANSI codes and add short timestamp for file output
    const clean = stripAnsi(formatted);
    const ts = this.getShortTime();
    this.writeToReadableLog(`[${ts}] ${clean}\n`);
    
    // Callback for console output
    if (this.onParsedMessage) {
      this.onParsedMessage(msg);
    }
  }

  /**
   * Write stdout data
   */
  public writeStdout(data: Buffer | string): void {
    const text = data.toString();
    
    // Write raw log (original data)
    this.writeToRawLog(data);
    
    // Parse JSON output and write to readable log
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      // Try to parse as JSON (cursor-agent output)
      if (trimmed.startsWith('{')) {
        try {
          const json = JSON.parse(trimmed);
          const msg = this.parseJsonToMessage(json);
          if (msg) {
            this.writeReadableMessage(msg);
            continue;
          }
        } catch {
          // Not valid JSON, fall through
        }
      }
      
      // Non-JSON line - write as-is with short timestamp and lane-task label
      const cleanLine = stripAnsi(trimmed);
      if (cleanLine && !this.isNoiseLog(cleanLine)) {
        const hasTimestamp = /^\[(\d{4}-\d{2}-\d{2}T|\d{2}:\d{2}:\d{2})\]/.test(cleanLine);
        const label = this.getLaneTaskLabel();
        
        if (hasTimestamp) {
          // If already has timestamp, just ensure label is present
          const formatted = cleanLine.includes(`[${label}]`) 
            ? cleanLine 
            : cleanLine.replace(/^(\[[^\]]+\])/, `$1 [${label}]`);
          this.writeToReadableLog(`${formatted}\n`);
        } else {
          const ts = this.getShortTime();
          this.writeToReadableLog(`[${ts}] [${label}] ${cleanLine}\n`);
        }
      }
    }
  }

  /**
   * Parse cursor-agent JSON output to ParsedMessage
   */
  private parseJsonToMessage(json: any): ParsedMessage | null {
    const type = json.type;
    const timestamp = json.timestamp_ms || Date.now();
    
    switch (type) {
      case 'system':
        return {
          type: 'system',
          role: 'system',
          content: `Model: ${json.model || 'unknown'}, Mode: ${json.permissionMode || 'default'}`,
          timestamp,
        };
        
      case 'user':
        if (json.message?.content) {
          const textContent = json.message.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('');
          return {
            type: 'user',
            role: 'user',
            content: textContent,
            timestamp,
          };
        }
        return null;
        
      case 'assistant':
        if (json.message?.content) {
          const textContent = json.message.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('');
          return {
            type: 'assistant',
            role: 'assistant',
            content: textContent,
            timestamp,
          };
        }
        return null;
        
      case 'tool_call':
        if (json.subtype === 'started' && json.tool_call) {
          const toolName = Object.keys(json.tool_call)[0] || 'unknown';
          const toolArgs = json.tool_call[toolName]?.args || {};
          return {
            type: 'tool',
            role: 'tool',
            content: `[Tool: ${toolName}] ${JSON.stringify(toolArgs)}`,
            timestamp,
            metadata: { callId: json.call_id, toolName },
          };
        } else if (json.subtype === 'completed' && json.tool_call) {
          const toolName = Object.keys(json.tool_call)[0] || 'unknown';
          return {
            type: 'tool_result',
            role: 'tool',
            content: `[Tool Result: ${toolName}]`,
            timestamp,
            metadata: { callId: json.call_id, toolName },
          };
        }
        return null;
        
      case 'result':
        return {
          type: 'result',
          role: 'assistant',
          content: json.result || '',
          timestamp,
          metadata: {
            duration_ms: json.duration_ms,
            is_error: json.is_error,
          },
        };
        
      case 'thinking':
        if (json.text) {
          return {
            type: 'thinking',
            role: 'assistant',
            content: json.text,
            timestamp,
          };
        }
        return null;
        
      default:
        return null;
    }
  }

  /**
   * Write stderr data
   */
  public writeStderr(data: Buffer | string): void {
    const text = data.toString();
    
    // Write raw log
    this.writeToRawLog(data);
    
    // Write to readable log with error prefix
    const lines = text.split('\n');
    for (const line of lines) {
      const cleanLine = stripAnsi(line).trim();
      if (cleanLine && !this.isNoiseLog(cleanLine)) {
        const hasTimestamp = /^\[(\d{4}-\d{2}-\d{2}T|\d{2}:\d{2}:\d{2})\]/.test(cleanLine);
        const label = this.getLaneTaskLabel();
        
        if (hasTimestamp) {
          const formatted = cleanLine.includes(`[${label}]`) 
            ? cleanLine 
            : cleanLine.replace(/^(\[[^\]]+\])/, `$1 [${label}] ❌ ERR`);
          this.writeToReadableLog(`${formatted}\n`);
        } else {
          const ts = this.getShortTime();
          this.writeToReadableLog(`[${ts}] [${label}] ❌ ERR ${cleanLine}\n`);
        }
      }
    }
  }

  /**
   * Write a custom log entry
   */
  public log(level: 'info' | 'error' | 'debug', message: string, metadata?: Record<string, any>): void {
    const ts = this.getShortTime();
    const label = this.getLaneTaskLabel();
    const emoji = level === 'error' ? '❌' : level === 'info' ? 'ℹ️' : '🔍';
    const line = `[${ts}] [${label}] ${emoji} ${level.toUpperCase()} ${message}\n`;
    
    this.writeToRawLog(line);
    this.writeToReadableLog(line);
  }

  /**
   * Add a section marker
   */
  public section(title: string): void {
    const divider = '═'.repeat(78);
    const line = `\n${divider}\n  ${title}\n${divider}\n`;
    
    this.writeToRawLog(line);
    this.writeToReadableLog(line);
  }

  /**
   * Update task context
   */
  public setTask(taskName: string, model?: string, taskIndex?: number): void {
    this.session.taskName = taskName;
    if (model) {
      this.session.model = model;
    }
    if (taskIndex !== undefined) {
      this.session.taskIndex = taskIndex;
    }
    
    this.section(`Task: ${taskName}${model ? ` (Model: ${model})` : ''}`);
  }

  /**
   * Check if a log line is noise
   */
  private isNoiseLog(text: string): boolean {
    if (!text.trim()) return true;
    
    const noisePatterns = [
      /^[\s│├└─┌┐┘┴┬┤]+$/,
      /^[.\s]+$/,
      /^[=>\s-]+$/,
      /^\d+%$/,
      /^⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/,
    ];
    
    return noisePatterns.some(p => p.test(text));
  }

  /**
   * Get paths to all log files
   */
  public getLogPaths(): { clean: string; raw: string; readable: string } {
    return {
      clean: this.readableLogPath, // For backward compatibility
      raw: this.rawLogPath,
      readable: this.readableLogPath,
    };
  }

  /**
   * Create file descriptors for process stdio redirection
   */
  public getFileDescriptors(): { stdout: number; stderr: number } {
    const fd = this.rawLogFd!;
    return { stdout: fd, stderr: fd };
  }

  /**
   * Close all log files
   */
  public close(): void {
    // Write session end marker
    const endMarker = `
╔══════════════════════════════════════════════════════════════════════════════╗
║  Session Ended: ${new Date().toISOString().padEnd(60)}║
║  Duration: ${this.formatDuration(Date.now() - this.session.startTime).padEnd(65)}║
╚══════════════════════════════════════════════════════════════════════════════╝

`;
    
    if (this.rawLogFd !== null) {
      try {
        fs.writeSync(this.rawLogFd, endMarker);
        fs.fsyncSync(this.rawLogFd);
        fs.closeSync(this.rawLogFd);
      } catch {}
      this.rawLogFd = null;
    }
    
    if (this.readableLogFd !== null) {
      try {
        fs.writeSync(this.readableLogFd, endMarker);
        fs.fsyncSync(this.readableLogFd);
        fs.closeSync(this.readableLogFd);
      } catch {}
      this.readableLogFd = null;
    }
  }

  /**
   * Extract the last error message from the log
   */
  public getLastError(): string | null {
    try {
      if (!fs.existsSync(this.readableLogPath)) return null;
      const content = fs.readFileSync(this.readableLogPath, 'utf8');
      const lines = content.split('\n').filter(l => 
        l.includes('❌') || 
        l.includes('[ERROR]') || 
        l.includes('error:') || 
        l.includes('Fatal') ||
        l.includes('fail')
      );
      if (lines.length === 0) {
        const allLines = content.split('\n').filter(l => l.trim());
        return allLines.slice(-5).join('\n');
      }
      return lines[lines.length - 1]!.trim();
    } catch {
      return null;
    }
  }

  /**
   * Format duration for display
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor(ms / (1000 * 60 * 60));
    
    if (hours > 0) {
      return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds}s`;
    }
    return `${seconds}s`;
  }
}

/**
 * Create a log manager for a lane
 */
export function createLogManager(
  laneRunDir: string,
  laneName: string,
  config?: Partial<EnhancedLogConfig>,
  onParsedMessage?: (msg: ParsedMessage) => void,
  laneIndex?: number
): EnhancedLogManager {
  const session: LogSession = {
    id: `${laneName}-${Date.now().toString(36)}`,
    laneName,
    startTime: Date.now(),
    laneIndex: laneIndex ?? 0,
    taskIndex: 0,
  };
  
  return new EnhancedLogManager(laneRunDir, session, config, onParsedMessage);
}

/**
 * Read and parse JSON log file (legacy compatibility - returns empty array)
 */
export function readJsonLog(logPath: string): JsonLogEntry[] {
  return [];
}

/**
 * Export logs (legacy compatibility)
 */
export function exportLogs(
  laneRunDir: string,
  format: 'text' | 'json' | 'markdown' | 'html',
  outputPath?: string
): string {
  const readableLogPath = safeJoin(laneRunDir, 'terminal-readable.log');
  
  let output = '';
  
  if (fs.existsSync(readableLogPath)) {
    output = fs.readFileSync(readableLogPath, 'utf8');
  }
  
  if (outputPath) {
    fs.writeFileSync(outputPath, output, 'utf8');
  }
  
  return output;
}

// Legacy exports for backward compatibility
export class StreamingMessageParser {
  constructor(onMessage: (msg: ParsedMessage) => void) {}
  parseLine(line: string): void {}
  flush(): void {}
}

export class CleanLogTransform {
  constructor(config: EnhancedLogConfig, session: LogSession) {}
}

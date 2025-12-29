/**
 * Enhanced Logger - Simplified JSONL terminal output capture
 */

import * as fs from 'fs';
import * as path from 'path';
import { EnhancedLogConfig, ParsedMessage, LogSession } from '../types';
import { formatMessageForConsole, stripAnsi } from '../services/logging/formatter';
import { safeJoin } from './path';
import { getLaneLogPath } from '../services/logging/paths';

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
  maxFileSize: 50 * 1024 * 1024, // 50MB
  maxFiles: 5,
  writeJsonLog: true,
  timestampFormat: 'iso',
};

/**
 * Enhanced Log Manager - JSONL format only
 */
export class EnhancedLogManager {
  private config: EnhancedLogConfig;
  private session: LogSession;
  private logDir: string;
  
  private jsonlLogPath: string;
  private jsonlLogFd: number | null = null;
  
  private onParsedMessage?: (msg: ParsedMessage) => void;

  constructor(logDir: string, session: LogSession, config: Partial<EnhancedLogConfig> = {}, onParsedMessage?: (msg: ParsedMessage) => void) {
    this.config = { ...DEFAULT_LOG_CONFIG, ...config };
    this.session = session;
    this.logDir = logDir;
    this.onParsedMessage = onParsedMessage;
    
    // Ensure log directory exists
    fs.mkdirSync(logDir, { recursive: true });
    
    // Subprocess (lane) logs live in the lane run directory to avoid nesting with main logs.
    this.jsonlLogPath = getLaneLogPath(logDir, 'jsonl');
    
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
   * Get lane-task label like [1-1-refactor]
   */
  private getLaneTaskLabel(): string {
    const laneNum = (this.session.laneIndex ?? 0) + 1;
    const taskNum = (this.session.taskIndex ?? 0) + 1;
    const shortLaneName = this.session.laneName.substring(0, 8);
    return `${laneNum}-${taskNum}-${shortLaneName}`;
  }

  /**
   * Initialize log files and write session headers
   */
  private initLogFiles(): void {
    if (this.config.writeJsonLog) {
      // Ensure parent directory exists before opening file
      const logDir = path.dirname(this.jsonlLogPath);
      fs.mkdirSync(logDir, { recursive: true });
      
      this.rotateIfNeeded(this.jsonlLogPath);
      this.jsonlLogFd = fs.openSync(this.jsonlLogPath, 'a');
    }
    
    // Write session start to JSON log
    this.writeSessionStart();
  }

  /**
   * Write session start to JSON log
   */
  private writeSessionStart(): void {
    if (this.config.writeJsonLog) {
      this.writeToJsonLog({
        type: 'session',
        role: 'system',
        content: 'Session started',
        timestamp: this.session.startTime,
        metadata: {
          sessionId: this.session.id,
          laneName: this.session.laneName,
          taskName: this.session.taskName,
          model: this.session.model,
        }
      });
    }
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
   * Write to JSONL log
   */
  private writeToJsonLog(msg: ParsedMessage): void {
    if (this.jsonlLogFd === null) return;
    
    try {
      // Add lane and task context to JSON log
      const entry = {
        ...msg,
        lane: this.session.laneName,
        task: this.session.taskName,
        laneIndex: this.session.laneIndex,
        taskIndex: this.session.taskIndex,
        timestamp_iso: new Date(msg.timestamp).toISOString(),
      };
      
      fs.writeSync(this.jsonlLogFd, JSON.stringify(entry) + '\n');
    } catch {
      // Ignore write errors
    }
  }

  /**
   * Write a parsed message to the JSON log and console
   */
  public writeReadableMessage(msg: ParsedMessage): void {
    // Write to JSON log
    if (this.config.writeJsonLog) {
      this.writeToJsonLog(msg);
    }

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
          // parseJsonToMessage returned null - create fallback message for known JSON
          if (json.type) {
            // Skip noisy events that we don't want to show
            if (json.type === 'thinking' || json.type === 'call' || 
               (json.type === 'tool_call' && !json.tool_call)) {
              continue;
            }
            
            const fallbackMsg: ParsedMessage = {
              type: 'info',
              role: 'system',
              content: `[${json.type}] ${json.subtype || ''} ${JSON.stringify(json).substring(0, 150)}...`,
              timestamp: json.timestamp_ms || Date.now(),
            };
            this.writeReadableMessage(fallbackMsg);
            continue;
          }
        } catch {
          // Not valid JSON, fall through
        }
      }
      
      // Non-JSON line
      const cleanLine = stripAnsi(trimmed);
      if (cleanLine && !this.isNoiseLog(cleanLine)) {
        // Detect if this looks like Git output
        const isGit = this.isGitOutput(cleanLine);
        const type = isGit ? 'git' : 'stdout';
        
        // Output to console
        if (this.onParsedMessage) {
          this.onParsedMessage({
            type,
            role: 'system',
            content: trimmed,
            timestamp: Date.now(),
          });
        }

        // Write to JSON log
        if (this.config.writeJsonLog) {
          this.writeToJsonLog({
            type,
            role: 'system',
            content: cleanLine,
            timestamp: Date.now(),
          });
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
      case 'info':
      case 'warn':
      case 'error':
      case 'success':
      case 'debug':
      case 'progress':
      case 'system':
      case 'git':
        // Handle internal logger JSON or cursor-agent system events
        if (json.content && typeof json.content === 'string') {
          return {
            type: type as any,
            role: 'system',
            content: json.content,
            timestamp,
          };
        }
        if (type === 'system') {
          return {
            type: 'system',
            role: 'system',
            content: `Model: ${json.model || 'unknown'}, Mode: ${json.permissionMode || 'default'}`,
            timestamp,
          };
        }
        return null;

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
        // Fallback: show unknown JSON types with basic formatting
        if (type) {
          return {
            type: 'info',
            role: 'system',
            content: `[${type}] ${JSON.stringify(json).substring(0, 200)}`,
            timestamp,
          };
        }
        return null;
    }
  }

  /**
   * Write stderr data
   */
  public writeStderr(data: Buffer | string): void {
    const text = data.toString();
    const lines = text.split('\n');
    for (const line of lines) {
      const cleanLine = stripAnsi(line).trim();
      if (cleanLine && !this.isNoiseLog(cleanLine)) {
        const isError = this.isErrorLine(cleanLine);
        const isGit = this.isGitOutput(cleanLine);
        const type = isError ? 'stderr' : (isGit ? 'git' : 'stderr');
        
        // Write to JSON log
        if (this.config.writeJsonLog) {
          this.writeToJsonLog({
            type,
            role: 'system',
            content: cleanLine,
            timestamp: Date.now(),
            metadata: { isError, isGit }
          });
        }
        
        // Output to console
        if (this.onParsedMessage) {
          this.onParsedMessage({
            type,
            role: 'system',
            content: line.trim(),
            timestamp: Date.now(),
          });
        }
      }
    }
  }

  /**
   * Check if a line is likely Git output
   */
  private isGitOutput(text: string): boolean {
    const gitPatterns = [
      /^Running: git /i,
      /^git version /i,
      /^On branch /i,
      /^Your branch is /i,
      /^Changes to be committed:/i,
      /^Changes not staged for commit:/i,
      /^Untracked files:/i,
      /^\s*\((use "git |use --|use -)/i,
      /^\s*modified:\s+/i,
      /^\s*new file:\s+/i,
      /^\s*deleted:\s+/i,
      /^\s*renamed:\s+/i,
      /^Switched to branch /i,
      /^Switched to a new branch /i,
      /^Merge made by the /i,
      /^Everything up-to-date/i,
      /^Already up to date/i,
      /^branch '.*' set up to track remote branch '.*' from 'origin'/i,
      /^Counting objects: /i,
      /^Compressing objects: /i,
      /^Writing objects: /i,
      /^Total \d+ \(delta \d+\)/i,
      /^remote: Resolving deltas:/i,
      /^To .*\.git/i,
      /^[a-f0-9]{7,40}\.\.[a-f0-9]{7,40}\s+.*->\s+.*/i,
    ];
    
    return gitPatterns.some(p => p.test(text));
  }

  /**
   * Check if a line is actually an error message
   */
  private isErrorLine(text: string): boolean {
    const errorPatterns = [
      /^error:/i,
      /^fatal:/i,
      /^panic:/i,
      /\berror\b.*:/i,
      /\bfailed\b/i,
      /\bexception\b/i,
      /^ENOENT:/i,
      /^EACCES:/i,
      /^EPERM:/i,
      /^ERR!/i,
      /npm ERR!/i,
    ];
    
    return errorPatterns.some(p => p.test(text));
  }

  /**
   * Write a custom log entry
   */
  public log(level: 'info' | 'error' | 'debug', message: string, metadata?: Record<string, any>): void {
    const isGit = metadata?.context === 'git';
    const type = isGit ? 'git' : (level as any);

    if (this.config.writeJsonLog) {
      this.writeToJsonLog({
        type,
        role: 'system',
        content: message,
        timestamp: Date.now(),
        metadata
      });
    }

    if (this.onParsedMessage) {
      this.onParsedMessage({
        type,
        role: 'system',
        content: message,
        timestamp: Date.now(),
        metadata
      });
    }
  }

  /**
   * Add a section marker
   */
  public section(title: string): void {
    if (this.config.writeJsonLog) {
      this.writeToJsonLog({
        type: 'info',
        role: 'system',
        content: `--- ${title} ---`,
        timestamp: Date.now(),
        metadata: { isSection: true }
      });
    }
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
  public getLogPaths(): { jsonl: string; clean: string } {
    return {
      jsonl: this.jsonlLogPath,
      clean: this.jsonlLogPath, // Backward compatibility
    };
  }

  /**
   * Create file descriptors for process stdio redirection
   */
  public getFileDescriptors(): { stdout: number; stderr: number } {
    const fd = this.jsonlLogFd!;
    return { stdout: fd, stderr: fd };
  }

  /**
   * Close all log files
   */
  public close(): void {
    if (this.jsonlLogFd !== null) {
      try {
        if (this.config.writeJsonLog) {
          this.writeToJsonLog({
            type: 'session',
            role: 'system',
            content: 'Session ended',
            timestamp: Date.now(),
            metadata: {
              duration: Date.now() - this.session.startTime,
            }
          });
        }
        fs.fsyncSync(this.jsonlLogFd);
        fs.closeSync(this.jsonlLogFd);
      } catch {}
      this.jsonlLogFd = null;
    }
  }

  /**
   * Extract the last error message from the log
   */
  public getLastError(): string | null {
    try {
      if (!fs.existsSync(this.jsonlLogPath)) return null;
      const content = fs.readFileSync(this.jsonlLogPath, 'utf8');
      const lines = content.split('\n').filter(l => l.trim());
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i]!);
          if (entry.type === 'error' || entry.type === 'stderr' && entry.metadata?.isError) {
            return entry.content;
          }
        } catch {}
      }
      return null;
    } catch {
      return null;
    }
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
 * Read and parse JSON log file
 */
export function readJsonLog(logPath: string): any[] {
  try {
    if (!fs.existsSync(logPath)) return [];
    const content = fs.readFileSync(logPath, 'utf8');
    return content.split('\n')
      .filter(l => l.trim())
      .map(l => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Export logs
 */
export function exportLogs(
  laneRunDir: string,
  format: 'text' | 'json' | 'markdown' | 'html',
  outputPath?: string
): string {
  const logPath = getLaneLogPath(laneRunDir, 'jsonl');
  
  let output = '';
  if (fs.existsSync(logPath)) {
    if (format === 'json') {
      const logs = readJsonLog(logPath);
      output = JSON.stringify(logs, null, 2);
    } else {
      // Basic text conversion for other formats
      const logs = readJsonLog(logPath);
      output = logs.map(l => `[${l.timestamp_iso}] [${l.type}] ${l.content}`).join('\n');
    }
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

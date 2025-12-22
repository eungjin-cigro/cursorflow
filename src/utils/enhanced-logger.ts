/**
 * Enhanced Logger - Comprehensive terminal output capture and management
 * 
 * Features:
 * - ANSI escape sequence stripping for clean logs
 * - Automatic timestamps on each line
 * - Log rotation and size management
 * - Session headers with context
 * - Raw and clean log file options
 * - Structured JSON logs for programmatic access
 * - Streaming output support for real-time capture
 */

import * as fs from 'fs';
import * as path from 'path';
import { Transform, TransformCallback } from 'stream';
import { EnhancedLogConfig } from './types';
import { safeJoin } from './path';

// Re-export for backwards compatibility
export { EnhancedLogConfig } from './types';

export const DEFAULT_LOG_CONFIG: EnhancedLogConfig = {
  enabled: true,
  stripAnsi: true,
  addTimestamps: true,
  maxFileSize: 50 * 1024 * 1024, // 50MB
  maxFiles: 5,
  keepRawLogs: true,
  writeJsonLog: true,
  timestampFormat: 'iso',
};

/**
 * Streaming JSON Parser - Parses cursor-agent stream-json output
 * and combines tokens into readable messages
 */
export class StreamingMessageParser {
  private currentMessage: string = '';
  private currentRole: string = '';
  private messageStartTime: number = 0;
  private onMessage: (msg: ParsedMessage) => void;
  
  constructor(onMessage: (msg: ParsedMessage) => void) {
    this.onMessage = onMessage;
  }
  
  /**
   * Parse a line of JSON output from cursor-agent
   */
  parseLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) return;
    
    try {
      const json = JSON.parse(trimmed);
      this.handleJsonMessage(json);
    } catch {
      // Not valid JSON, ignore
    }
  }
  
  private handleJsonMessage(json: any): void {
    const type = json.type;
    
    switch (type) {
      case 'system':
        // System init message
        this.emitMessage({
          type: 'system',
          role: 'system',
          content: `[System] Model: ${json.model || 'unknown'}, Mode: ${json.permissionMode || 'default'}`,
          timestamp: json.timestamp_ms || Date.now(),
        });
        break;
        
      case 'user':
        // User message - emit as complete message
        if (json.message?.content) {
          const textContent = json.message.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('');
          
          this.emitMessage({
            type: 'user',
            role: 'user',
            content: textContent,
            timestamp: json.timestamp_ms || Date.now(),
          });
        }
        break;
        
      case 'assistant':
        // Streaming assistant message - accumulate tokens
        if (json.message?.content) {
          const textContent = json.message.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('');
          
          // Check if this is a new message or continuation
          if (this.currentRole !== 'assistant') {
            // Flush previous message if any
            this.flush();
            this.currentRole = 'assistant';
            this.messageStartTime = json.timestamp_ms || Date.now();
          }
          
          this.currentMessage += textContent;
        }
        break;
        
      case 'tool_call':
        // Tool call - emit as formatted message
        if (json.subtype === 'started' && json.tool_call) {
          const toolName = Object.keys(json.tool_call)[0] || 'unknown';
          const toolArgs = json.tool_call[toolName]?.args || {};
          
          this.flush(); // Flush any pending assistant message
          
          this.emitMessage({
            type: 'tool',
            role: 'tool',
            content: `[Tool: ${toolName}] ${JSON.stringify(toolArgs)}`,
            timestamp: json.timestamp_ms || Date.now(),
            metadata: { callId: json.call_id, toolName },
          });
        } else if (json.subtype === 'completed' && json.tool_call) {
          const toolName = Object.keys(json.tool_call)[0] || 'unknown';
          const result = json.tool_call[toolName]?.result;
          
          if (result?.success) {
            // Truncate large results
            const content = result.success.content || '';
            const truncated = content.length > 500 
              ? content.substring(0, 500) + '... (truncated)'
              : content;
            
            this.emitMessage({
              type: 'tool_result',
              role: 'tool',
              content: `[Tool Result: ${toolName}] ${truncated}`,
              timestamp: json.timestamp_ms || Date.now(),
              metadata: { callId: json.call_id, toolName, lines: result.success.totalLines },
            });
          }
        }
        break;
        
      case 'result':
        // Final result - flush any pending and emit result
        this.flush();
        
        this.emitMessage({
          type: 'result',
          role: 'assistant',
          content: json.result || '',
          timestamp: json.timestamp_ms || Date.now(),
          metadata: {
            duration_ms: json.duration_ms,
            is_error: json.is_error,
            subtype: json.subtype,
          },
        });
        break;
        
      case 'thinking':
        // Thinking message (Claude 3.7+ etc.)
        if (json.subtype === 'delta' && json.text) {
          // Check if this is a new message or continuation
          if (this.currentRole !== 'thinking') {
            // Flush previous message if any
            this.flush();
            this.currentRole = 'thinking';
            this.messageStartTime = json.timestamp_ms || Date.now();
          }
          this.currentMessage += json.text;
        } else if (json.subtype === 'completed') {
          // Thinking completed - flush immediately
          this.flush();
        }
        break;
    }
  }
  
  /**
   * Flush accumulated message
   */
  flush(): void {
    if (this.currentMessage && this.currentRole) {
      this.emitMessage({
        type: this.currentRole as any,
        role: this.currentRole,
        content: this.currentMessage,
        timestamp: this.messageStartTime,
      });
    }
    this.currentMessage = '';
    this.currentRole = '';
    this.messageStartTime = 0;
  }
  
  private emitMessage(msg: ParsedMessage): void {
    if (msg.content.trim()) {
      this.onMessage(msg);
    }
  }
}

export interface ParsedMessage {
  type: 'system' | 'user' | 'assistant' | 'tool' | 'tool_result' | 'result' | 'thinking';
  role: string;
  content: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

/**
 * ANSI escape sequence regex pattern
 * Matches:
 * - CSI sequences (colors, cursor movement, etc.)
 * - OSC sequences (terminal titles, etc.)
 * - Single-character escape codes
 */
const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

/**
 * Extended ANSI regex for more complete stripping
 */
const EXTENDED_ANSI_REGEX = /(?:\x1B[@-Z\\-_]|\x1B\[[0-?]*[ -/]*[@-~]|\x1B\][^\x07]*(?:\x07|\x1B\\)|\x1B[PX^_][^\x1B]*\x1B\\|\x1B.)/g;

/**
 * Strip ANSI escape sequences from text
 */
export function stripAnsi(text: string): string {
  return text
    .replace(EXTENDED_ANSI_REGEX, '')
    .replace(ANSI_REGEX, '')
    // Also remove carriage returns that overwrite lines (progress bars, etc.)
    .replace(/\r[^\n]/g, '\n')
    // Clean up any remaining control characters except newlines/tabs
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Format timestamp based on format preference
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
 * JSON log entry structure
 */
export interface JsonLogEntry {
  timestamp: string;
  level: 'stdout' | 'stderr' | 'info' | 'error' | 'debug' | 'session';
  source?: string;
  task?: string;
  lane?: string;
  message: string;
  raw?: string;
  metadata?: Record<string, any>;
}

/**
 * Session context for logging
 */
export interface LogSession {
  id: string;
  laneName: string;
  taskName?: string;
  model?: string;
  startTime: number;
  metadata?: Record<string, any>;
}

/**
 * Regex to detect if a line already has an ISO timestamp at the start
 */
const EXISTING_TIMESTAMP_REGEX = /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/**
 * Check if a line already has a timestamp
 */
function hasExistingTimestamp(line: string): boolean {
  return EXISTING_TIMESTAMP_REGEX.test(line.trim());
}

/**
 * Transform stream that strips ANSI and adds timestamps
 */
export class CleanLogTransform extends Transform {
  private config: EnhancedLogConfig;
  private session: LogSession;
  private buffer: string = '';

  constructor(config: EnhancedLogConfig, session: LogSession) {
    super({ encoding: 'utf8' });
    this.config = config;
    this.session = session;
  }

  _transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback): void {
    let text = chunk.toString();
    
    // Buffer partial lines
    this.buffer += text;
    const lines = this.buffer.split('\n');
    
    // Keep the last incomplete line in buffer
    this.buffer = lines.pop() || '';
    
    for (const line of lines) {
      let processed = line;
      
      // Strip ANSI if enabled
      if (this.config.stripAnsi) {
        processed = stripAnsi(processed);
      }
      
      // Add timestamp if enabled AND line doesn't already have one
      if (this.config.addTimestamps && processed.trim() && !hasExistingTimestamp(processed)) {
        const ts = formatTimestamp(this.config.timestampFormat, this.session.startTime);
        processed = `[${ts}] ${processed}`;
      }
      
      this.push(processed + '\n');
    }
    
    callback();
  }

  _flush(callback: TransformCallback): void {
    // Process any remaining buffered content
    if (this.buffer.trim()) {
      let processed = this.buffer;
      
      if (this.config.stripAnsi) {
        processed = stripAnsi(processed);
      }
      
      if (this.config.addTimestamps && processed.trim() && !hasExistingTimestamp(processed)) {
        const ts = formatTimestamp(this.config.timestampFormat, this.session.startTime);
        processed = `[${ts}] ${processed}`;
      }
      
      this.push(processed + '\n');
    }
    
    callback();
  }
}

/**
 * Enhanced Log Manager - Manages log files with rotation and multiple outputs
 */
export class EnhancedLogManager {
  private config: EnhancedLogConfig;
  private session: LogSession;
  private logDir: string;
  
  private cleanLogPath: string;
  private rawLogPath: string;
  private jsonLogPath: string;
  private readableLogPath: string;
  
  private cleanLogFd: number | null = null;
  private rawLogFd: number | null = null;
  private jsonLogFd: number | null = null;
  private readableLogFd: number | null = null;
  
  private cleanLogSize: number = 0;
  private rawLogSize: number = 0;
  
  private cleanTransform: CleanLogTransform | null = null;
  private streamingParser: StreamingMessageParser | null = null;
  private lineBuffer: string = '';
  private onParsedMessage?: (msg: ParsedMessage) => void;

  constructor(logDir: string, session: LogSession, config: Partial<EnhancedLogConfig> = {}, onParsedMessage?: (msg: ParsedMessage) => void) {
    this.config = { ...DEFAULT_LOG_CONFIG, ...config };
    this.session = session;
    this.logDir = logDir;
    this.onParsedMessage = onParsedMessage;
    
    // Ensure log directory exists
    fs.mkdirSync(logDir, { recursive: true });
    
    // Set up log file paths
    this.cleanLogPath = safeJoin(logDir, 'terminal.log');
    this.rawLogPath = safeJoin(logDir, 'terminal-raw.log');
    this.jsonLogPath = safeJoin(logDir, 'terminal.jsonl');
    this.readableLogPath = safeJoin(logDir, 'terminal-readable.log');
    
    // Initialize log files
    this.initLogFiles();
  }

  /**
   * Initialize log files and write session headers
   */
  private initLogFiles(): void {
    // Check and rotate if necessary
    this.rotateIfNeeded(this.cleanLogPath, 'clean');
    if (this.config.keepRawLogs) {
      this.rotateIfNeeded(this.rawLogPath, 'raw');
    }
    
    // Open file descriptors
    this.cleanLogFd = fs.openSync(this.cleanLogPath, 'a');
    
    if (this.config.keepRawLogs) {
      this.rawLogFd = fs.openSync(this.rawLogPath, 'a');
    }
    
    if (this.config.writeJsonLog) {
      this.jsonLogFd = fs.openSync(this.jsonLogPath, 'a');
    }
    
    // Open readable log file (for parsed streaming output)
    this.readableLogFd = fs.openSync(this.readableLogPath, 'a');
    
    // Get initial file sizes
    try {
      this.cleanLogSize = fs.statSync(this.cleanLogPath).size;
      if (this.config.keepRawLogs) {
        this.rawLogSize = fs.statSync(this.rawLogPath).size;
      }
    } catch {
      this.cleanLogSize = 0;
      this.rawLogSize = 0;
    }
    
    // Write session header
    this.writeSessionHeader();
    
    // Create transform stream
    this.cleanTransform = new CleanLogTransform(this.config, this.session);
    this.cleanTransform.on('data', (data: string) => {
      this.writeToCleanLog(data);
    });
    
    // Create streaming parser for readable log
    this.streamingParser = new StreamingMessageParser((msg) => {
      this.writeReadableMessage(msg);
      if (this.onParsedMessage) {
        this.onParsedMessage(msg);
      }
    });
  }
  
  /**
   * Write a parsed message to the readable log
   */
  private writeReadableMessage(msg: ParsedMessage): void {
    if (this.readableLogFd === null) return;
    
    const ts = new Date(msg.timestamp).toISOString();
    let formatted: string;
    
    switch (msg.type) {
      case 'system':
        formatted = `[${ts}] ⚙️ SYSTEM: ${msg.content}\n`;
        break;
        
      case 'user':
      case 'assistant':
      case 'result':
        // Format with brackets and line (compact)
        const isUser = msg.type === 'user';
        const isResult = msg.type === 'result';
        const headerText = isUser ? '🧑 USER' : isResult ? '🤖 ASSISTANT (Final)' : '🤖 ASSISTANT';
        const duration = msg.metadata?.duration_ms 
          ? ` (${Math.round(msg.metadata.duration_ms / 1000)}s)`
          : '';
        
        const label = `[ ${headerText}${duration} ] `;
        const totalWidth = 80;
        const topBorder = `┌─${label}${'─'.repeat(Math.max(0, totalWidth - label.length - 2))}`;
        const bottomBorder = `└─${'─'.repeat(totalWidth - 2)}`;

        const lines = msg.content.split('\n');
        formatted = `[${ts}] ${topBorder}\n`;
        for (const line of lines) {
          formatted += `[${ts}] │ ${line}\n`;
        }
        formatted += `[${ts}] ${bottomBorder}\n`;
        break;
        
      case 'tool':
        formatted = `[${ts}] 🔧 TOOL: ${msg.content}\n`;
        break;
        
      case 'tool_result':
        const toolResultLines = msg.metadata?.lines ? ` (${msg.metadata.lines} lines)` : '';
        formatted = `[${ts}] 📄 RESL: ${msg.metadata?.toolName || 'Tool'}${toolResultLines}\n`;
        break;
        
      case 'thinking':
        // Format thinking block
        const thinkLabel = `[ 🤔 THINKING ] `;
        const thinkWidth = 80;
        const thinkTop = `┌─${thinkLabel}${'─'.repeat(Math.max(0, thinkWidth - thinkLabel.length - 2))}`;
        const thinkBottom = `└─${'─'.repeat(thinkWidth - 2)}`;

        const thinkLines = msg.content.trim().split('\n');
        formatted = `[${ts}] ${thinkTop}\n`;
        for (const line of thinkLines) {
          formatted += `[${ts}] │ ${line}\n`;
        }
        formatted += `[${ts}] ${thinkBottom}\n`;
        break;
        
      default:
        formatted = `[${ts}] ${msg.content}\n`;
    }
    
    try {
      fs.writeSync(this.readableLogFd, formatted);
    } catch {
      // Ignore write errors
    }
  }
  
  /**
   * Indent text with a prefix
   */
  private indentText(text: string, prefix: string): string {
    return text.split('\n').map(line => prefix + line).join('\n');
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
    
    this.writeToCleanLog(header);
    
    if (this.config.keepRawLogs && this.rawLogFd !== null) {
      fs.writeSync(this.rawLogFd, header);
    }
    
    // Write JSON session entry
    this.writeJsonEntry({
      timestamp: new Date(this.session.startTime).toISOString(),
      level: 'session',
      source: 'system',
      lane: this.session.laneName,
      task: this.session.taskName,
      message: 'Session started',
      metadata: {
        sessionId: this.session.id,
        model: this.session.model,
        ...this.session.metadata,
      },
    });
  }

  /**
   * Rotate log file if it exceeds max size
   */
  private rotateIfNeeded(logPath: string, type: 'clean' | 'raw'): void {
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
   * Write to clean log with size tracking
   */
  private writeToCleanLog(data: string): void {
    if (this.cleanLogFd === null) return;
    
    const buffer = Buffer.from(data);
    fs.writeSync(this.cleanLogFd, buffer);
    this.cleanLogSize += buffer.length;
    
    // Check if rotation needed
    if (this.cleanLogSize >= this.config.maxFileSize) {
      fs.closeSync(this.cleanLogFd);
      this.rotateLog(this.cleanLogPath);
      this.cleanLogFd = fs.openSync(this.cleanLogPath, 'a');
      this.cleanLogSize = 0;
    }
  }

  /**
   * Write to raw log with size tracking
   */
  private writeToRawLog(data: string): void {
    if (this.rawLogFd === null) return;
    
    const buffer = Buffer.from(data);
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
   * Write a JSON log entry
   */
  private writeJsonEntry(entry: JsonLogEntry): void {
    if (this.jsonLogFd === null) return;
    
    const line = JSON.stringify(entry) + '\n';
    fs.writeSync(this.jsonLogFd, line);
  }

  /**
   * Write stdout data
   */
  public writeStdout(data: Buffer | string): void {
    const text = data.toString();
    
    // Write raw log
    if (this.config.keepRawLogs) {
      this.writeToRawLog(text);
    }
    
    // Process through transform for clean log
    if (this.cleanTransform) {
      this.cleanTransform.write(data);
    }
    
    // Process lines for readable log and JSON entries
    this.lineBuffer += text;
    const lines = this.lineBuffer.split('\n');
    this.lineBuffer = lines.pop() || '';
    
    for (const line of lines) {
      const cleanLine = stripAnsi(line).trim();
      if (!cleanLine) continue;

      // Handle streaming JSON messages (for boxes, etc. in readable log)
      if (cleanLine.startsWith('{')) {
        if (this.streamingParser) {
          this.streamingParser.parseLine(cleanLine);
        }

        // Special handling for terminal.jsonl entries for AI messages
        if (this.config.writeJsonLog) {
          try {
            const json = JSON.parse(cleanLine);
            let displayMsg = cleanLine;
            let metadata = { ...json };

            // Extract cleaner text for significant AI message types
            if ((json.type === 'thinking' || json.type === 'thought') && (json.text || json.thought)) {
              displayMsg = json.text || json.thought;
              // Clean up any double newlines at the end of deltas
              displayMsg = displayMsg.replace(/\n+$/, '\n');
            } else if (json.type === 'assistant' && json.message?.content) {
              displayMsg = json.message.content
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text)
                .join('');
            } else if (json.type === 'user' && json.message?.content) {
              displayMsg = json.message.content
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text)
                .join('');
            } else if (json.type === 'tool_call' && json.subtype === 'started') {
              const toolName = Object.keys(json.tool_call)[0] || 'unknown';
              const args = json.tool_call[toolName]?.args || {};
              displayMsg = `🔧 CALL: ${toolName}(${JSON.stringify(args)})`;
            } else if (json.type === 'tool_call' && json.subtype === 'completed') {
              const toolName = Object.keys(json.tool_call)[0] || 'unknown';
              displayMsg = `📄 RESL: ${toolName}`;
            } else if (json.type === 'result') {
              displayMsg = json.result || 'Task completed';
            }

            this.writeJsonEntry({
              timestamp: new Date().toISOString(),
              level: 'stdout',
              lane: this.session.laneName,
              task: this.session.taskName,
              message: displayMsg.substring(0, 2000), // Larger limit for AI text
              metadata,
            });
            continue; // Already logged this JSON line
          } catch {
            // Not valid JSON or error, fall through to regular logging
          }
        }
      }

      // Also include significant info/status lines in readable log (compact)
      if (this.readableLogFd !== null) {
        // Look for log lines: [ISO_DATE] [LEVEL] ...
        if (!this.isNoiseLog(cleanLine) && /\[\d{4}-\d{2}-\d{2}T/.test(cleanLine)) {
          try {
            // Check if it has a level marker
            if (/\[(INFO|WARN|ERROR|SUCCESS|DEBUG)\]/.test(cleanLine)) {
              // Special formatting for summary
              if (cleanLine.includes('Final Workspace Summary')) {
                const tsMatch = cleanLine.match(/\[(\d{4}-\d{2}-\d{2}T[^\]]+)\]/);
                const ts = tsMatch ? tsMatch[1] : new Date().toISOString();
                fs.writeSync(this.readableLogFd, `[${ts}] 📊 SUMMARY: ${cleanLine.split(']').slice(2).join(']').trim()}\n`);
              } else {
                fs.writeSync(this.readableLogFd, `${cleanLine}\n`);
              }
            }
          } catch {}
        }
      }
      
      // Write regular non-JSON lines to terminal.jsonl
      if (this.config.writeJsonLog && !this.isNoiseLog(cleanLine)) {
        this.writeJsonEntry({
          timestamp: new Date().toISOString(),
          level: 'stdout',
          lane: this.session.laneName,
          task: this.session.taskName,
          message: cleanLine.substring(0, 1000),
          raw: this.config.keepRawLogs ? undefined : line.substring(0, 1000),
        });
      }
    }
  }
  
  /**
   * Parse streaming JSON data for readable log - legacy, integrated into writeStdout
   */
  private parseStreamingData(text: string): void {
    // Legacy method, no longer used but kept for internal references if any
  }

  /**
   * Write stderr data
   */
  public writeStderr(data: Buffer | string): void {
    const text = data.toString();
    
    // Write raw log
    if (this.config.keepRawLogs) {
      this.writeToRawLog(text);
    }
    
    // Process through transform for clean log
    if (this.cleanTransform) {
      this.cleanTransform.write(data);
    }

    // Also include error lines in readable log (compact)
    if (this.readableLogFd !== null) {
      const lines = text.split('\n');
      for (const line of lines) {
        const cleanLine = stripAnsi(line).trim();
        if (cleanLine && !this.isNoiseLog(cleanLine)) {
          try {
            const ts = new Date().toISOString();
            fs.writeSync(this.readableLogFd, `[${ts}] ❌ STDERR: ${cleanLine}\n`);
          } catch {}
        }
      }
    }
    
    // Write JSON entry
    if (this.config.writeJsonLog) {
      const cleanText = stripAnsi(text).trim();
      if (cleanText) {
        this.writeJsonEntry({
          timestamp: new Date().toISOString(),
          level: 'stderr',
          lane: this.session.laneName,
          task: this.session.taskName,
          message: cleanText.substring(0, 1000),
        });
      }
    }
  }

  /**
   * Write a custom log entry
   */
  public log(level: 'info' | 'error' | 'debug', message: string, metadata?: Record<string, any>): void {
    const ts = formatTimestamp(this.config.timestampFormat, this.session.startTime);
    const prefix = level.toUpperCase().padEnd(5);
    
    const line = `[${ts}] [${prefix}] ${message}\n`;
    this.writeToCleanLog(line);
    
    if (this.config.keepRawLogs) {
      this.writeToRawLog(line);
    }
    
    // Write to readable log (compact)
    if (this.readableLogFd !== null) {
      const typeLabel = level === 'error' ? '❌ ERROR' : level === 'info' ? 'ℹ️ INFO' : '🔍 DEBUG';
      const formatted = `${new Date().toISOString()} ${typeLabel}: ${message}\n`;
      try {
        fs.writeSync(this.readableLogFd, formatted);
      } catch {}
    }

    if (this.config.writeJsonLog) {
      this.writeJsonEntry({
        timestamp: new Date().toISOString(),
        level,
        lane: this.session.laneName,
        task: this.session.taskName,
        message,
        metadata,
      });
    }
  }

  /**
   * Add a section marker
   */
  public section(title: string): void {
    const divider = '═'.repeat(78);
    const line = `\n${divider}\n  ${title}\n${divider}\n`;
    
    this.writeToCleanLog(line);
    if (this.config.keepRawLogs) {
      this.writeToRawLog(line);
    }

    // Write to readable log (compact)
    if (this.readableLogFd !== null) {
      const ts = new Date().toISOString();
      const formatted = `[${ts}] ━━━ ${title} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      try {
        fs.writeSync(this.readableLogFd, formatted);
      } catch {}
    }
  }

  /**
   * Update task context
   */
  public setTask(taskName: string, model?: string): void {
    this.session.taskName = taskName;
    if (model) {
      this.session.model = model;
    }
    
    this.section(`Task: ${taskName}${model ? ` (Model: ${model})` : ''}`);
    
    if (this.config.writeJsonLog) {
      this.writeJsonEntry({
        timestamp: new Date().toISOString(),
        level: 'info',
        source: 'system',
        lane: this.session.laneName,
        task: taskName,
        message: `Task started: ${taskName}`,
        metadata: { model },
      });
    }
  }

  /**
   * Check if a log line is noise (progress bars, spinners, etc.)
   */
  private isNoiseLog(text: string): boolean {
    // Skip empty or whitespace-only
    if (!text.trim()) return true;
    
    // Skip common progress/spinner patterns
    const noisePatterns = [
      /^[\s│├└─┌┐┘┴┬┤]+$/, // Box drawing only (removed duplicate ├)
      /^[.\s]+$/, // Dots only
      /^[=>\s-]+$/, // Progress bar characters
      /^\d+%$/, // Percentage only
      /^⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/, // Spinner characters
    ];
    
    return noisePatterns.some(p => p.test(text));
  }

  /**
   * Get paths to all log files
   */
  public getLogPaths(): { clean: string; raw?: string; json?: string; readable: string } {
    return {
      clean: this.cleanLogPath,
      raw: this.config.keepRawLogs ? this.rawLogPath : undefined,
      json: this.config.writeJsonLog ? this.jsonLogPath : undefined,
      readable: this.readableLogPath,
    };
  }

  /**
   * Create file descriptors for process stdio redirection
   */
  public getFileDescriptors(): { stdout: number; stderr: number } {
    // For process spawning, use the raw log fd if available, otherwise clean
    const fd = this.rawLogFd !== null ? this.rawLogFd : this.cleanLogFd!;
    return { stdout: fd, stderr: fd };
  }

  /**
   * Close all log files
   */
  public close(): void {
    // Flush transform stream
    if (this.cleanTransform) {
      this.cleanTransform.end();
    }
    
    // Flush streaming parser
    if (this.streamingParser) {
      // Parse any remaining buffered data
      if (this.lineBuffer.trim()) {
        this.streamingParser.parseLine(this.lineBuffer);
      }
      this.streamingParser.flush();
    }
    
    // Write session end marker
    const endMarker = `
╔══════════════════════════════════════════════════════════════════════════════╗
║  Session Ended: ${new Date().toISOString().padEnd(60)}║
║  Duration: ${this.formatDuration(Date.now() - this.session.startTime).padEnd(65)}║
╚══════════════════════════════════════════════════════════════════════════════╝

`;
    
    if (this.cleanLogFd !== null) {
      fs.writeSync(this.cleanLogFd, endMarker);
      fs.closeSync(this.cleanLogFd);
      this.cleanLogFd = null;
    }
    
    if (this.rawLogFd !== null) {
      fs.writeSync(this.rawLogFd, endMarker);
      fs.closeSync(this.rawLogFd);
      this.rawLogFd = null;
    }
    
    if (this.jsonLogFd !== null) {
      this.writeJsonEntry({
        timestamp: new Date().toISOString(),
        level: 'session',
        source: 'system',
        lane: this.session.laneName,
        message: 'Session ended',
        metadata: {
          sessionId: this.session.id,
          duration: Date.now() - this.session.startTime,
        },
      });
      fs.closeSync(this.jsonLogFd);
      this.jsonLogFd = null;
    }
    
    // Close readable log
    if (this.readableLogFd !== null) {
      fs.writeSync(this.readableLogFd, endMarker);
      fs.closeSync(this.readableLogFd);
      this.readableLogFd = null;
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
  onParsedMessage?: (msg: ParsedMessage) => void
): EnhancedLogManager {
  const session: LogSession = {
    id: `${laneName}-${Date.now().toString(36)}`,
    laneName,
    startTime: Date.now(),
  };
  
  return new EnhancedLogManager(laneRunDir, session, config, onParsedMessage);
}

/**
 * Read and parse JSON log file
 */
export function readJsonLog(logPath: string): JsonLogEntry[] {
  if (!fs.existsSync(logPath)) {
    return [];
  }
  
  try {
    const content = fs.readFileSync(logPath, 'utf8');
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try {
          return JSON.parse(line) as JsonLogEntry;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is JsonLogEntry => entry !== null);
  } catch {
    return [];
  }
}

/**
 * Export logs to various formats
 */
export function exportLogs(
  laneRunDir: string,
  format: 'text' | 'json' | 'markdown' | 'html',
  outputPath?: string
): string {
  const cleanLogPath = safeJoin(laneRunDir, 'terminal.log');
  const jsonLogPath = safeJoin(laneRunDir, 'terminal.jsonl');
  
  let output = '';
  
  switch (format) {
    case 'text':
      if (fs.existsSync(cleanLogPath)) {
        output = fs.readFileSync(cleanLogPath, 'utf8');
      }
      break;
      
    case 'json':
      const entries = readJsonLog(jsonLogPath);
      output = JSON.stringify(entries, null, 2);
      break;
      
    case 'markdown':
      output = exportToMarkdown(jsonLogPath, cleanLogPath);
      break;
      
    case 'html':
      output = exportToHtml(jsonLogPath, cleanLogPath);
      break;
  }
  
  if (outputPath) {
    fs.writeFileSync(outputPath, output, 'utf8');
  }
  
  return output;
}

/**
 * Export logs to Markdown format
 */
function exportToMarkdown(jsonLogPath: string, cleanLogPath: string): string {
  const entries = readJsonLog(jsonLogPath);
  
  let md = '# CursorFlow Session Log\n\n';
  
  // Find session info
  const sessionStart = entries.find(e => e.level === 'session' && e.message === 'Session started');
  if (sessionStart?.metadata) {
    md += '## Session Info\n\n';
    md += `- **Session ID**: ${sessionStart.metadata.sessionId}\n`;
    md += `- **Lane**: ${sessionStart.lane}\n`;
    md += `- **Model**: ${sessionStart.metadata.model || 'default'}\n`;
    md += `- **Started**: ${sessionStart.timestamp}\n\n`;
  }
  
  md += '## Log Entries\n\n';
  
  // Group by task
  const byTask = new Map<string, JsonLogEntry[]>();
  for (const entry of entries) {
    const task = entry.task || '(no task)';
    if (!byTask.has(task)) {
      byTask.set(task, []);
    }
    byTask.get(task)!.push(entry);
  }
  
  for (const [task, taskEntries] of byTask) {
    md += `### Task: ${task}\n\n`;
    md += '```\n';
    for (const entry of taskEntries) {
      if (entry.level !== 'session') {
        md += `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}\n`;
      }
    }
    md += '```\n\n';
  }
  
  return md;
}

/**
 * Export logs to HTML format
 */
function exportToHtml(jsonLogPath: string, cleanLogPath: string): string {
  const entries = readJsonLog(jsonLogPath);
  
  let html = `<!DOCTYPE html>
<html>
<head>
  <title>CursorFlow Session Log</title>
  <style>
    body { font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace; margin: 20px; background: #1e1e1e; color: #d4d4d4; }
    h1, h2 { color: #569cd6; }
    .entry { padding: 4px 8px; margin: 2px 0; border-radius: 4px; }
    .entry.stdout { background: #252526; }
    .entry.stderr { background: #3c1f1f; color: #f48771; }
    .entry.info { background: #1e3a5f; color: #9cdcfe; }
    .entry.error { background: #5f1e1e; color: #f48771; }
    .entry.session { background: #1e4620; color: #6a9955; }
    .timestamp { color: #808080; font-size: 0.9em; }
    .level { font-weight: bold; text-transform: uppercase; }
    .task { color: #dcdcaa; }
    pre { white-space: pre-wrap; word-wrap: break-word; }
  </style>
</head>
<body>
  <h1>CursorFlow Session Log</h1>
`;
  
  for (const entry of entries) {
    html += `  <div class="entry ${entry.level}">
    <span class="timestamp">${entry.timestamp}</span>
    <span class="level">[${entry.level}]</span>
    ${entry.task ? `<span class="task">[${entry.task}]</span>` : ''}
    <pre>${escapeHtml(entry.message)}</pre>
  </div>\n`;
  }
  
  html += '</body></html>';
  return html;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}


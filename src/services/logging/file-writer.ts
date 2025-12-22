/**
 * Log File Writer - Write logs to files with rotation
 * 
 * Manages log file writing with support for multiple formats.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Transform, TransformCallback } from 'stream';
import { LogSession, JsonLogEntry, ParsedMessage } from '../../types/logging';
import { EnhancedLogConfig } from '../../types/config';
import { StreamingMessageParser } from './parser';
import { stripAnsi, formatTimestampISO } from './formatter';

export const DEFAULT_LOG_CONFIG: EnhancedLogConfig = {
  enabled: true,
  stripAnsi: true,
  addTimestamps: true,
  maxFileSize: 50 * 1024 * 1024,
  maxFiles: 5,
  keepRawLogs: true,
  writeJsonLog: true,
  timestampFormat: 'iso',
};

/**
 * Transform stream for clean log output
 */
export class CleanLogTransform extends Transform {
  private config: EnhancedLogConfig;
  private session: LogSession;
  private buffer = '';

  constructor(config: EnhancedLogConfig, session: LogSession) {
    super({ encoding: 'utf8' });
    this.config = config;
    this.session = session;
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    let text = chunk.toString();
    this.buffer += text;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      let processed = line;
      if (this.config.stripAnsi) processed = stripAnsi(processed);
      if (this.config.addTimestamps && processed.trim() && !this.hasTimestamp(processed)) {
        const ts = formatTimestampISO(this.config.timestampFormat, this.session.startTime);
        processed = `[${ts}] ${processed}`;
      }
      this.push(processed + '\n');
    }
    callback();
  }

  _flush(callback: TransformCallback): void {
    if (this.buffer.trim()) {
      let processed = this.buffer;
      if (this.config.stripAnsi) processed = stripAnsi(processed);
      if (this.config.addTimestamps && processed.trim() && !this.hasTimestamp(processed)) {
        const ts = formatTimestampISO(this.config.timestampFormat, this.session.startTime);
        processed = `[${ts}] ${processed}`;
      }
      this.push(processed + '\n');
    }
    callback();
  }

  private hasTimestamp(line: string): boolean {
    return /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(line.trim());
  }
}

/**
 * Enhanced Log Manager - Handles all log file operations
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

  private cleanLogSize = 0;
  private rawLogSize = 0;

  private cleanTransform: CleanLogTransform | null = null;
  private streamingParser: StreamingMessageParser | null = null;
  private lineBuffer = '';
  private onParsedMessage?: (msg: ParsedMessage) => void;

  constructor(
    logDir: string,
    session: LogSession,
    config: Partial<EnhancedLogConfig> = {},
    onParsedMessage?: (msg: ParsedMessage) => void
  ) {
    this.config = { ...DEFAULT_LOG_CONFIG, ...config };
    this.session = session;
    this.logDir = logDir;
    this.onParsedMessage = onParsedMessage;

    fs.mkdirSync(logDir, { recursive: true });

    this.cleanLogPath = path.join(logDir, 'terminal.log');
    this.rawLogPath = path.join(logDir, 'terminal-raw.log');
    this.jsonLogPath = path.join(logDir, 'terminal.jsonl');
    this.readableLogPath = path.join(logDir, 'terminal-readable.log');

    this.initLogFiles();
  }

  private initLogFiles(): void {
    this.rotateIfNeeded(this.cleanLogPath);
    if (this.config.keepRawLogs) this.rotateIfNeeded(this.rawLogPath);

    this.cleanLogFd = fs.openSync(this.cleanLogPath, 'a');
    if (this.config.keepRawLogs) this.rawLogFd = fs.openSync(this.rawLogPath, 'a');
    if (this.config.writeJsonLog) this.jsonLogFd = fs.openSync(this.jsonLogPath, 'a');
    this.readableLogFd = fs.openSync(this.readableLogPath, 'a');

    try {
      this.cleanLogSize = fs.statSync(this.cleanLogPath).size;
      if (this.config.keepRawLogs) this.rawLogSize = fs.statSync(this.rawLogPath).size;
    } catch {
      this.cleanLogSize = 0;
      this.rawLogSize = 0;
    }

    this.writeSessionHeader();

    this.cleanTransform = new CleanLogTransform(this.config, this.session);
    this.cleanTransform.on('data', (data: string) => this.writeToCleanLog(data));

    this.streamingParser = new StreamingMessageParser(msg => {
      this.writeReadableMessage(msg);
      if (this.onParsedMessage) this.onParsedMessage(msg);
    });
  }

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

    this.writeJsonEntry({
      timestamp: new Date(this.session.startTime).toISOString(),
      level: 'session',
      source: 'system',
      lane: this.session.laneName,
      task: this.session.taskName,
      message: 'Session started',
      metadata: { sessionId: this.session.id, model: this.session.model, ...this.session.metadata },
    });
  }

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
      case 'result': {
        const isUser = msg.type === 'user';
        const isResult = msg.type === 'result';
        const headerText = isUser ? '🧑 USER' : isResult ? '🤖 ASSISTANT (Final)' : '🤖 ASSISTANT';
        const duration = msg.metadata?.duration_ms ? ` (${Math.round(msg.metadata.duration_ms / 1000)}s)` : '';
        const label = `[ ${headerText}${duration} ] `;
        const totalWidth = 80;
        const topBorder = `┌─${label}${'─'.repeat(Math.max(0, totalWidth - label.length - 2))}`;
        const bottomBorder = `└─${'─'.repeat(totalWidth - 2)}`;

        formatted = `[${ts}] ${topBorder}\n`;
        for (const line of msg.content.split('\n')) {
          formatted += `[${ts}] │ ${line}\n`;
        }
        formatted += `[${ts}] ${bottomBorder}\n`;
        break;
      }

      case 'tool':
        formatted = `[${ts}] 🔧 TOOL: ${msg.content}\n`;
        break;

      case 'tool_result': {
        const lines = msg.metadata?.lines ? ` (${msg.metadata.lines} lines)` : '';
        formatted = `[${ts}] 📄 RESL: ${msg.metadata?.toolName || 'Tool'}${lines}\n`;
        break;
      }

      case 'thinking': {
        const thinkLabel = `[ 🤔 THINKING ] `;
        const thinkWidth = 80;
        const thinkTop = `┌─${thinkLabel}${'─'.repeat(Math.max(0, thinkWidth - thinkLabel.length - 2))}`;
        const thinkBottom = `└─${'─'.repeat(thinkWidth - 2)}`;

        formatted = `[${ts}] ${thinkTop}\n`;
        for (const line of msg.content.trim().split('\n')) {
          formatted += `[${ts}] │ ${line}\n`;
        }
        formatted += `[${ts}] ${thinkBottom}\n`;
        break;
      }

      default:
        formatted = `[${ts}] ${msg.content}\n`;
    }

    try {
      fs.writeSync(this.readableLogFd, formatted);
    } catch { /* Ignore write errors */ }
  }

  private rotateIfNeeded(logPath: string): void {
    if (!fs.existsSync(logPath)) return;
    try {
      if (fs.statSync(logPath).size >= this.config.maxFileSize) {
        this.rotateLog(logPath);
      }
    } catch { /* Ignore */ }
  }

  private rotateLog(logPath: string): void {
    const dir = path.dirname(logPath);
    const ext = path.extname(logPath);
    const base = path.basename(logPath, ext);

    for (let i = this.config.maxFiles - 1; i >= 1; i--) {
      const oldPath = path.join(dir, `${base}.${i}${ext}`);
      const newPath = path.join(dir, `${base}.${i + 1}${ext}`);
      if (fs.existsSync(oldPath)) {
        if (i === this.config.maxFiles - 1) {
          fs.unlinkSync(oldPath);
        } else {
          fs.renameSync(oldPath, newPath);
        }
      }
    }
    fs.renameSync(logPath, path.join(dir, `${base}.1${ext}`));
  }

  private writeToCleanLog(data: string): void {
    if (this.cleanLogFd === null) return;
    const buffer = Buffer.from(data);
    fs.writeSync(this.cleanLogFd, buffer);
    this.cleanLogSize += buffer.length;

    if (this.cleanLogSize >= this.config.maxFileSize) {
      fs.closeSync(this.cleanLogFd);
      this.rotateLog(this.cleanLogPath);
      this.cleanLogFd = fs.openSync(this.cleanLogPath, 'a');
      this.cleanLogSize = 0;
    }
  }

  private writeToRawLog(data: string): void {
    if (this.rawLogFd === null) return;
    const buffer = Buffer.from(data);
    fs.writeSync(this.rawLogFd, buffer);
    this.rawLogSize += buffer.length;

    if (this.rawLogSize >= this.config.maxFileSize) {
      fs.closeSync(this.rawLogFd);
      this.rotateLog(this.rawLogPath);
      this.rawLogFd = fs.openSync(this.rawLogPath, 'a');
      this.rawLogSize = 0;
    }
  }

  private writeJsonEntry(entry: JsonLogEntry): void {
    if (this.jsonLogFd === null) return;
    fs.writeSync(this.jsonLogFd, JSON.stringify(entry) + '\n');
  }

  writeStdout(data: Buffer | string): void {
    const text = data.toString();
    if (this.config.keepRawLogs) this.writeToRawLog(text);
    if (this.cleanTransform) this.cleanTransform.write(data);

    this.lineBuffer += text;
    const lines = this.lineBuffer.split('\n');
    this.lineBuffer = lines.pop() || '';

    for (const line of lines) {
      const cleanLine = stripAnsi(line).trim();
      if (!cleanLine) continue;

      if (cleanLine.startsWith('{')) {
        if (this.streamingParser) this.streamingParser.parseLine(cleanLine);
        if (this.config.writeJsonLog) {
          try {
            const json = JSON.parse(cleanLine);
            this.writeJsonEntry({
              timestamp: new Date().toISOString(),
              level: 'stdout',
              lane: this.session.laneName,
              task: this.session.taskName,
              message: cleanLine.substring(0, 2000),
              metadata: json,
            });
            continue;
          } catch { /* Not JSON */ }
        }
      }

      if (this.config.writeJsonLog && !this.isNoise(cleanLine)) {
        this.writeJsonEntry({
          timestamp: new Date().toISOString(),
          level: 'stdout',
          lane: this.session.laneName,
          task: this.session.taskName,
          message: cleanLine.substring(0, 1000),
        });
      }
    }
  }

  writeStderr(data: Buffer | string): void {
    const text = data.toString();
    if (this.config.keepRawLogs) this.writeToRawLog(text);
    if (this.cleanTransform) this.cleanTransform.write(data);

    if (this.readableLogFd !== null) {
      for (const line of text.split('\n')) {
        const cleanLine = stripAnsi(line).trim();
        if (cleanLine && !this.isNoise(cleanLine)) {
          try {
            fs.writeSync(this.readableLogFd, `[${new Date().toISOString()}] ❌ STDERR: ${cleanLine}\n`);
          } catch { /* Ignore */ }
        }
      }
    }

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

  log(level: 'info' | 'error' | 'debug', message: string, metadata?: Record<string, any>): void {
    const ts = formatTimestampISO(this.config.timestampFormat, this.session.startTime);
    const line = `[${ts}] [${level.toUpperCase().padEnd(5)}] ${message}\n`;
    this.writeToCleanLog(line);
    if (this.config.keepRawLogs) this.writeToRawLog(line);

    if (this.readableLogFd !== null) {
      const icon = level === 'error' ? '❌ ERROR' : level === 'info' ? 'ℹ️ INFO' : '🔍 DEBUG';
      try {
        fs.writeSync(this.readableLogFd, `${new Date().toISOString()} ${icon}: ${message}\n`);
      } catch { /* Ignore */ }
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

  section(title: string): void {
    const divider = '═'.repeat(78);
    const line = `\n${divider}\n  ${title}\n${divider}\n`;
    this.writeToCleanLog(line);
    if (this.config.keepRawLogs) this.writeToRawLog(line);

    if (this.readableLogFd !== null) {
      const ts = new Date().toISOString();
      try {
        fs.writeSync(this.readableLogFd, `[${ts}] ━━━ ${title} ${'━'.repeat(60)}\n`);
      } catch { /* Ignore */ }
    }
  }

  setTask(taskName: string, model?: string): void {
    this.session.taskName = taskName;
    if (model) this.session.model = model;
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

  private isNoise(text: string): boolean {
    if (!text.trim()) return true;
    const patterns = [/^[\s│├└─┌┐┘┴┬┤]+$/, /^[.\s]+$/, /^[=>\s-]+$/, /^\d+%$/, /^⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/];
    return patterns.some(p => p.test(text));
  }

  getLogPaths(): { clean: string; raw?: string; json?: string; readable: string } {
    return {
      clean: this.cleanLogPath,
      raw: this.config.keepRawLogs ? this.rawLogPath : undefined,
      json: this.config.writeJsonLog ? this.jsonLogPath : undefined,
      readable: this.readableLogPath,
    };
  }

  getFileDescriptors(): { stdout: number; stderr: number } {
    const fd = this.rawLogFd !== null ? this.rawLogFd : this.cleanLogFd!;
    return { stdout: fd, stderr: fd };
  }

  close(): void {
    if (this.cleanTransform) this.cleanTransform.end();

    if (this.streamingParser) {
      if (this.lineBuffer.trim()) this.streamingParser.parseLine(this.lineBuffer);
      this.streamingParser.flush();
    }

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
        metadata: { sessionId: this.session.id, duration: Date.now() - this.session.startTime },
      });
      fs.closeSync(this.jsonLogFd);
      this.jsonLogFd = null;
    }

    if (this.readableLogFd !== null) {
      fs.writeSync(this.readableLogFd, endMarker);
      fs.closeSync(this.readableLogFd);
      this.readableLogFd = null;
    }
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor(ms / (1000 * 60 * 60));
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }
}

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


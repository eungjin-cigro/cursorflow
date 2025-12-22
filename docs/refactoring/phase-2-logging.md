# Phase 2: 로깅 통합

## 목표

분산된 5개의 로깅 관련 파일을 하나의 통합된 `services/logging/` 서비스로 재구성합니다.

## 현재 상태

### 문제점
1. 로깅 관련 기능이 5개 파일에 분산
2. `JsonLogEntry` 타입이 2곳에서 중복 정의
3. `enhanced-logger.ts`가 1,304줄로 너무 큼
4. 파싱, 포맷팅, 파일쓰기, 버퍼링이 혼재

### 현재 파일 분석

```
utils/logger.ts (412줄)
├── COLORS 상수
├── LogLevel enum
├── formatTimestamp()
├── error(), warn(), info(), success(), debug(), progress()
├── withContext()
├── laneOutput(), laneError()
├── section(), log(), raw(), json()
├── tableRow(), tableSeparator()
├── createSpinner()
└── STATUS 상수, getStatusIndicator()

utils/log-formatter.ts (160줄)
├── formatMessageForConsole()    # ParsedMessage → 콘솔 출력
└── formatPotentialJsonMessage() # JSON 문자열 → 포맷된 문자열

utils/enhanced-logger.ts (1,304줄)
├── DEFAULT_LOG_CONFIG
├── StreamingMessageParser       # JSON 스트림 파싱 (210줄)
├── ParsedMessage interface
├── stripAnsi()                  # ANSI 제거
├── formatTimestamp()            # 중복!
├── JsonLogEntry interface       # 중복!
├── LogSession interface
├── CleanLogTransform            # 스트림 변환 (60줄)
├── EnhancedLogManager           # 메인 클래스 (750줄)
│   ├── 파일 초기화/로테이션
│   ├── 세션 헤더 작성
│   ├── stdout/stderr 처리
│   ├── readable 로그 작성
│   └── JSON 엔트리 작성
├── createLogManager()
├── readJsonLog()
├── exportLogs()
├── exportToMarkdown()
└── exportToHtml()

utils/log-buffer.ts (497줄)
├── JsonLogEntry interface       # 중복!
├── BufferedLogEntry interface
├── LogBufferOptions interface
├── LogFilter interface
├── LogBufferState interface
├── LogBufferService class       # 버퍼링 및 필터링 (400줄)
│   ├── loadLogs()
│   ├── watchForChanges()
│   ├── processEntry()
│   ├── filterEntries()
│   └── formatEntry()
└── createLogBuffer()

utils/log-service.ts (20줄)
└── LogEntry interface           # 거의 사용 안됨
```

## 목표 구조

```
src/services/logging/
├── index.ts              # 통합 API export
├── types.ts              # 로깅 관련 타입 (types/logging.ts 참조)
├── constants.ts          # 색상, 레벨, 상태 상수
├── console.ts            # 콘솔 출력 함수
├── parser.ts             # StreamingMessageParser
├── formatter.ts          # 메시지 포맷팅
├── writer.ts             # 파일 쓰기 및 로테이션
├── buffer.ts             # 로그 버퍼링 및 필터링
├── exporter.ts           # 내보내기 (markdown, html, json)
└── manager.ts            # LogManager 통합 클래스
```

### 예상 파일 크기

| 파일 | 예상 라인 | 책임 |
|------|----------|------|
| `constants.ts` | ~50 | 색상, 레벨, 상태 상수 |
| `console.ts` | ~150 | info, warn, error 등 콘솔 출력 |
| `parser.ts` | ~150 | 스트리밍 JSON 파싱 |
| `formatter.ts` | ~100 | 메시지 → 문자열 변환 |
| `writer.ts` | ~200 | 파일 쓰기, 로테이션 |
| `buffer.ts` | ~250 | 버퍼링, 필터링, 이벤트 |
| `exporter.ts` | ~150 | MD, HTML, JSON 내보내기 |
| `manager.ts` | ~200 | 통합 관리 클래스 |
| **총계** | **~1,250** | 현재 2,393줄 → 48% 감소 |

## 상세 작업

### 1. `services/logging/constants.ts`

```typescript
// src/services/logging/constants.ts

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
} as const;

export enum LogLevel {
  error = 0,
  warn = 1,
  info = 2,
  success = 2,
  progress = 2,
  debug = 3,
}

export const STATUS_ICONS = {
  running: `${COLORS.blue}🔄${COLORS.reset}`,
  done: `${COLORS.green}✅${COLORS.reset}`,
  failed: `${COLORS.red}❌${COLORS.reset}`,
  warning: `${COLORS.yellow}⚠️${COLORS.reset}`,
  pending: `${COLORS.gray}⏳${COLORS.reset}`,
  paused: `${COLORS.yellow}⏸️${COLORS.reset}`,
  waiting: `${COLORS.gray}⏳${COLORS.reset}`,
} as const;

export const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
export const EXTENDED_ANSI_REGEX = /(?:\x1B[@-Z\\-_]|\x1B\[[0-?]*[ -/]*[@-~]|\x1B\][^\x07]*(?:\x07|\x1B\\)|\x1B[PX^_][^\x1B]*\x1B\\|\x1B.)/g;

export function stripAnsi(text: string): string {
  return text
    .replace(EXTENDED_ANSI_REGEX, '')
    .replace(ANSI_REGEX, '')
    .replace(/\r[^\n]/g, '\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}
```

### 2. `services/logging/console.ts`

```typescript
// src/services/logging/console.ts

import { COLORS, LogLevel } from './constants';

let currentLogLevel = LogLevel.info;

export function setLogLevel(level: string | number): void {
  if (typeof level === 'string') {
    currentLogLevel = LogLevel[level as keyof typeof LogLevel] ?? LogLevel.info;
  } else {
    currentLogLevel = level;
  }
}

export function getLogLevel(): number {
  return currentLogLevel;
}

export function formatTimestamp(date = new Date()): string {
  return date.toLocaleTimeString('en-US', { hour12: false });
}

interface LogOptions {
  context?: string;
  emoji?: string;
  noTimestamp?: boolean;
  color?: string;
}

function formatColoredMessage(
  levelColor: string,
  level: string,
  message: string,
  options: LogOptions = {}
): string {
  const { context, emoji = '', noTimestamp = false, color } = options;
  const timestamp = noTimestamp ? '' : `${COLORS.gray}[${formatTimestamp()}]${COLORS.reset}`;
  const contextPart = context ? ` ${COLORS.magenta}[${context}]${COLORS.reset}` : '';
  const emojiPart = emoji ? `${emoji} ` : '';
  const effectiveColor = color || levelColor;
  const levelPart = `${effectiveColor}${level.toUpperCase().padEnd(8)}${COLORS.reset}`;
  
  return String(message)
    .split('\n')
    .map(line => `${timestamp}${contextPart} ${emojiPart}${levelPart} ${line}`)
    .join('\n');
}

function logWithColor(color: string, level: keyof typeof LogLevel, message: string, options: LogOptions = {}): void {
  if (LogLevel[level] > currentLogLevel) return;
  console.log(formatColoredMessage(color, level, message, options));
}

export function error(message: string, options?: LogOptions | string): void {
  const opts = normalizeOptions(options, '❌');
  logWithColor(COLORS.red, 'error', message, opts);
}

export function warn(message: string, options?: LogOptions | string): void {
  const opts = normalizeOptions(options, '⚠️');
  logWithColor(COLORS.yellow, 'warn', message, opts);
}

export function info(message: string, options?: LogOptions | string): void {
  const opts = normalizeOptions(options, 'ℹ️');
  logWithColor(COLORS.cyan, 'info', message, opts);
}

export function success(message: string, options?: LogOptions | string): void {
  const opts = normalizeOptions(options, '✅');
  logWithColor(COLORS.green, 'success', message, opts);
}

export function debug(message: string, options?: LogOptions | string): void {
  const opts = normalizeOptions(options, '🔍');
  logWithColor(COLORS.gray, 'debug', message, opts);
}

export function progress(message: string, options?: LogOptions | string): void {
  const opts = normalizeOptions(options, '🔄');
  logWithColor(COLORS.blue, 'progress', message, opts);
}

export function section(title: string): void {
  console.log('');
  console.log(`${COLORS.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.reset}`);
  console.log(`${COLORS.cyan}  ${title}${COLORS.reset}`);
  console.log(`${COLORS.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.reset}`);
  console.log('');
}

export function laneOutput(laneName: string, message: string, isError = false): void {
  const timestamp = `${COLORS.gray}[${formatTimestamp()}]${COLORS.reset}`;
  const label = `[${laneName}]`;
  const laneLabel = `${COLORS.magenta}${label.padEnd(12)}${COLORS.reset}`;
  const output = isError ? `${COLORS.red}${message}${COLORS.reset}` : message;
  
  if (isError) {
    process.stderr.write(`${timestamp} ${laneLabel} ${output}\n`);
  } else {
    process.stdout.write(`${timestamp} ${laneLabel} ${output}\n`);
  }
}

function normalizeOptions(options: LogOptions | string | undefined, defaultEmoji: string): LogOptions {
  if (typeof options === 'string') return { emoji: options };
  return { emoji: defaultEmoji, ...options };
}

export function withContext(context: string) {
  return {
    error: (msg: string, opts?: Omit<LogOptions, 'context'>) => error(msg, { ...opts, context }),
    warn: (msg: string, opts?: Omit<LogOptions, 'context'>) => warn(msg, { ...opts, context }),
    info: (msg: string, opts?: Omit<LogOptions, 'context'>) => info(msg, { ...opts, context }),
    success: (msg: string, opts?: Omit<LogOptions, 'context'>) => success(msg, { ...opts, context }),
    debug: (msg: string, opts?: Omit<LogOptions, 'context'>) => debug(msg, { ...opts, context }),
    progress: (msg: string, opts?: Omit<LogOptions, 'context'>) => progress(msg, { ...opts, context }),
  };
}
```

### 3. `services/logging/parser.ts`

```typescript
// src/services/logging/parser.ts

import type { ParsedMessage } from '../../types/logging';

export class StreamingMessageParser {
  private currentMessage = '';
  private currentRole = '';
  private messageStartTime = 0;
  private onMessage: (msg: ParsedMessage) => void;

  constructor(onMessage: (msg: ParsedMessage) => void) {
    this.onMessage = onMessage;
  }

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
    switch (json.type) {
      case 'system':
        this.emit({
          type: 'system',
          role: 'system',
          content: `[System] Model: ${json.model || 'unknown'}, Mode: ${json.permissionMode || 'default'}`,
          timestamp: json.timestamp_ms || Date.now(),
        });
        break;

      case 'user':
        if (json.message?.content) {
          const textContent = this.extractTextContent(json.message.content);
          this.emit({ type: 'user', role: 'user', content: textContent, timestamp: json.timestamp_ms || Date.now() });
        }
        break;

      case 'assistant':
        if (json.message?.content) {
          const textContent = this.extractTextContent(json.message.content);
          if (this.currentRole !== 'assistant') {
            this.flush();
            this.currentRole = 'assistant';
            this.messageStartTime = json.timestamp_ms || Date.now();
          }
          this.currentMessage += textContent;
        }
        break;

      case 'tool_call':
        this.handleToolCall(json);
        break;

      case 'result':
        this.flush();
        this.emit({
          type: 'result',
          role: 'assistant',
          content: json.result || '',
          timestamp: json.timestamp_ms || Date.now(),
          metadata: { duration_ms: json.duration_ms, is_error: json.is_error, subtype: json.subtype },
        });
        break;

      case 'thinking':
        this.handleThinking(json);
        break;
    }
  }

  private extractTextContent(content: any[]): string {
    return content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
  }

  private handleToolCall(json: any): void {
    if (json.subtype === 'started' && json.tool_call) {
      const toolName = Object.keys(json.tool_call)[0] || 'unknown';
      const toolArgs = json.tool_call[toolName]?.args || {};
      this.flush();
      this.emit({
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
        const content = result.success.content || '';
        const truncated = content.length > 500 ? content.substring(0, 500) + '...' : content;
        this.emit({
          type: 'tool_result',
          role: 'tool',
          content: `[Tool Result: ${toolName}] ${truncated}`,
          timestamp: json.timestamp_ms || Date.now(),
          metadata: { callId: json.call_id, toolName, lines: result.success.totalLines },
        });
      }
    }
  }

  private handleThinking(json: any): void {
    if (json.subtype === 'delta' && json.text) {
      if (this.currentRole !== 'thinking') {
        this.flush();
        this.currentRole = 'thinking';
        this.messageStartTime = json.timestamp_ms || Date.now();
      }
      this.currentMessage += json.text;
    } else if (json.subtype === 'completed') {
      this.flush();
    }
  }

  flush(): void {
    if (this.currentMessage && this.currentRole) {
      this.emit({
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

  private emit(msg: ParsedMessage): void {
    if (msg.content.trim()) {
      this.onMessage(msg);
    }
  }
}
```

### 4. `services/logging/formatter.ts`

```typescript
// src/services/logging/formatter.ts

import { COLORS, stripAnsi } from './constants';
import type { ParsedMessage } from '../../types/logging';

interface FormatOptions {
  includeTimestamp?: boolean;
  laneLabel?: string;
  compact?: boolean;
}

const TYPE_PREFIXES: Record<string, string> = {
  user: `${COLORS.cyan}🧑 USER    ${COLORS.reset}`,
  assistant: `${COLORS.green}🤖 ASST    ${COLORS.reset}`,
  tool: `${COLORS.yellow}🔧 TOOL    ${COLORS.reset}`,
  tool_result: `${COLORS.gray}📄 RESL    ${COLORS.reset}`,
  result: `${COLORS.green}✅ SUCCESS ${COLORS.reset}`,
  system: `${COLORS.gray}⚙️  SYS     ${COLORS.reset}`,
  thinking: `${COLORS.gray}🤔 THNK    ${COLORS.reset}`,
};

export function formatMessageForConsole(msg: ParsedMessage, options: FormatOptions = {}): string {
  const { includeTimestamp = true, laneLabel = '', compact = false } = options;

  const ts = includeTimestamp ? new Date(msg.timestamp).toLocaleTimeString('en-US', { hour12: false }) : '';
  const tsPrefix = ts ? `${COLORS.gray}[${ts}]${COLORS.reset} ` : '';
  const labelPrefix = laneLabel ? `${COLORS.magenta}${laneLabel.padEnd(12)}${COLORS.reset} ` : '';

  const typePrefix = TYPE_PREFIXES[msg.type] || '';
  let content = msg.content;

  // Special formatting for tool calls
  if (msg.type === 'tool') {
    content = formatToolContent(content);
  } else if (msg.type === 'tool_result') {
    content = formatToolResultContent(content);
  }

  // Compact mode: single line
  if (compact) {
    if (['user', 'assistant', 'thinking'].includes(msg.type)) {
      content = content.replace(/\n/g, ' ').substring(0, 100) + (content.length > 100 ? '...' : '');
    }
    return `${tsPrefix}${labelPrefix}${typePrefix} ${content}`;
  }

  // Multi-line box format
  if (!typePrefix) return `${tsPrefix}${labelPrefix}${content}`;

  const lines = content.split('\n');
  const fullPrefix = `${tsPrefix}${labelPrefix}`;
  const header = `${typePrefix} ┌${'─'.repeat(60)}`;
  let result = `${fullPrefix}${header}\n`;

  const indent = ' '.repeat(stripAnsi(typePrefix).length);
  for (const line of lines) {
    result += `${fullPrefix}${indent} │ ${line}\n`;
  }
  result += `${fullPrefix}${indent} └${'─'.repeat(60)}`;

  return result;
}

function formatToolContent(content: string): string {
  const match = content.match(/\[Tool: ([^\]]+)\] (.*)/);
  if (!match) return content;

  const [, name, args] = match;
  try {
    const parsedArgs = JSON.parse(args!);
    let argStr = '';

    if (parsedArgs.target_file) argStr = parsedArgs.target_file;
    else if (parsedArgs.command) argStr = parsedArgs.command;
    else if (parsedArgs.file_path) argStr = parsedArgs.file_path;
    else {
      const keys = Object.keys(parsedArgs);
      if (keys.length > 0) argStr = String(parsedArgs[keys[0]]).substring(0, 50);
    }

    return `${COLORS.bold}${name}${COLORS.reset}(${argStr})`;
  } catch {
    return `${COLORS.bold}${name}${COLORS.reset}: ${args}`;
  }
}

function formatToolResultContent(content: string): string {
  const match = content.match(/\[Tool Result: ([^\]]+)\]/);
  return match ? `${match[1]} OK` : 'result';
}
```

### 5. `services/logging/writer.ts`

```typescript
// src/services/logging/writer.ts

import * as fs from 'fs';
import * as path from 'path';
import { safeJoin } from '../../utils/path';
import type { EnhancedLogConfig } from '../../types/config';
import type { LogSession, JsonLogEntry } from '../../types/logging';

export class LogWriter {
  private config: EnhancedLogConfig;
  private session: LogSession;
  private logDir: string;

  private cleanLogFd: number | null = null;
  private rawLogFd: number | null = null;
  private absoluteRawLogFd: number | null = null;
  private jsonLogFd: number | null = null;
  private readableLogFd: number | null = null;

  private cleanLogSize = 0;
  private rawLogSize = 0;
  private absoluteRawLogSize = 0;

  constructor(logDir: string, session: LogSession, config: EnhancedLogConfig) {
    this.logDir = logDir;
    this.session = session;
    this.config = config;
    
    fs.mkdirSync(logDir, { recursive: true });
    this.initLogFiles();
  }

  private initLogFiles(): void {
    const paths = this.getPaths();

    this.rotateIfNeeded(paths.clean);
    if (this.config.keepRawLogs) this.rotateIfNeeded(paths.raw);
    if (this.config.keepAbsoluteRawLogs) this.rotateIfNeeded(paths.absoluteRaw);

    this.cleanLogFd = fs.openSync(paths.clean, 'a');
    if (this.config.keepRawLogs) this.rawLogFd = fs.openSync(paths.raw, 'a');
    if (this.config.keepAbsoluteRawLogs) this.absoluteRawLogFd = fs.openSync(paths.absoluteRaw, 'a');
    if (this.config.writeJsonLog) this.jsonLogFd = fs.openSync(paths.json, 'a');
    this.readableLogFd = fs.openSync(paths.readable, 'a');

    this.updateSizes();
  }

  getPaths() {
    return {
      clean: safeJoin(this.logDir, 'terminal.log'),
      raw: safeJoin(this.logDir, 'terminal-raw.log'),
      absoluteRaw: safeJoin(this.logDir, 'terminal-absolute-raw.log'),
      json: safeJoin(this.logDir, 'terminal.jsonl'),
      readable: safeJoin(this.logDir, 'terminal-readable.log'),
    };
  }

  private updateSizes(): void {
    const paths = this.getPaths();
    try {
      this.cleanLogSize = fs.existsSync(paths.clean) ? fs.statSync(paths.clean).size : 0;
      this.rawLogSize = fs.existsSync(paths.raw) ? fs.statSync(paths.raw).size : 0;
      this.absoluteRawLogSize = fs.existsSync(paths.absoluteRaw) ? fs.statSync(paths.absoluteRaw).size : 0;
    } catch {
      this.cleanLogSize = this.rawLogSize = this.absoluteRawLogSize = 0;
    }
  }

  writeClean(data: string): void {
    if (!this.cleanLogFd) return;
    const buffer = Buffer.from(data);
    fs.writeSync(this.cleanLogFd, buffer);
    this.cleanLogSize += buffer.length;
    this.rotateIfOversize('clean');
  }

  writeRaw(data: string): void {
    if (!this.rawLogFd) return;
    const buffer = Buffer.from(data);
    fs.writeSync(this.rawLogFd, buffer);
    this.rawLogSize += buffer.length;
    this.rotateIfOversize('raw');
  }

  writeAbsoluteRaw(data: string | Buffer): void {
    if (!this.absoluteRawLogFd) return;
    const buffer = typeof data === 'string' ? Buffer.from(data) : data;
    fs.writeSync(this.absoluteRawLogFd, buffer);
    this.absoluteRawLogSize += buffer.length;
    this.rotateIfOversize('absoluteRaw');
  }

  writeJson(entry: JsonLogEntry): void {
    if (!this.jsonLogFd) return;
    fs.writeSync(this.jsonLogFd, JSON.stringify(entry) + '\n');
  }

  writeReadable(data: string): void {
    if (!this.readableLogFd) return;
    try {
      fs.writeSync(this.readableLogFd, data);
    } catch {
      // Ignore
    }
  }

  private rotateIfNeeded(logPath: string): void {
    if (!fs.existsSync(logPath)) return;
    try {
      if (fs.statSync(logPath).size >= this.config.maxFileSize) {
        this.rotateLog(logPath);
      }
    } catch {
      // Ignore
    }
  }

  private rotateIfOversize(type: 'clean' | 'raw' | 'absoluteRaw'): void {
    const paths = this.getPaths();
    const size = type === 'clean' ? this.cleanLogSize : type === 'raw' ? this.rawLogSize : this.absoluteRawLogSize;

    if (size < this.config.maxFileSize) return;

    const logPath = type === 'clean' ? paths.clean : type === 'raw' ? paths.raw : paths.absoluteRaw;
    const fd = type === 'clean' ? this.cleanLogFd : type === 'raw' ? this.rawLogFd : this.absoluteRawLogFd;

    if (fd) fs.closeSync(fd);
    this.rotateLog(logPath);

    const newFd = fs.openSync(logPath, 'a');
    if (type === 'clean') { this.cleanLogFd = newFd; this.cleanLogSize = 0; }
    else if (type === 'raw') { this.rawLogFd = newFd; this.rawLogSize = 0; }
    else { this.absoluteRawLogFd = newFd; this.absoluteRawLogSize = 0; }
  }

  private rotateLog(logPath: string): void {
    const dir = path.dirname(logPath);
    const ext = path.extname(logPath);
    const base = path.basename(logPath, ext);

    for (let i = this.config.maxFiles - 1; i >= 1; i--) {
      const oldPath = safeJoin(dir, `${base}.${i}${ext}`);
      const newPath = safeJoin(dir, `${base}.${i + 1}${ext}`);
      if (fs.existsSync(oldPath)) {
        if (i === this.config.maxFiles - 1) fs.unlinkSync(oldPath);
        else fs.renameSync(oldPath, newPath);
      }
    }
    fs.renameSync(logPath, safeJoin(dir, `${base}.1${ext}`));
  }

  close(): void {
    if (this.cleanLogFd) { fs.closeSync(this.cleanLogFd); this.cleanLogFd = null; }
    if (this.rawLogFd) { fs.closeSync(this.rawLogFd); this.rawLogFd = null; }
    if (this.absoluteRawLogFd) { fs.closeSync(this.absoluteRawLogFd); this.absoluteRawLogFd = null; }
    if (this.jsonLogFd) { fs.closeSync(this.jsonLogFd); this.jsonLogFd = null; }
    if (this.readableLogFd) { fs.closeSync(this.readableLogFd); this.readableLogFd = null; }
  }
}
```

### 6. `services/logging/index.ts` (통합 API)

```typescript
// src/services/logging/index.ts

// Console logging (직접 사용)
export * from './console';
export { COLORS, LogLevel, STATUS_ICONS, stripAnsi } from './constants';

// Classes
export { StreamingMessageParser } from './parser';
export { LogWriter } from './writer';
export { LogBufferService, createLogBuffer } from './buffer';

// Formatters
export { formatMessageForConsole } from './formatter';

// Exporter
export { exportLogs, readJsonLog } from './exporter';

// Manager (통합 클래스)
export { LogManager, createLogManager } from './manager';

// 기본 설정
export { DEFAULT_LOG_CONFIG } from './manager';
```

## 마이그레이션 가이드

### Before
```typescript
import * as logger from '../utils/logger';
import { EnhancedLogManager, createLogManager, stripAnsi } from '../utils/enhanced-logger';
import { formatMessageForConsole } from '../utils/log-formatter';
import { LogBufferService, createLogBuffer } from '../utils/log-buffer';
```

### After
```typescript
import * as logger from '../services/logging';
// 또는 개별 import
import { 
  info, warn, error, 
  LogManager, createLogManager, 
  stripAnsi, formatMessageForConsole 
} from '../services/logging';
```

## 테스트 계획

1. **유닛 테스트**
   - `parser.ts`: JSON 파싱 정확성
   - `formatter.ts`: 출력 형식 일관성
   - `writer.ts`: 파일 쓰기 및 로테이션

2. **통합 테스트**
   - 전체 로깅 파이프라인 테스트
   - 기존 테스트 통과 확인

3. **수동 테스트**
   - `cursorflow run` 실행 시 로그 출력 확인
   - 모니터 UI에서 로그 조회 확인

## 롤백 계획

1. `services/logging/` 삭제
2. 기존 `utils/logger.ts`, `utils/enhanced-logger.ts` 등 복원
3. import 경로 revert

## 체크리스트

- [ ] `services/logging/` 디렉토리 생성
- [ ] `constants.ts` 작성
- [ ] `console.ts` 작성
- [ ] `parser.ts` 작성
- [ ] `formatter.ts` 작성
- [ ] `writer.ts` 작성
- [ ] `buffer.ts` 작성 (log-buffer.ts 기반)
- [ ] `exporter.ts` 작성
- [ ] `manager.ts` 작성
- [ ] `index.ts` 작성
- [ ] 모든 import 경로 변경
- [ ] 기존 5개 파일 삭제
- [ ] 테스트 실행


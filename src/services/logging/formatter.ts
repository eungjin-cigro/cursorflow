/**
 * Log Formatter - Human-readable log formatting
 * 
 * Formats log messages for console display with various styles.
 */

import { COLORS } from './console';
import { ParsedMessage, MessageType } from '../../types/logging';

/**
 * Strip ANSI escape sequences from text
 */
export function stripAnsi(text: string): string {
  const EXTENDED_ANSI_REGEX = /(?:\x1B[@-Z\\-_]|\x1B\[[0-?]*[ -/]*[@-~]|\x1B\][^\x07]*(?:\x07|\x1B\\)|\x1B[PX^_][^\x1B]*\x1B\\|\x1B.)/g;
  const ANSI_REGEX = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
  
  return text
    .replace(EXTENDED_ANSI_REGEX, '')
    .replace(ANSI_REGEX, '')
    .replace(/\r[^\n]/g, '\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Format options for console display
 */
export interface FormatOptions {
  includeTimestamp?: boolean;
  laneLabel?: string;
  compact?: boolean;
  showBorders?: boolean;
}

/**
 * Format a parsed message for console display
 */
export function formatMessageForConsole(
  msg: ParsedMessage,
  options: FormatOptions = {}
): string {
  const { includeTimestamp = true, laneLabel = '', compact = false, showBorders = true } = options;
  
  const ts = includeTimestamp 
    ? new Date(msg.timestamp).toLocaleTimeString('en-US', { hour12: false }) 
    : '';
  const tsPrefix = ts ? `${COLORS.gray}[${ts}]${COLORS.reset} ` : '';
  const labelPrefix = laneLabel 
    ? `${COLORS.magenta}${laneLabel.padEnd(12)}${COLORS.reset} ` 
    : '';

  const { typePrefix, formattedContent } = formatMessageContent(msg, compact);

  if (!typePrefix) return `${tsPrefix}${labelPrefix}${formattedContent}`;

  if (compact || !showBorders) {
    return `${tsPrefix}${labelPrefix}${typePrefix} ${formattedContent}`;
  }

  // Multi-line box format
  const lines = formattedContent.split('\n');
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

function formatMessageContent(msg: ParsedMessage, compact: boolean): { typePrefix: string; formattedContent: string } {
  let typePrefix = '';
  let formattedContent = msg.content;

  switch (msg.type) {
    case 'user':
      typePrefix = `${COLORS.cyan}🧑 USER${COLORS.reset}`;
      if (compact) formattedContent = truncate(formattedContent.replace(/\n/g, ' '), 100);
      break;
      
    case 'assistant':
      typePrefix = `${COLORS.green}🤖 ASST${COLORS.reset}`;
      if (compact) formattedContent = truncate(formattedContent.replace(/\n/g, ' '), 100);
      break;
      
    case 'tool':
      typePrefix = `${COLORS.yellow}🔧 TOOL${COLORS.reset}`;
      formattedContent = formatToolCall(formattedContent);
      break;
      
    case 'tool_result':
      typePrefix = `${COLORS.gray}📄 RESL${COLORS.reset}`;
      const resMatch = formattedContent.match(/\[Tool Result: ([^\]]+)\]/);
      formattedContent = resMatch ? `${resMatch[1]} OK` : 'result';
      break;
      
    case 'result':
      typePrefix = `${COLORS.green}✅ DONE${COLORS.reset}`;
      break;
      
    case 'system':
      typePrefix = `${COLORS.gray}⚙️  SYS${COLORS.reset}`;
      break;
      
    case 'thinking':
      typePrefix = `${COLORS.gray}🤔 THNK${COLORS.reset}`;
      if (compact) formattedContent = truncate(formattedContent.replace(/\n/g, ' '), 100);
      break;
  }

  return { typePrefix, formattedContent };
}

function formatToolCall(content: string): string {
  const toolMatch = content.match(/\[Tool: ([^\]]+)\] (.*)/);
  if (!toolMatch) return content;

  const [, name, args] = toolMatch;
  try {
    const parsedArgs = JSON.parse(args!);
    let argStr = '';
    
    if (name === 'read_file' && parsedArgs.target_file) {
      argStr = parsedArgs.target_file;
    } else if (name === 'run_terminal_cmd' && parsedArgs.command) {
      argStr = parsedArgs.command;
    } else if (name === 'write' && parsedArgs.file_path) {
      argStr = parsedArgs.file_path;
    } else if (name === 'search_replace' && parsedArgs.file_path) {
      argStr = parsedArgs.file_path;
    } else {
      const keys = Object.keys(parsedArgs);
      if (keys.length > 0) {
        argStr = String(parsedArgs[keys[0]]).substring(0, 50);
      }
    }
    
    return `${COLORS.bold}${name}${COLORS.reset}(${argStr})`;
  } catch {
    return `${COLORS.bold}${name}${COLORS.reset}: ${args}`;
  }
}

function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength) + '...';
}

/**
 * Format a readable log entry for display
 */
export function formatReadableEntry(
  timestamp: Date,
  laneName: string,
  type: MessageType,
  content: string,
  options: { showLane?: boolean; maxWidth?: number } = {}
): string {
  const { showLane = true, maxWidth = 100 } = options;
  
  const ts = timestamp.toLocaleTimeString('en-US', { hour12: false });
  const laneStr = showLane ? `[${laneName.padEnd(12)}] ` : '';
  
  const typeInfo = getTypeInfo(type);
  const truncatedContent = content.length > maxWidth 
    ? content.substring(0, maxWidth - 3) + '...'
    : content;
  
  return `${COLORS.gray}[${ts}]${COLORS.reset} ${laneStr}${typeInfo.color}[${typeInfo.label}]${COLORS.reset} ${truncatedContent}`;
}

function getTypeInfo(type: MessageType): { label: string; color: string } {
  const typeMap: Record<MessageType, { label: string; color: string }> = {
    user: { label: 'USER  ', color: COLORS.cyan },
    assistant: { label: 'ASST  ', color: COLORS.green },
    tool: { label: 'TOOL  ', color: COLORS.yellow },
    tool_result: { label: 'RESULT', color: COLORS.gray },
    result: { label: 'DONE  ', color: COLORS.green },
    system: { label: 'SYSTEM', color: COLORS.gray },
    thinking: { label: 'THINK ', color: COLORS.gray },
    success: { label: 'OK    ', color: COLORS.green },
    info: { label: 'INFO  ', color: COLORS.cyan },
    warn: { label: 'WARN  ', color: COLORS.yellow },
    error: { label: 'ERROR ', color: COLORS.red },
    stdout: { label: 'STDOUT', color: COLORS.white },
    stderr: { label: 'STDERR', color: COLORS.red },
  };
  
  return typeMap[type] || { label: type.toUpperCase().padEnd(6), color: COLORS.white };
}

/**
 * Format a timestamp for log files
 */
export function formatTimestampISO(format: 'iso' | 'relative' | 'short', startTime?: number): string {
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
        
        if (hours > 0) return `+${hours}h${minutes % 60}m${seconds % 60}s`;
        if (minutes > 0) return `+${minutes}m${seconds % 60}s`;
        return `+${seconds}s`;
      }
      return new Date(now).toISOString();
    case 'short':
      return new Date(now).toLocaleTimeString('en-US', { hour12: false });
    default:
      return new Date(now).toISOString();
  }
}


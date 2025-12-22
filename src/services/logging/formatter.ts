/**
 * Log Formatter - Human-readable log formatting
 * 
 * Formats log messages for console display with various styles.
 * 
 * Rules:
 * - Box format only for: user, assistant, system, result
 * - Compact format for: tool, tool_result, thinking (gray/dim)
 * - Tool names simplified: ShellToolCall → Shell
 */

import { COLORS } from './console';
import { ParsedMessage, MessageType } from '../../types/logging';

// Types that should use box format
const BOX_TYPES = new Set(['user', 'assistant', 'system', 'result']);

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
 * Simplify tool names (ShellToolCall → Shell, etc.)
 */
function simplifyToolName(name: string): string {
  return name
    .replace(/ToolCall$/i, '')
    .replace(/Tool$/i, '')
    .replace(/^run_terminal_cmd$/i, 'shell')
    .replace(/^search_replace$/i, 'edit');
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
  
  // Lane label max 16 chars
  const truncatedLabel = laneLabel.length > 16 ? laneLabel.substring(0, 16) : laneLabel;
  const labelPrefix = truncatedLabel 
    ? `${COLORS.magenta}${truncatedLabel.padEnd(16)}${COLORS.reset} ` 
    : '';

  // Determine if should use box format
  const useBox = !compact && showBorders && BOX_TYPES.has(msg.type);
  const { typePrefix, formattedContent } = formatMessageContent(msg, !useBox);

  if (!typePrefix) return `${tsPrefix}${labelPrefix}${formattedContent}`;

  if (!useBox) {
    return `${tsPrefix}${labelPrefix}${typePrefix.padEnd(12)} ${formattedContent}`;
  }

  // Multi-line box format (only for user, assistant, system, result)
  // Emoji width is 2, so we need to account for that in indent calculation
  const lines = formattedContent.split('\n');
  const fullPrefix = `${tsPrefix}${labelPrefix}`;
  const strippedPrefix = stripAnsi(typePrefix);
  // Count emojis (they take 2 terminal columns but 1-2 chars in string)
  const emojiCount = (strippedPrefix.match(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2300}-\u{23FF}]|[\u{2B50}-\u{2B55}]|[\u{231A}-\u{231B}]|[\u{23E9}-\u{23F3}]|[\u{23F8}-\u{23FA}]|✅|❌|⚙️|ℹ️|⚠️|🔧|📄|🤔|🧑|🤖/gu) || []).length;
  const visualWidth = strippedPrefix.length + emojiCount; // emoji adds 1 extra width
  
  const boxWidth = 60;
  const header = `${typePrefix}┌${'─'.repeat(boxWidth)}`;
  let result = `${fullPrefix}${header}\n`;
  
  const indent = ' '.repeat(visualWidth);
  for (const line of lines) {
    result += `${fullPrefix}${indent}│ ${line}\n`;
  }
  result += `${fullPrefix}${indent}└${'─'.repeat(boxWidth)}`;
  
  return result;
}

function formatMessageContent(msg: ParsedMessage, forceCompact: boolean): { typePrefix: string; formattedContent: string } {
  let typePrefix = '';
  let formattedContent = msg.content;

  // For thinking: collapse multiple newlines
  if (msg.type === 'thinking') {
    formattedContent = formattedContent.replace(/\n\s*\n/g, ' ').replace(/\n/g, ' ').trim();
  }

  switch (msg.type) {
    case 'user':
      typePrefix = `${COLORS.cyan}🧑 USER${COLORS.reset}`;
      if (forceCompact) formattedContent = truncate(formattedContent.replace(/\n/g, ' '), 100);
      break;
      
    case 'assistant':
      typePrefix = `${COLORS.green}🤖 ASST${COLORS.reset}`;
      if (forceCompact) formattedContent = truncate(formattedContent.replace(/\n/g, ' '), 100);
      break;
      
    case 'tool':
      // Tool calls are always gray
      typePrefix = `${COLORS.gray}🔧 TOOL${COLORS.reset}`;
      formattedContent = formatToolCall(formattedContent);
      break;
      
    case 'tool_result':
      // Tool results are always gray
      typePrefix = `${COLORS.gray}📄 RESL${COLORS.reset}`;
      const resMatch = formattedContent.match(/\[Tool Result: ([^\]]+)\]/);
      if (resMatch) {
        const simpleName = simplifyToolName(resMatch[1]!);
        formattedContent = `${COLORS.gray}${simpleName} OK${COLORS.reset}`;
      } else {
        formattedContent = `${COLORS.gray}result${COLORS.reset}`;
      }
      break;
      
    case 'result':
      typePrefix = `${COLORS.green}✅ DONE${COLORS.reset}`;
      break;
      
    case 'system':
      typePrefix = `${COLORS.gray}⚙️ SYS${COLORS.reset}`;
      break;
      
    case 'thinking':
      // Thinking is always gray and compact
      typePrefix = `${COLORS.gray}🤔 THNK${COLORS.reset}`;
      formattedContent = `${COLORS.gray}${truncate(formattedContent, 100)}${COLORS.reset}`;
      break;
  }

  return { typePrefix, formattedContent };
}

function formatToolCall(content: string): string {
  const toolMatch = content.match(/\[Tool: ([^\]]+)\] (.*)/);
  if (!toolMatch) return content;

  const [, rawName, args] = toolMatch;
  const name = simplifyToolName(rawName!);
  
  try {
    const parsedArgs = JSON.parse(args!);
    let argStr = '';
    
    if (rawName === 'read_file' && parsedArgs.target_file) {
      argStr = parsedArgs.target_file;
    } else if (rawName === 'run_terminal_cmd' && parsedArgs.command) {
      argStr = parsedArgs.command;
    } else if (rawName === 'write' && parsedArgs.file_path) {
      argStr = parsedArgs.file_path;
    } else if (rawName === 'search_replace' && parsedArgs.file_path) {
      argStr = parsedArgs.file_path;
    } else {
      const keys = Object.keys(parsedArgs);
      if (keys.length > 0) {
        argStr = String(parsedArgs[keys[0]]).substring(0, 50);
      }
    }
    
    return `${COLORS.gray}${name}${COLORS.reset}(${COLORS.gray}${argStr}${COLORS.reset})`;
  } catch {
    return `${COLORS.gray}${name}${COLORS.reset}: ${args}`;
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


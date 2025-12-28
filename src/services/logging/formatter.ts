/**
 * Log Formatter - Human-readable log formatting
 * 
 * Formats log messages for console display with various styles.
 * 
 * ## Color Rules (by importance):
 * - HIGH (colored): user(cyan), assistant(green), result(green), error(red), warn(yellow)
 * - LOW (gray/dim): tool, tool_result, thinking, system, debug, stdout, raw, info
 * 
 * ## Format Rules:
 * - Box format only for: user, assistant, result
 * - Compact format for: tool, tool_result, thinking, system (gray/dim)
 * - Tool names simplified: ShellToolCall → Shell
 * - Lane labels fixed 14 chars: [1-1-lanename  ]
 * - Type labels: emoji + 4char (USER, ASST, TOOL, RESL, SYS, DONE, THNK)
 */

import { COLORS } from './console';
import { ParsedMessage, MessageType } from '../../types/logging';

// Types that should use box format (important messages)
const BOX_TYPES = new Set(['user', 'assistant', 'result']);

// Types that should be gray/dim (less important)
const GRAY_TYPES = new Set(['tool', 'tool_result', 'thinking', 'system', 'debug', 'stdout', 'raw', 'info']);

/**
 * Simplify paths by replacing the project root with ./
 */
function simplifyPath(p: string): string {
  if (typeof p !== 'string') return p;
  
  const pathStr = p.replace(/\\/g, '/');
  
  const workbenchIndex = pathStr.indexOf('/workbench/');
  if (workbenchIndex !== -1) {
    return './' + pathStr.substring(workbenchIndex + '/workbench/'.length);
  }
  
  const cwd = process.cwd().replace(/\\/g, '/');
  if (pathStr.startsWith(cwd)) {
    return './' + pathStr.substring(cwd.length).replace(/^[/\\]+/, '');
  }
  
  return p;
}

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
  
  // Lane label: fixed 14 chars inside brackets [1-1-lanename  ]
  const labelContent = laneLabel.replace(/^\[|\]$/g, ''); // Remove existing brackets if any
  const truncatedLabel = labelContent.length > 14 ? labelContent.substring(0, 14) : labelContent;
  
  // Determine if should use box format
  const useBox = !compact && showBorders && BOX_TYPES.has(msg.type);
  const isImportant = BOX_TYPES.has(msg.type) || msg.type === 'warn' || msg.type === 'error' || msg.type === 'success';
  
  const labelColor = isImportant ? COLORS.magenta : COLORS.gray;
  const labelPrefix = truncatedLabel 
    ? `${labelColor}[${truncatedLabel.padEnd(14)}]${COLORS.reset} ` 
    : '';

  const { typePrefix, formattedContent } = formatMessageContent(msg, !useBox);

  if (!typePrefix && !formattedContent) return '';
  if (!typePrefix) return `${tsPrefix}${labelPrefix}${formattedContent}`;

  if (!useBox) {
    const strippedType = stripAnsi(typePrefix);
    let typeWidth = 0;
    for (let i = 0; i < strippedType.length; i++) {
      const code = strippedType.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF) { typeWidth += 2; i++; }
      else if (code === 0xFE0F) continue;
      else if (code >= 0x2000 && code <= 0x32FF) typeWidth += 2;
      else typeWidth += 1;
    }
    
    const paddedType = typePrefix + ' '.repeat(Math.max(0, 10 - typeWidth));
    const fullPrefixWithPaddedType = `${tsPrefix}${labelPrefix}${paddedType} `;
    
    // For multi-line non-box content (like thinking), indent subsequent lines
    const lines = formattedContent.split('\n');
    if (lines.length > 1) {
      // Fixed width indent: [HH:MM:SS] (11) + [label] (17) + type (10) + space (1)
      const indent = ' '.repeat(stripAnsi(tsPrefix + labelPrefix).length + 11);
      return lines.map((line, i) => i === 0 ? `${fullPrefixWithPaddedType}${line}` : `${indent}${line}`).join('\n');
    }
    
    return `${fullPrefixWithPaddedType}${formattedContent}`;
  }

  // Multi-line box format (only for user, assistant, result)
  const lines = formattedContent.split('\n');
  const fullPrefix = `${tsPrefix}${labelPrefix}`;
  const strippedPrefix = stripAnsi(typePrefix);
  
  // Calculate visual width more accurately
  let visualWidth = 0;
  for (let i = 0; i < strippedPrefix.length; i++) {
    const code = strippedPrefix.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDBFF) {
      visualWidth += 2;
      i++;
    } else if (code === 0xFE0F) {
      continue;
    } else if (code >= 0x2000 && code <= 0x32FF) {
      visualWidth += 2;
    } else {
      visualWidth += 1;
    }
  }
  
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

  // For thinking: don't collapse anymore
  if (msg.type === 'thinking') {
    formattedContent = formattedContent.trim();
  }

  // Determine if this type should be gray (less important)
  const isGray = GRAY_TYPES.has(msg.type);

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
      // Tool calls are dynamic based on the tool name
      const toolMatch = formattedContent.match(/\[Tool: ([^\]]+)\] (.*)/);
      if (toolMatch) {
        const [, rawName, args] = toolMatch;
        const name = simplifyToolName(rawName!);
        
        const toolInfo: Record<string, { label: string; emoji: string; color: string }> = {
          'read_file': { label: 'READ', emoji: '📖', color: COLORS.gray },
          'search_replace': { label: 'EDIT', emoji: '📝', color: COLORS.gray },
          'edit': { label: 'EDIT', emoji: '📝', color: COLORS.gray },
          'write': { label: 'WRIT', emoji: '💾', color: COLORS.gray },
          'run_terminal_cmd': { label: 'SHLL', emoji: '💻', color: COLORS.gray },
          'shell': { label: 'SHLL', emoji: '💻', color: COLORS.gray },
          'grep': { label: 'GREP', emoji: '🔍', color: COLORS.gray },
          'codebase_search': { label: 'SRCH', emoji: '🔎', color: COLORS.gray },
          'list_dir': { label: 'LIST', emoji: '📂', color: COLORS.gray },
          'glob_file_search': { label: 'GLOB', emoji: '🌐', color: COLORS.gray },
        };
        
        const info = toolInfo[rawName!] || toolInfo[name] || { label: 'TOOL', emoji: '🔧', color: COLORS.gray };
        typePrefix = `${info.color}${info.emoji} ${info.label}${COLORS.reset}`;
        formattedContent = formatToolCall(formattedContent, true); // true means just args
      } else {
        typePrefix = `${COLORS.gray}🔧 TOOL${COLORS.reset}`;
        formattedContent = formatToolCall(formattedContent);
      }
      break;
      
    case 'tool_result':
      // Skip standard tool results if they just say OK
      const resMatch = formattedContent.match(/\[Tool Result: ([^\]]+)\]/);
      if (resMatch) {
        return { typePrefix: '', formattedContent: '' };
      }
      typePrefix = `${COLORS.gray}📄 RESL${COLORS.reset}`;
      formattedContent = `${COLORS.gray}${formattedContent}${COLORS.reset}`;
      break;
      
    case 'result':
      typePrefix = `${COLORS.green}✅ DONE${COLORS.reset}`;
      break;
      
    case 'system':
      // System messages are gray (less important)
      typePrefix = `${COLORS.gray}⚙️  SYS${COLORS.reset}`;
      formattedContent = `${COLORS.gray}${formattedContent}${COLORS.reset}`;
      break;
      
    case 'thinking':
      // Thinking is always gray and compact (less important)
      typePrefix = `${COLORS.gray}🤔 THNK${COLORS.reset}`;
      formattedContent = `${COLORS.gray}${formattedContent}${COLORS.reset}`;
      break;
      
    case 'info':
      // Info messages are gray (less important)
      typePrefix = `${COLORS.gray}ℹ️  INFO${COLORS.reset}`;
      formattedContent = `${COLORS.gray}${formattedContent}${COLORS.reset}`;
      break;
      
    case 'warn':
      // Warnings are yellow (important)
      typePrefix = `${COLORS.yellow}⚠️  WARN${COLORS.reset}`;
      break;
      
    case 'error':
      // Errors are red (important)
      typePrefix = `${COLORS.red}❌ ERR${COLORS.reset}`;
      break;
      
    case 'success':
      typePrefix = `${COLORS.green}✅ DONE${COLORS.reset}`;
      break;
      
    case 'debug':
      // Debug is gray (less important)
      typePrefix = `${COLORS.gray}🔍 DBUG${COLORS.reset}`;
      formattedContent = `${COLORS.gray}${formattedContent}${COLORS.reset}`;
      break;
      
    case 'progress':
      typePrefix = `${COLORS.blue}🔄 PROG${COLORS.reset}`;
      break;
      
    case 'stdout':
    case 'raw':
      // Raw output is gray (less important)
      typePrefix = `${COLORS.gray}   >>${COLORS.reset}`;
      formattedContent = `${COLORS.gray}${formattedContent}${COLORS.reset}`;
      break;
      
    case 'stderr':
      typePrefix = `${COLORS.red}   >>${COLORS.reset}`;
      break;
  }

  return { typePrefix, formattedContent };
}

function formatToolCall(content: string, justArgs: boolean = false): string {
  const toolMatch = content.match(/\[Tool: ([^\]]+)\] (.*)/);
  if (!toolMatch) return content;

  const [, rawName, args] = toolMatch;
  const name = simplifyToolName(rawName!);
  
  try {
    const parsedArgs = JSON.parse(args!);
    let argStr = '';
    
    if (rawName === 'read_file' && parsedArgs.target_file) {
      argStr = simplifyPath(parsedArgs.target_file);
    } else if (rawName === 'run_terminal_cmd' && parsedArgs.command) {
      argStr = parsedArgs.command;
    } else if (rawName === 'write' && parsedArgs.file_path) {
      argStr = simplifyPath(parsedArgs.file_path);
    } else if (rawName === 'search_replace' && parsedArgs.file_path) {
      argStr = simplifyPath(parsedArgs.file_path);
    } else {
      const keys = Object.keys(parsedArgs);
      if (keys.length > 0) {
        argStr = simplifyPath(String(parsedArgs[keys[0]]));
      }
    }
    
    if (justArgs) return `${COLORS.gray}${argStr}${COLORS.reset}`;
    return `${COLORS.gray}${name}${COLORS.reset}(${COLORS.gray}${argStr}${COLORS.reset})`;
  } catch {
    if (justArgs) return `${COLORS.gray}${args}${COLORS.reset}`;
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
    debug: { label: 'DEBUG ', color: COLORS.gray },
    progress: { label: 'PROG  ', color: COLORS.blue || COLORS.cyan },
    stdout: { label: 'STDOUT', color: COLORS.white },
    stderr: { label: 'STDERR', color: COLORS.red },
    raw: { label: 'RAW   ', color: COLORS.white },
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


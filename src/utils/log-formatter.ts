/**
 * Utility for formatting log messages for console display
 * 
 * Format: [HH:MM:SS] [lane-task] ICON TYPE content
 * 
 * Rules:
 * - Box format only for: user, assistant, system, result
 * - Compact format for: tool, tool_result, thinking (gray/dim)
 * - Tool names simplified: ShellToolCall → Shell
 * - Lane labels max 16 chars: [01-types-tests]
 */

import { COLORS } from './log-constants';
import { ParsedMessage, stripAnsi } from './enhanced-logger';

// Types that should use box format
const BOX_TYPES = new Set(['user', 'assistant', 'system', 'result']);

// Types that should be displayed in gray/subdued
const GRAY_TYPES = new Set(['tool', 'tool_result', 'thinking']);

/**
 * Simplify tool names (ShellToolCall → Shell, etc.)
 */
function simplifyToolName(name: string): string {
  // Remove common suffixes
  return name
    .replace(/ToolCall$/i, '')
    .replace(/Tool$/i, '')
    .replace(/^run_terminal_cmd$/i, 'shell')
    .replace(/^search_replace$/i, 'edit');
}

/**
 * Format a single parsed message into a human-readable string (compact or multi-line)
 */
export function formatMessageForConsole(
  msg: ParsedMessage, 
  options: { 
    includeTimestamp?: boolean; 
    laneLabel?: string;
    compact?: boolean;
    context?: string;
  } = {}
): string {
  const { includeTimestamp = true, laneLabel = '', compact = false, context = '' } = options;
  const ts = includeTimestamp ? new Date(msg.timestamp).toLocaleTimeString('en-US', { hour12: false }) : '';
  const tsPrefix = ts ? `${COLORS.gray}[${ts}]${COLORS.reset} ` : '';
  
  // Handle context (e.g. from logger.info) - max 16 chars
  const effectiveLaneLabel = laneLabel || (context ? `[${context}]` : '');
  const truncatedLabel = effectiveLaneLabel.length > 16 
    ? effectiveLaneLabel.substring(0, 16) 
    : effectiveLaneLabel;
  const labelPrefix = truncatedLabel ? `${COLORS.magenta}${truncatedLabel.padEnd(16)}${COLORS.reset} ` : '';
  
  let typePrefix = '';
  let content = msg.content;
  
  // Determine if we should use box format
  // Box format only for: user, assistant, system, result (and only when not compact)
  const useBox = !compact && BOX_TYPES.has(msg.type);

  // Clean up wrapped prompts for user messages to hide internal instructions
  if (msg.type === 'user') {
    const contextMarker = '### 🛠 Environment & Context';
    const instructionsMarker = '### 📝 Final Instructions';
    
    if (content.includes(contextMarker)) {
      const parts = content.split('---\n');
      if (parts.length >= 3) {
        content = parts[1]!.trim();
      } else {
        content = content.split(contextMarker).pop() || content;
        content = content.split(instructionsMarker)[0] || content;
        content = content.replace(/^.*---\n/s, '').trim();
      }
    }
  }
  
  // For thinking: collapse multiple newlines into single space
  if (msg.type === 'thinking') {
    content = content.replace(/\n\s*\n/g, ' ').replace(/\n/g, ' ').trim();
  }
  
  switch (msg.type) {
    case 'user':
      typePrefix = `${COLORS.cyan}🧑 USER${COLORS.reset}`;
      if (!useBox) content = content.replace(/\n/g, ' ').substring(0, 100) + (content.length > 100 ? '...' : '');
      break;
    case 'assistant':
      typePrefix = `${COLORS.green}🤖 ASST${COLORS.reset}`;
      if (!useBox) content = content.replace(/\n/g, ' ').substring(0, 100) + (content.length > 100 ? '...' : '');
      break;
    case 'tool':
      // Tool calls are always compact and gray
      typePrefix = `${COLORS.gray}🔧 TOOL${COLORS.reset}`;
      const toolMatch = content.match(/\[Tool: ([^\]]+)\] (.*)/);
      if (toolMatch) {
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
          content = `${COLORS.gray}${name}${COLORS.reset}(${COLORS.gray}${argStr}${COLORS.reset})`;
        } catch {
          content = `${COLORS.gray}${name}${COLORS.reset}: ${args}`;
        }
      }
      break;
    case 'tool_result':
      // Tool results are always compact and gray
      typePrefix = `${COLORS.gray}📄 RESL${COLORS.reset}`;
      const resMatch = content.match(/\[Tool Result: ([^\]]+)\]/);
      if (resMatch) {
        const simpleName = simplifyToolName(resMatch[1]!);
        content = `${COLORS.gray}${simpleName} OK${COLORS.reset}`;
      } else {
        content = `${COLORS.gray}result${COLORS.reset}`;
      }
      break;
    case 'result':
    case 'success':
      typePrefix = `${COLORS.green}✅ DONE${COLORS.reset}`;
      break;
    case 'system':
      typePrefix = `${COLORS.gray}⚙️ SYS${COLORS.reset}`;
      break;
    case 'thinking':
      // Thinking is always compact and gray
      typePrefix = `${COLORS.gray}🤔 THNK${COLORS.reset}`;
      content = `${COLORS.gray}${content.substring(0, 100)}${content.length > 100 ? '...' : ''}${COLORS.reset}`;
      break;
    case 'info':
      typePrefix = `${COLORS.cyan}ℹ️ INFO${COLORS.reset}`;
      break;
    case 'warn':
      typePrefix = `${COLORS.yellow}⚠️ WARN${COLORS.reset}`;
      break;
    case 'error':
      typePrefix = `${COLORS.red}❌ ERR${COLORS.reset}`;
      break;
  }
  
  if (!typePrefix) return `${tsPrefix}${labelPrefix}${content}`;

  // Compact format (single line)
  if (!useBox) {
    return `${tsPrefix}${labelPrefix}${typePrefix.padEnd(12)} ${content}`;
  }

  // Multi-line box format (only for user, assistant, system, result)
  // Emoji width is 2, so we need to account for that in indent calculation
  const lines = content.split('\n');
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

/**
 * Detect and format a message that might be a raw JSON string from cursor-agent
 */
export function formatPotentialJsonMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return message;
  }
  
  try {
    const json = JSON.parse(trimmed);
    if (!json.type) return message;
    
    // Convert JSON to a ParsedMessage-like structure for formatting
    let content = trimmed;
    let type = 'system';
    
    if (json.type === 'thinking' && json.text) {
      content = json.text;
      type = 'thinking';
    } else if (json.type === 'assistant' && json.message?.content) {
      content = json.message.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('');
      type = 'assistant';
    } else if (json.type === 'user' && json.message?.content) {
      content = json.message.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text)
        .join('');
      type = 'user';
    } else if (json.type === 'tool_call' && json.subtype === 'started') {
      const rawToolName = Object.keys(json.tool_call)[0] || 'unknown';
      const args = json.tool_call[rawToolName]?.args || {};
      // Tool name will be simplified in formatMessageForConsole
      content = `[Tool: ${rawToolName}] ${JSON.stringify(args)}`;
      type = 'tool';
    } else if (json.type === 'tool_call' && json.subtype === 'completed') {
      const rawToolName = Object.keys(json.tool_call)[0] || 'unknown';
      content = `[Tool Result: ${rawToolName}]`;
      type = 'tool_result';
    } else if (json.type === 'result') {
      content = json.result || 'Task completed';
      type = 'result';
    } else {
      // Unknown type, return as is
      return message;
    }
    
    return formatMessageForConsole({
      type: type as any,
      role: type,
      content,
      timestamp: json.timestamp_ms || Date.now()
    }, { includeTimestamp: false, compact: true });
    
  } catch {
    return message;
  }
}

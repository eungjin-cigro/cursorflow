/**
 * Utility for formatting log messages for console display
 * 
 * Format: [HH:MM:SS] [MAIN] or [SUB:<id>] ICON TYPE content
 * (labels are padded to keep alignment consistent)
 * 
 * Rules:
 * - Box format only for: user, assistant, system, result
 * - Compact format for: tool, tool_result, thinking (gray/dim)
 * - Tool names simplified: ShellToolCall → Shell
 * - Lane labels fixed 20 chars: [1-1-backend       ]
 */

import { COLORS } from './log-constants';
import { ParsedMessage, stripAnsi } from './enhanced-logger';

// Types that should use box format
const BOX_TYPES = new Set(['user', 'assistant', 'system', 'result']);

/**
 * Simplify paths by replacing the project root with ./
 */
function simplifyPath(p: string): string {
  if (typeof p !== 'string') return p;
  
  // Standardize slashes
  const pathStr = p.replace(/\\/g, '/');
  
  // Handle common "workbench" pattern if mentioned by user
  // User wants everything before the project name (after workbench/) to be ./
  // Example: /home/eugene/workbench/project-name/... -> ./project-name/...
  const workbenchIndex = pathStr.indexOf('/workbench/');
  if (workbenchIndex !== -1) {
    return './' + pathStr.substring(workbenchIndex + '/workbench/'.length);
  }
  
  // Try current working directory
  const cwd = process.cwd().replace(/\\/g, '/');
  if (pathStr.startsWith(cwd)) {
    return './' + pathStr.substring(cwd.length).replace(/^[/\\]+/, '');
  }
  
  return p;
}

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
  
  // Handle context (e.g. from logger.info) - keep labels compact
  // Format: [1-1-refactor] without fixed width padding
  let effectiveLaneLabel = laneLabel || (context ? `[${context.substring(0, 12)}]` : '');
  
  // Compact label with color
  const labelPrefix = effectiveLaneLabel ? `${COLORS.magenta}${effectiveLaneLabel}${COLORS.reset} ` : '';
  
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
  
  // For thinking: don't collapse anymore, but maybe trim
  if (msg.type === 'thinking') {
    content = content.trim();
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
      // Tool calls are dynamic based on the tool name
      const toolMatch = content.match(/\[Tool: ([^\]]+)\] (.*)/);
      if (toolMatch) {
        const [, rawName, args] = toolMatch;
        const name = simplifyToolName(rawName!);
        
        // Map tool names to 4-char labels and emojis
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
          // Now content is just the arguments, formatted cleanly
          content = `${COLORS.gray}${argStr}${COLORS.reset}`;
        } catch {
          content = `${COLORS.gray}${args}${COLORS.reset}`;
        }
      } else {
        typePrefix = `${COLORS.gray}🔧 TOOL${COLORS.reset}`;
      }
      break;
    case 'tool_result':
      // Skip standard tool results if they just say OK
      const resMatch = content.match(/\[Tool Result: ([^\]]+)\]/);
      if (resMatch) {
        // If it's a standard result, we return empty to skip it
        return '';
      }
      // If it has actual content (rare in this format), show it
      typePrefix = `${COLORS.gray}📄 RESL${COLORS.reset}`;
      content = `${COLORS.gray}${content}${COLORS.reset}`;
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
      content = `${COLORS.gray}${content}${COLORS.reset}`;
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
    case 'raw':
      // Raw type means the content is already fully formatted - return as-is
      return content;
  }
  
  if (!typePrefix) return `${tsPrefix}${labelPrefix}${content}`;

  // Avoid double prefixes (e.g. INFO INFO)
  const plainTypePrefix = stripAnsi(typePrefix).replace(/[^\x00-\x7F]/g, '').trim(); // "INFO", "DONE", etc.
  const plainContent = stripAnsi(content);
  if (plainContent.includes(` ${plainTypePrefix} `) || plainContent.startsWith(`${plainTypePrefix} `)) {
    // If content already has the prefix, try to strip it from content or just use content as is
    // For simplicity, if it's already there, we can just skip adding our typePrefix
    // but we still want the colors. This is tricky. 
    // Usually it's better to just return the content if it looks already formatted.
  }

  // A better way: if content starts with an emoji that matches our type, skip typePrefix
  const emojiMap: Record<string, string> = {
    'info': 'ℹ️',
    'success': '✅',
    'result': '✅',
    'warn': '⚠️',
    'error': '❌',
    'tool': '🔧',
    'thinking': '🤔',
    'user': '🧑',
    'assistant': '🤖'
  };
  
  const targetEmoji = emojiMap[msg.type];
  if (targetEmoji && plainContent.trim().startsWith(targetEmoji)) {
    return `${tsPrefix}${labelPrefix}${content}`;
  }

  // Handle separator lines - if content is just a repeat of ━ or ─, extend it
  const separatorMatch = content.match(/^([━─=]+)$/);
  if (separatorMatch) {
    const char = separatorMatch[1]![0]!;
    // Use a fixed width for now (80 is a good standard)
    // In a real terminal we could use process.stdout.columns
    const targetWidth = 80;
    content = char.repeat(targetWidth);
  }

  // Compact format (single line)
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
    const fullPrefix = `${tsPrefix}${labelPrefix}${paddedType} `;
    
    // For multi-line non-box content (like thinking), indent subsequent lines
    const lines = content.split('\n');
    if (lines.length > 1) {
      const indent = ' '.repeat(stripAnsi(tsPrefix + labelPrefix).length + 11);
      return lines.map((line, i) => i === 0 ? `${fullPrefix}${line}` : `${indent}${line}`).join('\n');
    }
    
    return `${fullPrefix}${content}`;
  }

  // Multi-line box format (only for user, assistant, system, result)
  // Emoji width is 2, so we need to account for that in indent calculation
  const lines = content.split('\n');
  const fullPrefix = `${tsPrefix}${labelPrefix}`;
  const strippedPrefix = stripAnsi(typePrefix);
  
  // Calculate visual width more accurately
  // Most emojis we use are 2 columns wide. 
  // If they are represented as surrogate pairs (length 2), strippedPrefix.length already includes 2.
  // If they are represented as single characters (length 1), we need to add 1.
  // The variation selector \uFE0F (length 1) doesn't add any visual width.
  let visualWidth = 0;
  for (let i = 0; i < strippedPrefix.length; i++) {
    const code = strippedPrefix.charCodeAt(i);
    if (code >= 0xD800 && code <= 0xDBFF) {
      // Surrogate pair - high surrogate
      visualWidth += 2;
      i++; // Skip low surrogate
    } else if (code === 0xFE0F) {
      // Variation selector - no width
      continue;
    } else if (code >= 0x2000 && code <= 0x32FF) {
      // BMP wide characters (like ✅, ❌, etc.)
      visualWidth += 2;
    } else {
      visualWidth += 1;
    }
  }
  
  const boxWidth = 80;
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
    let content: string;
    let type: string;
    
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

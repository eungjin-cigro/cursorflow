/**
 * Utility for formatting log messages for console display
 */

import { COLORS } from './log-constants';
import { ParsedMessage, stripAnsi } from './enhanced-logger';

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
  
  // Handle context (e.g. from logger.info)
  const effectiveLaneLabel = laneLabel || (context ? `[${context}]` : '');
  const labelPrefix = effectiveLaneLabel ? `${COLORS.magenta}${effectiveLaneLabel.padEnd(14)}${COLORS.reset} ` : ' '.repeat(15);
  
  let typePrefix = '';
  let content = msg.content;

  // Clean up wrapped prompts for user messages to hide internal instructions
  if (msg.type === 'user') {
    const contextMarker = '### 🛠 Environment & Context';
    const instructionsMarker = '### 📝 Final Instructions';
    
    if (content.includes(contextMarker)) {
      // Find the end of the prefix (---)
      const parts = content.split('---\n');
      if (parts.length >= 3) {
        // If it follows our wrapPrompt pattern: [PREFIX] --- [ORIGINAL] --- [SUFFIX]
        content = parts[1]!.trim();
      } else {
        // Fallback: just strip the headers if present
        content = content.split(contextMarker).pop() || content;
        content = content.split(instructionsMarker)[0] || content;
        content = content.replace(/^.*---\n/s, '').trim();
      }
    }
  }
  
  switch (msg.type) {
    case 'user':
      typePrefix = `${COLORS.cyan}🧑 USER    ${COLORS.reset}`;
      if (compact) content = content.replace(/\n/g, ' ').substring(0, 100) + (content.length > 100 ? '...' : '');
      break;
    case 'assistant':
      typePrefix = `${COLORS.green}🤖 ASST    ${COLORS.reset}`;
      if (compact) content = content.replace(/\n/g, ' ').substring(0, 100) + (content.length > 100 ? '...' : '');
      break;
    case 'tool':
      typePrefix = `${COLORS.yellow}🔧 TOOL    ${COLORS.reset}`;
      const toolMatch = content.match(/\[Tool: ([^\]]+)\] (.*)/);
      if (toolMatch) {
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
          content = `${COLORS.bold}${name}${COLORS.reset}(${argStr})`;
        } catch {
          content = `${COLORS.bold}${name}${COLORS.reset}: ${args}`;
        }
      }
      break;
    case 'tool_result':
      typePrefix = `${COLORS.gray}📄 RESL    ${COLORS.reset}`;
      const resMatch = content.match(/\[Tool Result: ([^\]]+)\]/);
      content = resMatch ? `${resMatch[1]} OK` : 'result';
      break;
    case 'result':
    case 'success':
      typePrefix = `${COLORS.green}✅ SUCCESS ${COLORS.reset}`;
      break;
    case 'system':
      typePrefix = `${COLORS.gray}⚙️  SYS     ${COLORS.reset}`;
      break;
    case 'thinking':
      typePrefix = `${COLORS.gray}🤔 THNK    ${COLORS.reset}`;
      if (compact) content = content.replace(/\n/g, ' ').substring(0, 100) + (content.length > 100 ? '...' : '');
      break;
    case 'info':
      typePrefix = `${COLORS.cyan}ℹ️  INFO    ${COLORS.reset}`;
      break;
    case 'warn':
      typePrefix = `${COLORS.yellow}⚠️  WARN    ${COLORS.reset}`;
      break;
    case 'error':
      typePrefix = `${COLORS.red}❌ ERROR   ${COLORS.reset}`;
      break;
  }
  
  if (!typePrefix) return `${tsPrefix}${labelPrefix}${content}`;

  if (compact) {
    return `${tsPrefix}${labelPrefix}${typePrefix} ${content}`;
  }

  // Multi-line box format (as seen in orchestrator)
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
      const toolName = Object.keys(json.tool_call)[0] || 'unknown';
      const args = json.tool_call[toolName]?.args || {};
      content = `[Tool: ${toolName}] ${JSON.stringify(args)}`;
      type = 'tool';
    } else if (json.type === 'tool_call' && json.subtype === 'completed') {
      const toolName = Object.keys(json.tool_call)[0] || 'unknown';
      content = `[Tool Result: ${toolName}]`;
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

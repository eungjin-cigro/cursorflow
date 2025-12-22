/**
 * Utility for formatting log messages for console display
 */

import * as logger from './logger';
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
  } = {}
): string {
  const { includeTimestamp = true, laneLabel = '', compact = false } = options;
  const ts = includeTimestamp ? new Date(msg.timestamp).toLocaleTimeString('en-US', { hour12: false }) : '';
  const tsPrefix = ts ? `${logger.COLORS.gray}[${ts}]${logger.COLORS.reset} ` : '';
  const labelPrefix = laneLabel ? `${logger.COLORS.magenta}${laneLabel.padEnd(12)}${logger.COLORS.reset} ` : '';
  
  let typePrefix = '';
  let content = msg.content;
  
  switch (msg.type) {
    case 'user':
      typePrefix = `${logger.COLORS.cyan}🧑 USER${logger.COLORS.reset}`;
      if (compact) content = content.replace(/\n/g, ' ').substring(0, 100) + (content.length > 100 ? '...' : '');
      break;
    case 'assistant':
      typePrefix = `${logger.COLORS.green}🤖 ASST${logger.COLORS.reset}`;
      if (compact) content = content.replace(/\n/g, ' ').substring(0, 100) + (content.length > 100 ? '...' : '');
      break;
    case 'tool':
      typePrefix = `${logger.COLORS.yellow}🔧 TOOL${logger.COLORS.reset}`;
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
          content = `${logger.COLORS.bold}${name}${logger.COLORS.reset}(${argStr})`;
        } catch {
          content = `${logger.COLORS.bold}${name}${logger.COLORS.reset}: ${args}`;
        }
      }
      break;
    case 'tool_result':
      typePrefix = `${logger.COLORS.gray}📄 RESL${logger.COLORS.reset}`;
      const resMatch = content.match(/\[Tool Result: ([^\]]+)\]/);
      content = resMatch ? `${resMatch[1]} OK` : 'result';
      break;
    case 'result':
      typePrefix = `${logger.COLORS.green}✅ DONE${logger.COLORS.reset}`;
      break;
    case 'system':
      typePrefix = `${logger.COLORS.gray}⚙️  SYS${logger.COLORS.reset}`;
      break;
    case 'thinking':
      typePrefix = `${logger.COLORS.gray}🤔 THNK${logger.COLORS.reset}`;
      if (compact) content = content.replace(/\n/g, ' ').substring(0, 100) + (content.length > 100 ? '...' : '');
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


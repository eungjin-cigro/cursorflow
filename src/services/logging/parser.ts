/**
 * Log Parser - Parse cursor-agent streaming output
 * 
 * Parses JSON output from cursor-agent and combines tokens into readable messages.
 */

import { ParsedMessage, MessageType } from '../../types/logging';

/**
 * Streaming message parser for cursor-agent output
 */
export class StreamingMessageParser {
  private currentMessage = '';
  private currentRole = '';
  private messageStartTime = 0;
  private onMessage: (msg: ParsedMessage) => void;

  constructor(onMessage: (msg: ParsedMessage) => void) {
    this.onMessage = onMessage;
  }

  /**
   * Parse a line of JSON output
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
        this.emitMessage({
          type: 'system',
          role: 'system',
          content: `[System] Model: ${json.model || 'unknown'}, Mode: ${json.permissionMode || 'default'}`,
          timestamp: json.timestamp_ms || Date.now(),
        });
        break;

      case 'user':
        if (json.message?.content) {
          const textContent = this.extractTextContent(json.message.content);
          this.emitMessage({
            type: 'user',
            role: 'user',
            content: textContent,
            timestamp: json.timestamp_ms || Date.now(),
          });
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
        if (json.subtype === 'started' && json.tool_call) {
          const toolName = Object.keys(json.tool_call)[0] || 'unknown';
          const toolArgs = json.tool_call[toolName]?.args || {};
          
          this.flush();
          
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
        break;
    }
  }

  private extractTextContent(content: any[]): string {
    return content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('');
  }

  /**
   * Flush accumulated message
   */
  flush(): void {
    if (this.currentMessage && this.currentRole) {
      this.emitMessage({
        type: this.currentRole as MessageType,
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

/**
 * Parse a raw JSON log file line by line
 */
export function parseJsonLogLine(line: string): ParsedMessage | null {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('{')) return null;

  try {
    const json = JSON.parse(trimmed);
    return parseJsonToMessage(json);
  } catch {
    return null;
  }
}

function parseJsonToMessage(json: any): ParsedMessage | null {
  const type = json.type;
  if (!type) return null;

  let messageType: MessageType = 'system';
  let content = '';

  if (type === 'thinking' && (json.text || json.thought)) {
    content = json.text || json.thought;
    messageType = 'thinking';
  } else if (type === 'assistant' && json.message?.content) {
    content = json.message.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('');
    messageType = 'assistant';
  } else if (type === 'user' && json.message?.content) {
    content = json.message.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('');
    messageType = 'user';
  } else if (type === 'tool_call' && json.subtype === 'started') {
    const toolName = Object.keys(json.tool_call)[0] || 'unknown';
    const args = json.tool_call[toolName]?.args || {};
    content = `[Tool: ${toolName}] ${JSON.stringify(args)}`;
    messageType = 'tool';
  } else if (type === 'tool_call' && json.subtype === 'completed') {
    const toolName = Object.keys(json.tool_call)[0] || 'unknown';
    content = `[Tool Result: ${toolName}]`;
    messageType = 'tool_result';
  } else if (type === 'result') {
    content = json.result || 'Task completed';
    messageType = 'result';
  } else {
    return null;
  }

  return {
    type: messageType,
    role: messageType,
    content,
    timestamp: json.timestamp_ms || Date.now(),
  };
}


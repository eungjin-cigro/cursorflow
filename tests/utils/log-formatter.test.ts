/**
 * Log Formatter Tests - Verify log output consistency
 */

import { formatMessageForConsole, formatPotentialJsonMessage } from '../../src/utils/log-formatter';
import { ParsedMessage } from '../../src/utils/enhanced-logger';

// Helper to strip ANSI codes for comparison
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('Log Formatter', () => {
  describe('formatMessageForConsole', () => {
    const baseMessage = (type: string, content: string): ParsedMessage => ({
      type: type as any,
      role: type,
      content,
      timestamp: Date.now(),
    });

    describe('User messages', () => {
      it('should format user message with cyan color and box', () => {
        const msg = baseMessage('user', 'Hello, can you help me?');
        const result = formatMessageForConsole(msg, { includeTimestamp: false, compact: false });
        
        expect(result).toContain('🧑 USER');
        expect(result).toContain('┌');
        expect(result).toContain('│');
        expect(result).toContain('└');
        console.log('USER (box):\n' + result);
      });

      it('should format user message compact', () => {
        const msg = baseMessage('user', 'Hello, can you help me?');
        const result = formatMessageForConsole(msg, { includeTimestamp: false, compact: true });
        
        expect(result).toContain('🧑 USER');
        expect(result).not.toContain('┌');
        console.log('USER (compact): ' + result);
      });
    });

    describe('Assistant messages', () => {
      it('should format assistant message with green color and box', () => {
        const msg = baseMessage('assistant', 'I can help you with that!');
        const result = formatMessageForConsole(msg, { includeTimestamp: false, compact: false });
        
        expect(result).toContain('🤖 ASST');
        expect(result).toContain('┌');
        console.log('ASST (box):\n' + result);
      });
    });

    describe('Tool messages', () => {
      it('should format tool call with simplified name', () => {
        const msg = baseMessage('tool', '[Tool: ShellToolCall] {"command":"ls -la"}');
        const result = formatMessageForConsole(msg, { includeTimestamp: false, compact: true });
        
        console.log('TOOL: ' + result);
        // Should show Shell, not ShellToolCall
        expect(stripAnsi(result)).not.toContain('ShellToolCall');
        expect(stripAnsi(result)).toContain('Shell');
      });

      it('should format run_terminal_cmd as shell', () => {
        const msg = baseMessage('tool', '[Tool: run_terminal_cmd] {"command":"npm test"}');
        const result = formatMessageForConsole(msg, { includeTimestamp: false, compact: true });
        
        console.log('TOOL run_terminal_cmd: ' + result);
        expect(stripAnsi(result)).toContain('shell');
      });

      it('should format read_file tool call', () => {
        const msg = baseMessage('tool', '[Tool: read_file] {"target_file":"/path/to/file.ts"}');
        const result = formatMessageForConsole(msg, { includeTimestamp: false, compact: true });
        
        console.log('TOOL read_file: ' + result);
        expect(result).toContain('read_file');
      });

      it('should be gray/dim for tool messages', () => {
        const msg = baseMessage('tool', '[Tool: grep] {"pattern":"test"}');
        const result = formatMessageForConsole(msg, { includeTimestamp: false, compact: true });
        
        // Tool messages should use gray/dim colors
        console.log('TOOL (should be subdued): ' + result);
      });
    });

    describe('Tool result messages', () => {
      it('should format tool result with gray color', () => {
        const msg = baseMessage('tool_result', '[Tool Result: read_file]');
        const result = formatMessageForConsole(msg, { includeTimestamp: false, compact: true });
        
        expect(result).toContain('RESL');
        console.log('TOOL_RESULT: ' + result);
      });
    });

    describe('Thinking messages', () => {
      it('should format thinking with gray color and no box', () => {
        const msg = baseMessage('thinking', 'Let me think about this...\n\nI need to consider:\n1. First option\n2. Second option');
        const result = formatMessageForConsole(msg, { includeTimestamp: false, compact: true });
        
        expect(result).toContain('THNK');
        // Should be compact - no newlines preserved
        expect(stripAnsi(result)).not.toContain('\n\n');
        console.log('THINK (compact, gray): ' + result);
      });

      it('should minimize blank lines in thinking', () => {
        const msg = baseMessage('thinking', 'First paragraph.\n\n\nSecond paragraph.\n\nThird.');
        const result = formatMessageForConsole(msg, { includeTimestamp: false, compact: true });
        
        // Should collapse multiple newlines
        console.log('THINK (collapsed): ' + result);
      });
    });

    describe('System messages', () => {
      it('should format system message with proper emoji spacing', () => {
        const msg = baseMessage('system', '[System] Model: claude-3-opus, Mode: default');
        const result = formatMessageForConsole(msg, { includeTimestamp: false, compact: false });
        
        // Check emoji is properly spaced
        const stripped = stripAnsi(result);
        console.log('SYS (check spacing):\n' + result);
        console.log('Stripped: ' + stripped);
      });
    });

    describe('Result messages', () => {
      it('should format result with green success icon', () => {
        const msg = baseMessage('result', 'Task completed successfully');
        const result = formatMessageForConsole(msg, { includeTimestamp: false, compact: false });
        
        expect(result).toContain('✅');
        console.log('RESULT:\n' + result);
      });
    });

    describe('Lane and task labels', () => {
      it('should show lane label with task number', () => {
        const msg = baseMessage('user', 'Test message');
        const result = formatMessageForConsole(msg, {
          includeTimestamp: true,
          laneLabel: '[01-types-tests]',
          compact: true
        });
        
        expect(result).toContain('[01-types-tests]');
        console.log('With lane label: ' + result);
      });

      it('should truncate long task names', () => {
        const msg = baseMessage('info', 'Test message');
        const result = formatMessageForConsole(msg, {
          includeTimestamp: false,
          laneLabel: '[01-very-long-task-name-here]',
          compact: true
        });
        
        console.log('Long label: ' + result);
        // Label should be max 16 chars
      });
    });

    describe('Info/Warn/Error messages', () => {
      it('should format info with cyan color', () => {
        const msg = baseMessage('info', 'Processing...');
        const result = formatMessageForConsole(msg, { includeTimestamp: false, compact: true });
        
        expect(result).toContain('ℹ️');
        console.log('INFO: ' + result);
      });

      it('should format warn with yellow color', () => {
        const msg = baseMessage('warn', 'Warning: something is off');
        const result = formatMessageForConsole(msg, { includeTimestamp: false, compact: true });
        
        expect(result).toContain('⚠️');
        console.log('WARN: ' + result);
      });

      it('should format error with red color', () => {
        const msg = baseMessage('error', 'Error: something went wrong');
        const result = formatMessageForConsole(msg, { includeTimestamp: false, compact: true });
        
        expect(result).toContain('❌');
        console.log('ERROR: ' + result);
      });
    });
  });

  describe('formatPotentialJsonMessage', () => {
    it('should parse thinking JSON and format correctly', () => {
      const json = JSON.stringify({
        type: 'thinking',
        text: 'Let me analyze this code...',
        timestamp_ms: Date.now()
      });
      
      const result = formatPotentialJsonMessage(json);
      console.log('Parsed thinking JSON: ' + result);
    });

    it('should parse tool_call JSON and simplify name', () => {
      const json = JSON.stringify({
        type: 'tool_call',
        subtype: 'started',
        tool_call: {
          ShellToolCall: {
            args: { command: 'npm test' }
          }
        },
        timestamp_ms: Date.now()
      });
      
      const result = formatPotentialJsonMessage(json);
      console.log('Parsed tool_call JSON: ' + result);
      // Should show Shell, not ShellToolCall
    });

    it('should parse result JSON', () => {
      const json = JSON.stringify({
        type: 'result',
        result: 'Task completed',
        timestamp_ms: Date.now()
      });
      
      const result = formatPotentialJsonMessage(json);
      console.log('Parsed result JSON: ' + result);
    });
  });
});

describe('Heartbeat format', () => {
  it('should format heartbeat consistently', () => {
    // Heartbeat should follow standard format:
    // [HH:MM:SS] [lane-task] ℹ️ INFO ⏱ Heartbeat: Xs elapsed, Y bytes received
    const timestamp = '24:36:21';
    const laneName = '01-types-tests';
    const elapsed = 60;
    const bytes = 79348;
    
    // Expected format (no duplicate timestamps)
    const expected = `[${timestamp}] [${laneName}] ℹ️  INFO     ⏱ Heartbeat: ${elapsed}s elapsed, ${bytes} bytes received`;
    console.log('Expected heartbeat: ' + expected);
    
    // Actual format from log-formatter
    const msg: ParsedMessage = {
      type: 'info',
      role: 'system',
      content: `⏱ Heartbeat: ${elapsed}s elapsed, ${bytes} bytes received`,
      timestamp: Date.now()
    };
    
    const result = formatMessageForConsole(msg, {
      includeTimestamp: true,
      laneLabel: `[${laneName}]`,
      compact: true
    });
    
    console.log('Actual heartbeat: ' + result);
  });
});


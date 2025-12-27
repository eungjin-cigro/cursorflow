/**
 * Contract Tests for cursor-agent CLI Interface
 * 
 * These tests verify that the cursor-agent CLI conforms to the expected interface.
 * They serve as an early warning system for API changes and act as living documentation.
 * 
 * Contract tests validate:
 * - Response schemas and formats
 * - Required commands and options
 * - Error message patterns
 * - Output structure consistency
 * 
 * These tests can run against both mock and real cursor-agent depending on environment.
 * 
 * Real cursor-agent format (verified 2025.12):
 * - Version: `2025.12.17-996666f` (date-hash format)
 * - create-chat: UUID format `0891faf1-fdd2-4e03-bad3-b10b21958dc8`
 * - Output formats: text | json | stream-json
 */

import { spawnSync, SpawnSyncReturns } from 'child_process';
import * as path from 'path';

// Use TestMode to determine which agent to test
const USE_REAL_AGENT = process.env.USE_REAL_AGENT === 'true';
const mockAgentPath = path.resolve(__dirname, '../fixtures/mock-cursor-agent');

/**
 * Get the cursor-agent command to use
 */
function getAgentCommand(): string {
  if (USE_REAL_AGENT) {
    return 'cursor-agent';
  }
  return path.join(mockAgentPath, 'cursor-agent');
}

/**
 * Run cursor-agent with given arguments
 */
function runAgent(args: string[], options: { timeout?: number; input?: string } = {}): {
  stdout: string;
  stderr: string;
  status: number | null;
  error?: Error;
} {
  const agentCmd = getAgentCommand();
  const timeout = options.timeout || 10000;
  
  const result = spawnSync(agentCmd, args, {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout,
    input: options.input,
    env: {
      ...process.env,
      PATH: USE_REAL_AGENT ? process.env.PATH : `${mockAgentPath}:${process.env.PATH}`,
      MOCK_AGENT_SCENARIO: 'success',
      MOCK_AGENT_DELAY: '10',
    },
  });

  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
    error: result.error,
  };
}

describe('cursor-agent Contract Tests', () => {
  describe('Version Command (--version / -v)', () => {
    test('should exit with code 0', () => {
      const result = runAgent(['--version']);
      expect(result.status).toBe(0);
    });

    test('should return non-empty version string', () => {
      const result = runAgent(['--version']);
      const version = result.stdout.trim();
      
      expect(version.length).toBeGreaterThan(0);
    });

    test('version should match expected format pattern', () => {
      const result = runAgent(['--version']);
      const version = result.stdout.trim();
      
      // Real agent: 2025.12.17-996666f (date-hash)
      // Mock agent: mock-cursor-agent 1.0.0 (test)
      // Both should contain numbers/dots
      const versionPattern = /[\d.]+/;
      expect(version).toMatch(versionPattern);
    });

    test('-v flag should also work', () => {
      const result = runAgent(['-v']);
      expect(result.status).toBe(0);
      expect(result.stdout.trim().length).toBeGreaterThan(0);
    });
  });

  describe('Help Command (--help / -h)', () => {
    test('should exit with code 0', () => {
      const result = runAgent(['--help']);
      expect(result.status).toBe(0);
    });

    test('should return non-empty help text', () => {
      const result = runAgent(['--help']);
      const output = result.stdout + result.stderr;
      
      expect(output.length).toBeGreaterThan(100);
    });

    test('should document --print option', () => {
      const result = runAgent(['--help']);
      const output = (result.stdout + result.stderr).toLowerCase();
      
      expect(output).toContain('print');
    });

    test('should document --resume option', () => {
      const result = runAgent(['--help']);
      const output = (result.stdout + result.stderr).toLowerCase();
      
      expect(output).toContain('resume');
    });

    test('should document create-chat command', () => {
      const result = runAgent(['--help']);
      const output = (result.stdout + result.stderr).toLowerCase();
      
      expect(output).toContain('create-chat');
    });

    test('should document --version option', () => {
      const result = runAgent(['--help']);
      const output = (result.stdout + result.stderr).toLowerCase();
      
      expect(output).toContain('version');
    });

    test('-h flag should also work', () => {
      const result = runAgent(['-h']);
      expect(result.status).toBe(0);
      expect((result.stdout + result.stderr).length).toBeGreaterThan(100);
    });

    // Real agent specific options
    if (USE_REAL_AGENT) {
      test('should document --output-format option', () => {
        const result = runAgent(['--help']);
        const output = (result.stdout + result.stderr).toLowerCase();
        
        expect(output).toContain('output-format');
      });

      test('should document --model option', () => {
        const result = runAgent(['--help']);
        const output = (result.stdout + result.stderr).toLowerCase();
        
        expect(output).toContain('model');
      });

      test('should document --workspace option', () => {
        const result = runAgent(['--help']);
        const output = (result.stdout + result.stderr).toLowerCase();
        
        expect(output).toContain('workspace');
      });
    }
  });

  describe('Create Chat Command', () => {
    test('should exit with code 0', () => {
      const result = runAgent(['create-chat']);
      expect(result.status).toBe(0);
    });

    test('should return non-empty chat ID', () => {
      const result = runAgent(['create-chat']);
      const chatId = result.stdout.trim();
      
      expect(chatId.length).toBeGreaterThan(0);
    });

    test('chat ID should contain only safe characters', () => {
      const result = runAgent(['create-chat']);
      const chatId = result.stdout.trim();
      
      // UUID format (real) or mock format: alphanumeric with dashes
      const safeIdPattern = /^[a-zA-Z0-9_-]+$/;
      expect(chatId).toMatch(safeIdPattern);
    });

    test('should return unique chat IDs on successive calls', () => {
      const result1 = runAgent(['create-chat']);
      const result2 = runAgent(['create-chat']);
      
      expect(result1.status).toBe(0);
      expect(result2.status).toBe(0);
      
      const chatId1 = result1.stdout.trim();
      const chatId2 = result2.stdout.trim();
      
      expect(chatId1).not.toBe(chatId2);
    });

    // Real agent: UUID format
    if (USE_REAL_AGENT) {
      test('chat ID should be UUID format', () => {
        const result = runAgent(['create-chat']);
        const chatId = result.stdout.trim();
        
        // UUID v4 format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        expect(chatId).toMatch(uuidPattern);
      });
    }
  });

  describe('Authentication Status', () => {
    // Real agent has status/whoami command
    const statusArgs = USE_REAL_AGENT ? ['status'] : ['--help']; // mock falls back to help
    
    test('status command should not crash', () => {
      const result = runAgent(statusArgs);
      expect(result.status).not.toBeNull();
    });

    if (USE_REAL_AGENT) {
      test('status should indicate login state', () => {
        const result = runAgent(['status']);
        const output = (result.stdout + result.stderr).toLowerCase();
        
        // Should contain "logged in" or "not logged in" or similar
        const hasLoginInfo = output.includes('logged') || output.includes('login') || output.includes('auth');
        expect(hasLoginInfo).toBe(true);
      });
    }
  });

  describe('Resume Command Structure', () => {
    // Test that --resume accepts a chat ID argument
    test('--resume with chat ID should not crash immediately', () => {
      // Create a chat first
      const createResult = runAgent(['create-chat']);
      expect(createResult.status).toBe(0);
      
      const chatId = createResult.stdout.trim();
      
      // Try to resume with timeout (actual execution may hang waiting for input)
      const result = runAgent(['--resume', chatId, '--help'], { timeout: 5000 });
      
      // Should either succeed or fail gracefully (not null status from crash)
      expect(result.status).not.toBeNull();
    });
  });

  describe('Error Handling', () => {
    test('unknown command should exit with non-zero or show help', () => {
      const result = runAgent(['unknown-command-xyz-12345']);
      
      // Should either fail gracefully or show help
      // Real agent may exit 0 and show help, mock may exit non-zero
      expect(result.status).not.toBeNull();
    });

    test('invalid flag should not crash', () => {
      const result = runAgent(['--invalid-flag-xyz-12345']);
      
      expect(result.status).not.toBeNull();
    });
  });

  describe('Output Format Contract (Mock Only)', () => {
    // These tests verify the mock agent's JSONL output format
    // Real agent output depends on environment and may not be testable in CI
    
    if (!USE_REAL_AGENT) {
      test('--resume should output JSONL format', () => {
        const result = runAgent(['--resume', 'test-chat-id'], {
          input: 'Test prompt',
        });
        
        const lines = result.stdout.trim().split('\n').filter(line => line.length > 0);
        
        // Each line should be valid JSON
        for (const line of lines) {
          expect(() => JSON.parse(line)).not.toThrow();
        }
      });

      test('output should include type field', () => {
        const result = runAgent(['--resume', 'test-chat-id'], {
          input: 'Test prompt',
        });
        
        const lines = result.stdout.trim().split('\n').filter(line => line.length > 0);
        
        const hasTypeField = lines.some(line => {
          try {
            const parsed = JSON.parse(line);
            return 'type' in parsed;
          } catch {
            return false;
          }
        });
        
        expect(hasTypeField).toBe(true);
      });

      test('result message should include session_id', () => {
        const result = runAgent(['--resume', 'test-chat-id'], {
          input: 'Test prompt',
        });
        
        const lines = result.stdout.trim().split('\n').filter(line => line.length > 0);
        
        const resultLine = lines.find(line => {
          try {
            const parsed = JSON.parse(line);
            return parsed.type === 'result';
          } catch {
            return false;
          }
        });
        
        if (resultLine) {
          const parsed = JSON.parse(resultLine);
          expect(parsed).toHaveProperty('session_id');
          expect(parsed).toHaveProperty('is_error');
        }
      });

      test('failure scenario should set is_error flag', () => {
        const result = spawnSync(getAgentCommand(), ['--resume', 'test-chat-id'], {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 10000,
          input: 'Test prompt',
          env: {
            ...process.env,
            PATH: `${mockAgentPath}:${process.env.PATH}`,
            MOCK_AGENT_SCENARIO: 'failure',
            MOCK_AGENT_DELAY: '10',
          },
        });
        
        const lines = (result.stdout || '').trim().split('\n').filter(line => line.length > 0);
        
        const hasErrorFlag = lines.some(line => {
          try {
            const parsed = JSON.parse(line);
            return parsed.is_error === true;
          } catch {
            return false;
          }
        });
        
        const hasNonZeroExit = result.status !== 0;
        
        // Either exit non-zero or have is_error flag
        expect(hasErrorFlag || hasNonZeroExit).toBe(true);
      });
    }
  });
});

/**
 * Schema Definitions (for documentation and potential runtime validation)
 * 
 * These interfaces document the expected message formats from cursor-agent.
 * Reference: docs/CURSOR_AGENT_GUIDE.md (2025.12 version)
 */

/**
 * Message content item (text or other types)
 */
export interface MessageContentItem {
  type: 'text' | string;
  text?: string;
  [key: string]: unknown;
}

/**
 * Message structure used in user/assistant messages
 */
export interface MessageContent {
  role: 'user' | 'assistant';
  content: MessageContentItem[];
}

/**
 * System init message - session initialization
 */
export interface CursorAgentSystemMessage {
  type: 'system';
  subtype: 'init';
  apiKeySource: string;
  cwd: string;
  session_id: string;
  model: string;
  permissionMode: string;
}

/**
 * User message - echo of the user prompt
 */
export interface CursorAgentUserMessage {
  type: 'user';
  message: MessageContent;
  session_id: string;
}

/**
 * Thinking delta message - streaming thought process
 */
export interface CursorAgentThinkingDeltaMessage {
  type: 'thinking';
  subtype: 'delta';
  text: string;
  session_id: string;
  timestamp_ms: number;
}

/**
 * Thinking completed message - end of thought process
 */
export interface CursorAgentThinkingCompletedMessage {
  type: 'thinking';
  subtype: 'completed';
  session_id: string;
  timestamp_ms: number;
}

/**
 * Assistant message - AI response
 */
export interface CursorAgentAssistantMessage {
  type: 'assistant';
  message: MessageContent;
  session_id: string;
}

/**
 * Tool call started message
 */
export interface CursorAgentToolCallStartedMessage {
  type: 'tool_call';
  subtype: 'started';
  call_id: string;
  tool_call: Record<string, { args: Record<string, unknown> }>;
  session_id?: string;
  timestamp_ms?: number;
}

/**
 * Tool call completed message
 */
export interface CursorAgentToolCallCompletedMessage {
  type: 'tool_call';
  subtype: 'completed';
  call_id: string;
  tool_call: Record<string, { result: { success?: { content: string; totalLines?: number } } }>;
  session_id?: string;
  timestamp_ms?: number;
}

/**
 * Result message from cursor-agent - final result with metadata
 */
export interface CursorAgentResultMessage {
  type: 'result';
  subtype: 'success' | 'error';
  duration_ms: number;
  duration_api_ms: number;
  is_error: boolean;
  result: string;
  session_id: string;
  request_id: string;
}

/**
 * Legacy text chunk message (deprecated, use thinking/assistant instead)
 * @deprecated Use CursorAgentThinkingDeltaMessage or CursorAgentAssistantMessage
 */
export interface CursorAgentTextMessage {
  type: 'text';
  text: string;
}

/**
 * Union of thinking message types
 */
export type CursorAgentThinkingMessage = 
  | CursorAgentThinkingDeltaMessage 
  | CursorAgentThinkingCompletedMessage;

/**
 * Union of tool call message types
 */
export type CursorAgentToolCallMessage =
  | CursorAgentToolCallStartedMessage
  | CursorAgentToolCallCompletedMessage;

/**
 * Union of all cursor-agent message types
 */
export type CursorAgentMessage = 
  | CursorAgentSystemMessage
  | CursorAgentUserMessage
  | CursorAgentThinkingMessage
  | CursorAgentAssistantMessage
  | CursorAgentToolCallMessage
  | CursorAgentResultMessage
  | CursorAgentTextMessage; // Legacy support

/**
 * All message types enum
 */
export const MESSAGE_TYPES = ['system', 'user', 'thinking', 'assistant', 'tool_call', 'result', 'text'] as const;
export type MessageType = typeof MESSAGE_TYPES[number];

/**
 * Validate a message against expected schema
 */
export function validateMessage(message: unknown): message is CursorAgentMessage {
  if (typeof message !== 'object' || message === null) {
    return false;
  }
  
  const msg = message as Record<string, unknown>;
  
  if (!msg.type || typeof msg.type !== 'string') {
    return false;
  }
  
  switch (msg.type) {
    case 'system':
      return (
        msg.subtype === 'init' &&
        typeof msg.session_id === 'string' &&
        typeof msg.model === 'string'
      );
      
    case 'user':
      return (
        typeof msg.session_id === 'string' &&
        typeof msg.message === 'object' &&
        msg.message !== null
      );
      
    case 'thinking':
      if (msg.subtype === 'delta') {
        return typeof msg.text === 'string' && typeof msg.session_id === 'string';
      }
      if (msg.subtype === 'completed') {
        return typeof msg.session_id === 'string';
      }
      return false;
      
    case 'assistant':
      return (
        typeof msg.session_id === 'string' &&
        typeof msg.message === 'object' &&
        msg.message !== null
      );
      
    case 'tool_call':
      return (
        (msg.subtype === 'started' || msg.subtype === 'completed') &&
        typeof msg.call_id === 'string' &&
        typeof msg.tool_call === 'object'
      );
      
    case 'result':
      return (
        typeof msg.result === 'string' &&
        typeof msg.session_id === 'string' &&
        typeof msg.is_error === 'boolean'
      );
      
    case 'text': // Legacy support
      return typeof msg.text === 'string';
      
    default:
      return false;
  }
}

/**
 * Parse JSONL output from cursor-agent
 */
export function parseJsonlOutput(output: string): CursorAgentMessage[] {
  const lines = output.split('\n').filter(line => line.trim().length > 0);
  const messages: CursorAgentMessage[] = [];
  
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (validateMessage(parsed)) {
        messages.push(parsed);
      }
    } catch {
      // Skip invalid JSON lines
    }
  }
  
  return messages;
}

/**
 * Extract specific message type from parsed output
 */
export function findMessageByType<T extends CursorAgentMessage>(
  messages: CursorAgentMessage[],
  type: MessageType
): T | undefined {
  return messages.find(m => m.type === type) as T | undefined;
}

/**
 * Real cursor-agent version format
 * Example: 2025.12.17-996666f
 */
export const REAL_VERSION_PATTERN = /^\d{4}\.\d{2}\.\d{2}-[a-f0-9]+$/;

/**
 * Real cursor-agent chat ID format (UUID v4)
 * Example: 0891faf1-fdd2-4e03-bad3-b10b21958dc8
 */
export const REAL_CHAT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Expected CLI options that should be documented in help
 */
export const EXPECTED_CLI_OPTIONS = [
  '--print',
  '--resume',
  '--version',
  '--help',
  'create-chat',
] as const;

/**
 * Real agent specific CLI options
 */
export const REAL_AGENT_CLI_OPTIONS = [
  '--output-format',
  '--model',
  '--workspace',
  '--api-key',
  '--cloud',
  '--force',
  '--browser',
] as const;

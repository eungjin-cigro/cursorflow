/**
 * Agent-related type definitions
 */

export interface DependencyPolicy {
  allowDependencyChange: boolean;
  lockfileReadOnly: boolean;
}

export interface DependencyRequestPlan {
  reason: string;
  changes: string[];
  commands: string[];
  notes?: string;
}

export interface AgentSendResult {
  /** Whether the operation succeeded */
  ok: boolean;
  /** Process exit code */
  exitCode: number;
  /** Error message if failed */
  error?: string;
  /** Session ID from cursor-agent */
  sessionId?: string;
  /** Result text from the agent response */
  resultText?: string;
  /** Total execution time in milliseconds */
  durationMs?: number;
  /** API call time in milliseconds */
  durationApiMs?: number;
  /** Unique request ID for debugging */
  requestId?: string;
  /** Result subtype: 'success' or 'error' */
  subtype?: 'success' | 'error';
  /** Model used for this request */
  model?: string;
}


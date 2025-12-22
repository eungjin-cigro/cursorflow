/**
 * Failure Policy - Centralized management of failure cases and recovery actions
 */

import * as logger from '../utils/logger';

export enum FailureType {
  STALL_IDLE = 'STALL_IDLE',
  AGENT_UNAVAILABLE = 'AGENT_UNAVAILABLE',
  AGENT_AUTH_ERROR = 'AGENT_AUTH_ERROR',
  AGENT_RATE_LIMIT = 'AGENT_RATE_LIMIT',
  DEPENDENCY_BLOCK = 'DEPENDENCY_BLOCK',
  REVIEW_FAIL = 'REVIEW_FAIL',
  UNKNOWN_CRASH = 'UNKNOWN_CRASH',
}

export enum RecoveryAction {
  CONTINUE_SIGNAL = 'CONTINUE_SIGNAL',
  RETRY_TASK = 'RETRY_TASK',
  RESTART_LANE = 'RESTART_LANE',
  ABORT_LANE = 'ABORT_LANE',
  WAIT_FOR_USER = 'WAIT_FOR_USER',
  NONE = 'NONE',
}

export interface FailureAnalysis {
  type: FailureType;
  action: RecoveryAction;
  message: string;
  isTransient: boolean;
}

/**
 * Analyze an error message or state to determine the failure type and recovery action
 */
export function analyzeFailure(error: string | null | undefined, context?: { 
  exitCode?: number; 
  stallPhase?: number;
  idleTimeMs?: number;
  retryCount?: number;
}): FailureAnalysis {
  const msg = error || '';
  
  // 1. Check for specific agent errors (ConnectError: [unavailable])
  if (msg.includes('ConnectError') && msg.includes('[unavailable]')) {
    return {
      type: FailureType.AGENT_UNAVAILABLE,
      action: (context?.retryCount || 0) < 3 ? RecoveryAction.RETRY_TASK : RecoveryAction.RESTART_LANE,
      message: 'Agent service is temporarily unavailable. Retrying with a new agent session.',
      isTransient: true,
    };
  }

  // 2. Authentication errors
  if (msg.includes('not authenticated') || msg.includes('login') || msg.includes('auth')) {
    return {
      type: FailureType.AGENT_AUTH_ERROR,
      action: RecoveryAction.WAIT_FOR_USER,
      message: 'Cursor authentication failed. Please sign in to Cursor IDE.',
      isTransient: false,
    };
  }

  // 3. Rate limits
  if (msg.includes('rate limit') || msg.includes('quota')) {
    return {
      type: FailureType.AGENT_RATE_LIMIT,
      action: RecoveryAction.WAIT_FOR_USER,
      message: 'API rate limit or quota exceeded. Please check your Cursor subscription.',
      isTransient: true,
    };
  }

  // 4. Dependency blocks (Exit Code 2)
  if (context?.exitCode === 2 || msg.includes('DEPENDENCY_CHANGE_REQUIRED')) {
    return {
      type: FailureType.DEPENDENCY_BLOCK,
      action: RecoveryAction.NONE, // Handled by orchestrator resolve logic
      message: 'Lane is blocked on dependency change request.',
      isTransient: false,
    };
  }

  // 5. Stalls (handled by phase)
  if (context?.stallPhase !== undefined) {
    if (context.stallPhase === 0) {
      return {
        type: FailureType.STALL_IDLE,
        action: RecoveryAction.CONTINUE_SIGNAL,
        message: `Lane idle for ${Math.round((context.idleTimeMs || 0) / 1000)}s. Sending continue...`,
        isTransient: true,
      };
    } else if (context.stallPhase === 1) {
      return {
        type: FailureType.STALL_IDLE,
        action: RecoveryAction.RESTART_LANE,
        message: 'Lane still idle after continue signal. Restarting lane...',
        isTransient: true,
      };
    } else {
      return {
        type: FailureType.STALL_IDLE,
        action: RecoveryAction.ABORT_LANE,
        message: 'Lane stalled again after restart. Aborting.',
        isTransient: false,
      };
    }
  }

  // 6. Default fallback
  return {
    type: FailureType.UNKNOWN_CRASH,
    action: RecoveryAction.ABORT_LANE,
    message: msg || `Process exited with code ${context?.exitCode}`,
    isTransient: false,
  };
}

/**
 * Log the failure analysis to the appropriate channels
 */
export function logFailure(laneName: string, analysis: FailureAnalysis, loggerInstance: any = logger): void {
  const label = `[${laneName}]`;
  const actionLabel = analysis.action === RecoveryAction.NONE ? '' : ` -> Action: ${analysis.action}`;
  
  if (analysis.isTransient) {
    loggerInstance.warn(`${label} ${analysis.type}: ${analysis.message}${actionLabel}`);
  } else {
    loggerInstance.error(`${label} ${analysis.type}: ${analysis.message}${actionLabel}`);
  }
}

/**
 * Executes a function with retry logic based on failure analysis
 */
export async function withRetry<T>(
  laneName: string,
  fn: () => Promise<T>,
  isError: (res: T) => { ok: boolean; error?: string },
  options: { maxRetries?: number; delayMs?: number } = {}
): Promise<T> {
  const maxRetries = options.maxRetries || 3;
  const delayMs = options.delayMs || 5000;
  let attempt = 0;

  while (true) {
    const result = await fn();
    const status = isError(result);

    if (status.ok) return result;

    const analysis = analyzeFailure(status.error, { retryCount: attempt });
    
    if (analysis.action === RecoveryAction.RETRY_TASK && attempt < maxRetries) {
      attempt++;
      logFailure(laneName, analysis);
      logger.info(`Attempt ${attempt}/${maxRetries} failed. Retrying in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
      continue;
    }

    return result;
  }
}


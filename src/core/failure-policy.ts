/**
 * Failure Policy - Centralized management of failure cases and recovery actions
 * 
 * Features:
 * - Multi-layer stall detection
 * - Circuit breaker integration
 * - Configurable recovery strategies
 */

import * as logger from '../utils/logger';
import { getCircuitBreaker, CircuitState } from '../utils/retry';

export enum FailureType {
  STALL_IDLE = 'STALL_IDLE',
  STALL_NO_PROGRESS = 'STALL_NO_PROGRESS',
  STALL_ZERO_BYTES = 'STALL_ZERO_BYTES',
  AGENT_UNAVAILABLE = 'AGENT_UNAVAILABLE',
  AGENT_AUTH_ERROR = 'AGENT_AUTH_ERROR',
  AGENT_RATE_LIMIT = 'AGENT_RATE_LIMIT',
  AGENT_TIMEOUT = 'AGENT_TIMEOUT',
  AGENT_NO_RESPONSE = 'AGENT_NO_RESPONSE',
  ZOMBIE_PROCESS = 'ZOMBIE_PROCESS',
  DEPENDENCY_BLOCK = 'DEPENDENCY_BLOCK',
  DEPENDENCY_FAILED = 'DEPENDENCY_FAILED',
  DEPENDENCY_TIMEOUT = 'DEPENDENCY_TIMEOUT',
  GIT_ERROR = 'GIT_ERROR',
  GIT_PUSH_REJECTED = 'GIT_PUSH_REJECTED',
  MERGE_CONFLICT = 'MERGE_CONFLICT',
  NETWORK_ERROR = 'NETWORK_ERROR',
  STATE_CORRUPTION = 'STATE_CORRUPTION',
  UNKNOWN_CRASH = 'UNKNOWN_CRASH',
}

export enum RecoveryAction {
  CONTINUE_SIGNAL = 'CONTINUE_SIGNAL',
  STRONGER_PROMPT = 'STRONGER_PROMPT',
  RETRY_TASK = 'RETRY_TASK',
  RESTART_LANE = 'RESTART_LANE',
  RESTART_LANE_FROM_CHECKPOINT = 'RESTART_LANE_FROM_CHECKPOINT',
  KILL_AND_RESTART = 'KILL_AND_RESTART',
  ABORT_LANE = 'ABORT_LANE',
  WAIT_FOR_USER = 'WAIT_FOR_USER',
  WAIT_AND_RETRY = 'WAIT_AND_RETRY',
  RESET_GIT = 'RESET_GIT',
  SEND_GIT_GUIDANCE = 'SEND_GIT_GUIDANCE',
  RUN_DOCTOR = 'RUN_DOCTOR',
  NONE = 'NONE',
}

export interface FailureAnalysis {
  type: FailureType;
  action: RecoveryAction;
  message: string;
  isTransient: boolean;
  suggestedDelayMs?: number;
  details?: Record<string, any>;
}

/**
 * Multi-layer stall detection configuration
 */
export interface FailureContext {
  exitCode?: number;
  stallPhase?: number;
  idleTimeMs?: number;
  retryCount?: number;
  progressTimeMs?: number;
  lastOutput?: string;
  restartCount?: number;
  taskStartTimeMs?: number;
  circuitBreakerName?: string;
}

/**
 * Analyze an error message or state to determine the failure type and recovery action
 */
export function analyzeFailure(error: string | null | undefined, context?: FailureContext): FailureAnalysis {
  const msg = (error || '').toLowerCase();
  
  // Check circuit breaker status first
  if (context?.circuitBreakerName) {
    const breaker = getCircuitBreaker(context.circuitBreakerName);
    if (breaker.getState() === CircuitState.OPEN) {
      const waitTime = breaker.getTimeUntilRetry();
      return {
        type: FailureType.AGENT_UNAVAILABLE,
        action: RecoveryAction.WAIT_AND_RETRY,
        message: `Circuit breaker open. Retry in ${Math.round(waitTime / 1000)}s`,
        isTransient: true,
        suggestedDelayMs: waitTime,
      };
    }
  }
  
  // 1. Network errors
  if (msg.includes('econnreset') || msg.includes('econnrefused') || 
      msg.includes('etimedout') || msg.includes('enotfound') ||
      msg.includes('socket hang up') || msg.includes('network') ||
      msg.includes('canceled') || msg.includes('http/2') || msg.includes('stream closed')) {
    return {
      type: FailureType.NETWORK_ERROR,
      action: (context?.retryCount || 0) < 3 ? RecoveryAction.RETRY_TASK : RecoveryAction.RESTART_LANE,
      message: 'Network error or connection lost. Retrying...',
      isTransient: true,
      suggestedDelayMs: 5000 * Math.pow(2, context?.retryCount || 0),
    };
  }
  
  // 2. Agent service unavailable
  if (msg.includes('connecterror') && msg.includes('[unavailable]')) {
    return {
      type: FailureType.AGENT_UNAVAILABLE,
      action: (context?.retryCount || 0) < 3 ? RecoveryAction.RETRY_TASK : RecoveryAction.RESTART_LANE,
      message: 'Agent service is temporarily unavailable. Retrying with a new agent session.',
      isTransient: true,
      suggestedDelayMs: 10000,
    };
  }

  // 3. Authentication errors
  if (msg.includes('not authenticated') || msg.includes('unauthorized') || 
      msg.includes('401') || msg.includes('auth failed')) {
    return {
      type: FailureType.AGENT_AUTH_ERROR,
      action: RecoveryAction.WAIT_FOR_USER,
      message: 'Cursor authentication failed. Please sign in to Cursor IDE.',
      isTransient: false,
    };
  }

  // 4. Rate limits
  if (msg.includes('rate limit') || msg.includes('quota') || 
      msg.includes('429') || msg.includes('too many requests')) {
    return {
      type: FailureType.AGENT_RATE_LIMIT,
      action: RecoveryAction.WAIT_AND_RETRY,
      message: 'API rate limit reached. Waiting before retry...',
      isTransient: true,
      suggestedDelayMs: 60000, // 1 minute
    };
  }

  // 5. Timeout
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return {
      type: FailureType.AGENT_TIMEOUT,
      action: (context?.retryCount || 0) < 2 ? RecoveryAction.RETRY_TASK : RecoveryAction.RESTART_LANE,
      message: 'Operation timed out.',
      isTransient: true,
    };
  }

  // 6. Git/merge errors - send guidance to agent
  if (msg.includes('conflict') || msg.includes('merge failed') || msg.includes('automatic merge failed')) {
    return {
      type: FailureType.MERGE_CONFLICT,
      action: RecoveryAction.SEND_GIT_GUIDANCE,
      message: 'Merge conflict detected. Sending guidance to agent...',
      isTransient: true,
    };
  }
  
  // Git push rejected (common in parallel lanes)
  if (msg.includes('rejected') || msg.includes('non-fast-forward') || 
      msg.includes('failed to push') || msg.includes('fetch first')) {
    return {
      type: FailureType.GIT_PUSH_REJECTED,
      action: RecoveryAction.SEND_GIT_GUIDANCE,
      message: 'Git push rejected. Sending guidance to agent...',
      isTransient: true,
    };
  }

  if (msg.includes('git') && (msg.includes('error') || msg.includes('failed'))) {
    return {
      type: FailureType.GIT_ERROR,
      action: (context?.retryCount || 0) < 2 ? RecoveryAction.RETRY_TASK : RecoveryAction.RESET_GIT,
      message: 'Git operation failed.',
      isTransient: true,
    };
  }

  // 7. Dependency blocks (Exit Code 2)
  if (context?.exitCode === 2 || msg.includes('dependency_change_required')) {
    return {
      type: FailureType.DEPENDENCY_BLOCK,
      action: RecoveryAction.NONE, // Handled by orchestrator resolve logic
      message: 'Lane is blocked on dependency change request.',
      isTransient: false,
    };
  }
  
  // 8. Dependency failures
  if (msg.includes('dependency failed') || msg.includes('dependency timeout')) {
    const isDependencyTimeout = msg.includes('timeout');
    return {
      type: isDependencyTimeout ? FailureType.DEPENDENCY_TIMEOUT : FailureType.DEPENDENCY_FAILED,
      action: RecoveryAction.ABORT_LANE,
      message: isDependencyTimeout ? 'Dependency wait timed out.' : 'A dependency lane has failed.',
      isTransient: false,
    };
  }

  // 9. State corruption
  if (msg.includes('state') && (msg.includes('corrupt') || msg.includes('invalid') || msg.includes('parse'))) {
    return {
      type: FailureType.STATE_CORRUPTION,
      action: RecoveryAction.RESTART_LANE_FROM_CHECKPOINT,
      message: 'State file corruption detected.',
      isTransient: false,
    };
  }

  // 10. Stalls
  // Deprecated: analyzeStall call removed. Orchestrator now uses StallDetectionService
  // for all stall-related monitoring and recovery.
  
  // 11. Default fallback
  return {
    type: FailureType.UNKNOWN_CRASH,
    action: RecoveryAction.ABORT_LANE,
    message: error || `Process exited with code ${context?.exitCode}`,
    isTransient: false,
  };
}

/**
 * Log the failure analysis to the appropriate channels
 */
export function logFailure(laneName: string, analysis: FailureAnalysis, loggerInstance: any = logger): void {
  const label = `[${laneName}]`;
  const actionLabel = analysis.action === RecoveryAction.NONE ? '' : ` -> Action: ${analysis.action}`;
  const delayLabel = analysis.suggestedDelayMs ? ` (delay: ${Math.round(analysis.suggestedDelayMs / 1000)}s)` : '';
  
  const message = `${label} ${analysis.type}: ${analysis.message}${actionLabel}${delayLabel}`;
  
  if (analysis.isTransient) {
    loggerInstance.warn(message);
  } else {
    loggerInstance.error(message);
  }
  
  // Log details if present
  if (analysis.details && process.env['DEBUG']) {
    loggerInstance.info(`  Details: ${JSON.stringify(analysis.details)}`);
  }
}

/**
 * Get suggested delay based on failure analysis and retry count
 */
export function getSuggestedDelay(analysis: FailureAnalysis, retryCount: number): number {
  if (analysis.suggestedDelayMs) {
    return analysis.suggestedDelayMs;
  }
  
  // Exponential backoff
  const baseDelay = 5000;
  const maxDelay = 60000;
  
  return Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
}

/**
 * Executes a function with retry logic based on failure analysis
 */
export async function withRetry<T>(
  laneName: string,
  fn: () => Promise<T>,
  isError: (res: T) => { ok: boolean; error?: string },
  options: { 
    maxRetries?: number; 
    delayMs?: number;
    circuitBreakerName?: string;
  } = {}
): Promise<T> {
  const maxRetries = options.maxRetries || 3;
  const baseDelayMs = options.delayMs || 5000;
  let attempt = 0;
  
  // Get circuit breaker if specified
  const breaker = options.circuitBreakerName 
    ? getCircuitBreaker(options.circuitBreakerName)
    : null;

  while (true) {
    // Check circuit breaker
    if (breaker && !breaker.canCall()) {
      const waitTime = breaker.getTimeUntilRetry();
      logger.warn(`[${laneName}] Circuit breaker open. Waiting ${Math.round(waitTime / 1000)}s...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      continue;
    }
    
    const result = await fn();
    const status = isError(result);

    if (status.ok) {
      if (breaker) breaker.recordSuccess();
      return result;
    }
    
    if (breaker) breaker.recordFailure();

    const analysis = analyzeFailure(status.error, { 
      retryCount: attempt,
      circuitBreakerName: options.circuitBreakerName,
    });
    
    if ((analysis.action === RecoveryAction.RETRY_TASK || 
         analysis.action === RecoveryAction.WAIT_AND_RETRY) && 
        attempt < maxRetries) {
      attempt++;
      logFailure(laneName, analysis);
      
      const delay = getSuggestedDelay(analysis, attempt) || baseDelayMs;
      logger.info(`Attempt ${attempt}/${maxRetries} failed. Retrying in ${Math.round(delay / 1000)}s...`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
      continue;
    }

    return result;
  }
}

/**
 * Create a failure report for logging/monitoring
 */
export interface FailureReport {
  timestamp: string;
  laneName: string;
  analysis: FailureAnalysis;
  context: FailureContext;
  resolved: boolean;
  resolutionAction?: RecoveryAction;
}

export function createFailureReport(
  laneName: string, 
  analysis: FailureAnalysis, 
  context: FailureContext
): FailureReport {
  return {
    timestamp: new Date().toISOString(),
    laneName,
    analysis,
    context,
    resolved: false,
  };
}

/**
 * Failure statistics for monitoring
 */
export interface FailureStats {
  totalFailures: number;
  byType: Record<FailureType, number>;
  byAction: Record<RecoveryAction, number>;
  transientCount: number;
  permanentCount: number;
}

export function createEmptyStats(): FailureStats {
  return {
    totalFailures: 0,
    byType: {} as Record<FailureType, number>,
    byAction: {} as Record<RecoveryAction, number>,
    transientCount: 0,
    permanentCount: 0,
  };
}

export function updateStats(stats: FailureStats, analysis: FailureAnalysis): FailureStats {
  stats.totalFailures++;
  stats.byType[analysis.type] = (stats.byType[analysis.type] || 0) + 1;
  stats.byAction[analysis.action] = (stats.byAction[analysis.action] || 0) + 1;
  
  if (analysis.isTransient) {
    stats.transientCount++;
  } else {
    stats.permanentCount++;
  }
  
  return stats;
}

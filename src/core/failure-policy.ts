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
  AGENT_UNAVAILABLE = 'AGENT_UNAVAILABLE',
  AGENT_AUTH_ERROR = 'AGENT_AUTH_ERROR',
  AGENT_RATE_LIMIT = 'AGENT_RATE_LIMIT',
  AGENT_TIMEOUT = 'AGENT_TIMEOUT',
  DEPENDENCY_BLOCK = 'DEPENDENCY_BLOCK',
  DEPENDENCY_FAILED = 'DEPENDENCY_FAILED',
  DEPENDENCY_TIMEOUT = 'DEPENDENCY_TIMEOUT',
  REVIEW_FAIL = 'REVIEW_FAIL',
  GIT_ERROR = 'GIT_ERROR',
  MERGE_CONFLICT = 'MERGE_CONFLICT',
  NETWORK_ERROR = 'NETWORK_ERROR',
  STATE_CORRUPTION = 'STATE_CORRUPTION',
  UNKNOWN_CRASH = 'UNKNOWN_CRASH',
}

export enum RecoveryAction {
  CONTINUE_SIGNAL = 'CONTINUE_SIGNAL',
  RETRY_TASK = 'RETRY_TASK',
  RESTART_LANE = 'RESTART_LANE',
  RESTART_LANE_FROM_CHECKPOINT = 'RESTART_LANE_FROM_CHECKPOINT',
  ABORT_LANE = 'ABORT_LANE',
  WAIT_FOR_USER = 'WAIT_FOR_USER',
  WAIT_AND_RETRY = 'WAIT_AND_RETRY',
  RESET_GIT = 'RESET_GIT',
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
export interface StallDetectionConfig {
  /** Time without stdout activity before sending continue signal */
  idleTimeoutMs: number;
  /** Time without state file update before considering stalled */
  progressTimeoutMs: number;
  /** Maximum time for a single task */
  taskTimeoutMs: number;
  /** Grace period for known long operations (e.g., npm install) */
  longOperationGraceMs: number;
  /** Patterns that indicate long operations */
  longOperationPatterns: RegExp[];
  /** Maximum restarts before aborting */
  maxRestarts: number;
}

export const DEFAULT_STALL_CONFIG: StallDetectionConfig = {
  idleTimeoutMs: 3 * 60 * 1000,      // 3 minutes without output
  progressTimeoutMs: 10 * 60 * 1000,  // 10 minutes without progress
  taskTimeoutMs: 30 * 60 * 1000,      // 30 minutes max per task
  longOperationGraceMs: 15 * 60 * 1000, // 15 minute grace for long ops
  longOperationPatterns: [
    /Installing dependencies/i,
    /npm install/i,
    /pnpm install/i,
    /yarn install/i,
    /Building/i,
    /Compiling/i,
    /Downloading/i,
  ],
  maxRestarts: 2,
};

export interface StallContext {
  /** Current stall phase (0: normal, 1: continued, 2: restarted) */
  stallPhase: number;
  /** Time since last activity */
  idleTimeMs: number;
  /** Time since last state update */
  progressTimeMs?: number;
  /** Last output line (for long operation detection) */
  lastOutput?: string;
  /** Number of restarts */
  restartCount?: number;
  /** Task start time */
  taskStartTimeMs?: number;
}

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
 * Analyze stall condition with multi-layer detection
 */
export function analyzeStall(context: StallContext, config: StallDetectionConfig = DEFAULT_STALL_CONFIG): FailureAnalysis {
  const { stallPhase, idleTimeMs, progressTimeMs, lastOutput, restartCount = 0, taskStartTimeMs } = context;
  
  // Check if this might be a long operation
  const isLongOperation = lastOutput && config.longOperationPatterns.some(p => p.test(lastOutput));
  const effectiveIdleTimeout = isLongOperation ? config.longOperationGraceMs : config.idleTimeoutMs;
  
  // Check for task timeout
  if (taskStartTimeMs && (Date.now() - taskStartTimeMs) > config.taskTimeoutMs) {
    return {
      type: FailureType.AGENT_TIMEOUT,
      action: restartCount < config.maxRestarts ? RecoveryAction.RESTART_LANE : RecoveryAction.ABORT_LANE,
      message: `Task exceeded maximum timeout of ${Math.round(config.taskTimeoutMs / 60000)} minutes`,
      isTransient: restartCount < config.maxRestarts,
      details: { taskDurationMs: Date.now() - taskStartTimeMs },
    };
  }
  
  // Check for no progress (state file not updating)
  if (progressTimeMs && progressTimeMs > config.progressTimeoutMs) {
    return {
      type: FailureType.STALL_NO_PROGRESS,
      action: stallPhase === 0 ? RecoveryAction.CONTINUE_SIGNAL : RecoveryAction.RESTART_LANE,
      message: `No progress for ${Math.round(progressTimeMs / 60000)} minutes`,
      isTransient: true,
      details: { progressTimeMs },
    };
  }
  
  // Handle based on stall phase
  if (stallPhase === 0 && idleTimeMs > effectiveIdleTimeout) {
    return {
      type: FailureType.STALL_IDLE,
      action: RecoveryAction.CONTINUE_SIGNAL,
      message: `Lane idle for ${Math.round(idleTimeMs / 1000)}s. Sending continue...`,
      isTransient: true,
      details: { idleTimeMs, isLongOperation },
    };
  }
  
  if (stallPhase === 1) {
    // Already sent continue, check if still stalled
    const restartTimeout = config.idleTimeoutMs * 1.5; // 50% more time after continue
    
    if (idleTimeMs > restartTimeout) {
      if (restartCount < config.maxRestarts) {
        return {
          type: FailureType.STALL_IDLE,
          action: RecoveryAction.RESTART_LANE,
          message: 'Lane still idle after continue signal. Restarting lane...',
          isTransient: true,
          details: { idleTimeMs, restartCount },
        };
      } else {
        return {
          type: FailureType.STALL_IDLE,
          action: RecoveryAction.ABORT_LANE,
          message: `Lane stalled after ${restartCount} restarts. Aborting.`,
          isTransient: false,
          details: { restartCount },
        };
      }
    }
  }
  
  if (stallPhase >= 2) {
    // Already restarted, be more aggressive
    const abortTimeout = config.idleTimeoutMs * 0.5;
    
    if (idleTimeMs > abortTimeout) {
      return {
        type: FailureType.STALL_IDLE,
        action: RecoveryAction.ABORT_LANE,
        message: 'Lane stalled again after restart. Aborting.',
        isTransient: false,
        details: { stallPhase, idleTimeMs },
      };
    }
  }
  
  // No action needed yet
  return {
    type: FailureType.STALL_IDLE,
    action: RecoveryAction.NONE,
    message: 'Monitoring for stall',
    isTransient: true,
  };
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
      msg.includes('socket hang up') || msg.includes('network')) {
    return {
      type: FailureType.NETWORK_ERROR,
      action: (context?.retryCount || 0) < 3 ? RecoveryAction.RETRY_TASK : RecoveryAction.RESTART_LANE,
      message: 'Network error. Retrying...',
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

  // 6. Git/merge errors
  if (msg.includes('conflict') || msg.includes('merge failed')) {
    return {
      type: FailureType.MERGE_CONFLICT,
      action: RecoveryAction.RESET_GIT,
      message: 'Merge conflict detected.',
      isTransient: false,
    };
  }
  
  if (msg.includes('git') && (msg.includes('error') || msg.includes('failed'))) {
    return {
      type: FailureType.GIT_ERROR,
      action: RecoveryAction.RETRY_TASK,
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

  // 10. Stalls (handled by phase)
  if (context?.stallPhase !== undefined && context.stallPhase >= 0) {
    return analyzeStall({
      stallPhase: context.stallPhase,
      idleTimeMs: context.idleTimeMs || 0,
      progressTimeMs: context.progressTimeMs,
      restartCount: context.restartCount,
      taskStartTimeMs: context.taskStartTimeMs,
    });
  }

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

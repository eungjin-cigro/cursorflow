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
  REVIEW_FAIL = 'REVIEW_FAIL',
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
  idleTimeoutMs: 2 * 60 * 1000,       // 2 minutes without output (idle detection)
  progressTimeoutMs: 10 * 60 * 1000,  // 10 minutes without progress
  taskTimeoutMs: 30 * 60 * 1000,      // 30 minutes max per task
  longOperationGraceMs: 10 * 60 * 1000, // 10 minute grace for long ops
  longOperationPatterns: [
    /Installing dependencies/i,
    /npm install/i,
    /pnpm install/i,
    /yarn install/i,
    /Building/i,
    /Compiling/i,
    /Downloading/i,
    /Fetching/i,
    /Cloning/i,
    /Bundling/i,
  ],
  maxRestarts: 2,
};

export interface StallContext {
  /** Current stall phase (0: normal, 1: continued, 2: stronger_prompt, 3: restarted) */
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
  /** Bytes received since last check (0 = no response at all) */
  bytesReceived?: number;
  /** Number of continue signals already sent */
  continueSignalsSent?: number;
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
 * Analyze stall condition with multi-layer detection and escalating recovery
 * 
 * @deprecated Use StallDetectionService from './stall-detection' instead.
 * This function is kept for backward compatibility but will be removed in a future version.
 * 
 * The new unified StallDetectionService provides:
 * - Single source of truth for stall state
 * - Automatic recovery action execution
 * - Better heartbeat filtering
 * - Consistent state management
 * 
 * Recovery escalation stages:
 * 1. Phase 0 → Phase 1: Send continue signal (after 2 min idle)
 * 2. Phase 1 → Phase 2: Send stronger prompt (after 2 min grace)
 * 3. Phase 2 → Phase 3: Kill and restart process (after 2 min grace)
 * 4. Phase 3+: Abort after max restarts exceeded
 */
export function analyzeStall(context: StallContext, config: StallDetectionConfig = DEFAULT_STALL_CONFIG): FailureAnalysis {
  const { 
    stallPhase, 
    idleTimeMs, 
    progressTimeMs, 
    lastOutput, 
    restartCount = 0, 
    taskStartTimeMs,
    bytesReceived = -1, // -1 means not tracked
    continueSignalsSent = 0,
  } = context;
  
  // Check if this might be a long operation
  const isLongOperation = lastOutput && config.longOperationPatterns.some(p => p.test(lastOutput));
  
  // If it's a long operation but we've received 0 real bytes for a while, 
  // reduce the grace period to avoid waiting forever for a hung process.
  // We use 2x the normal idle timeout as a "sanity check" for silent long operations.
  const silentLongOpCappedTimeout = config.idleTimeoutMs * 2;
  const effectiveIdleTimeout = isLongOperation 
    ? (bytesReceived === 0 ? Math.min(config.longOperationGraceMs, silentLongOpCappedTimeout) : config.longOperationGraceMs)
    : config.idleTimeoutMs;
  
  // Check for task timeout
  if (taskStartTimeMs && (Date.now() - taskStartTimeMs) > config.taskTimeoutMs) {
    return {
      type: FailureType.AGENT_TIMEOUT,
      action: restartCount < config.maxRestarts ? RecoveryAction.KILL_AND_RESTART : RecoveryAction.RUN_DOCTOR,
      message: `Task exceeded maximum timeout of ${Math.round(config.taskTimeoutMs / 60000)} minutes`,
      isTransient: restartCount < config.maxRestarts,
      details: { taskDurationMs: Date.now() - taskStartTimeMs, restartCount },
    };
  }
  
  // Check for zero bytes received (agent completely unresponsive)
  if (bytesReceived === 0 && idleTimeMs > effectiveIdleTimeout) {
    return {
      type: FailureType.AGENT_NO_RESPONSE,
      action: stallPhase < 2 ? RecoveryAction.CONTINUE_SIGNAL : RecoveryAction.KILL_AND_RESTART,
      message: `Agent produced 0 bytes for ${Math.round(idleTimeMs / 1000)}s - possible API issue`,
      isTransient: true,
      details: { idleTimeMs, bytesReceived, stallPhase },
    };
  }
  
  // Check for no progress (state file not updating)
  if (progressTimeMs && progressTimeMs > config.progressTimeoutMs) {
    return {
      type: FailureType.STALL_NO_PROGRESS,
      action: stallPhase === 0 ? RecoveryAction.CONTINUE_SIGNAL : 
              stallPhase === 1 ? RecoveryAction.STRONGER_PROMPT :
              RecoveryAction.KILL_AND_RESTART,
      message: `No progress for ${Math.round(progressTimeMs / 60000)} minutes`,
      isTransient: true,
      details: { progressTimeMs, stallPhase },
    };
  }
  
  // Phase 0: Normal operation, check for initial idle
  if (stallPhase === 0 && idleTimeMs > effectiveIdleTimeout) {
    return {
      type: FailureType.STALL_IDLE,
      action: RecoveryAction.CONTINUE_SIGNAL,
      message: `Lane idle for ${Math.round(idleTimeMs / 1000)}s. Sending continue signal...`,
      isTransient: true,
      details: { idleTimeMs, isLongOperation, phase: 0 },
    };
  }
  
  // Phase 1: Continue signal sent, wait for response
  if (stallPhase === 1) {
    const graceTimeout = 2 * 60 * 1000; // 2 minutes grace after continue
    
    if (idleTimeMs > graceTimeout) {
      return {
        type: FailureType.STALL_IDLE,
        action: RecoveryAction.STRONGER_PROMPT,
        message: `Still idle after continue signal. Sending stronger prompt...`,
        isTransient: true,
        details: { idleTimeMs, continueSignalsSent, phase: 1 },
      };
    }
  }
  
  // Phase 2: Stronger prompt sent, wait or escalate
  if (stallPhase === 2) {
    const strongerGraceTimeout = 2 * 60 * 1000; // 2 minutes grace after stronger prompt
    
    if (idleTimeMs > strongerGraceTimeout) {
      if (restartCount < config.maxRestarts) {
        return {
          type: FailureType.STALL_IDLE,
          action: RecoveryAction.KILL_AND_RESTART,
          message: `No response after stronger prompt. Killing and restarting process...`,
          isTransient: true,
          details: { idleTimeMs, restartCount, maxRestarts: config.maxRestarts, phase: 2 },
        };
      } else {
        return {
          type: FailureType.STALL_IDLE,
          action: RecoveryAction.RUN_DOCTOR,
          message: `Lane failed after ${restartCount} restarts. Running diagnostics...`,
          isTransient: false,
          details: { restartCount, phase: 2 },
        };
      }
    }
  }
  
  // Phase 3+: After restart, monitor with shorter timeout
  if (stallPhase >= 3) {
    const postRestartTimeout = config.idleTimeoutMs * 0.75; // Shorter timeout after restart
    
    if (idleTimeMs > postRestartTimeout) {
      if (restartCount < config.maxRestarts) {
        return {
          type: FailureType.STALL_IDLE,
          action: RecoveryAction.CONTINUE_SIGNAL,
          message: `Lane idle after restart. Retrying continue signal...`,
          isTransient: true,
          details: { idleTimeMs, restartCount, phase: stallPhase },
        };
      } else {
        return {
          type: FailureType.STALL_IDLE,
          action: RecoveryAction.RUN_DOCTOR,
          message: `Lane repeatedly stalled. Running diagnostics for root cause...`,
          isTransient: false,
          details: { stallPhase, restartCount },
        };
      }
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

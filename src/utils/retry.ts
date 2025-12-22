/**
 * Enhanced retry logic with exponential backoff and circuit breaker
 */

import * as logger from './logger';

export interface RetryConfig {
  /** Maximum number of retries */
  maxRetries: number;
  /** Base delay in milliseconds */
  baseDelayMs: number;
  /** Maximum delay in milliseconds */
  maxDelayMs: number;
  /** Backoff multiplier */
  backoffFactor: number;
  /** Add random jitter to delays */
  jitter: boolean;
  /** Timeout for each attempt in milliseconds */
  attemptTimeoutMs?: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffFactor: 2,
  jitter: true,
  attemptTimeoutMs: undefined,
};

export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening circuit */
  failureThreshold: number;
  /** Time in milliseconds before attempting to close circuit */
  resetTimeoutMs: number;
  /** Number of successful calls needed to close circuit */
  successThreshold: number;
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 60000,
  successThreshold: 2,
};

export enum CircuitState {
  CLOSED = 'CLOSED',       // Normal operation
  OPEN = 'OPEN',           // Blocking calls
  HALF_OPEN = 'HALF_OPEN', // Testing if service recovered
}

/**
 * Circuit breaker implementation for managing service availability
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number = 0;
  private readonly config: CircuitBreakerConfig;
  private readonly name: string;

  constructor(name: string, config: Partial<CircuitBreakerConfig> = {}) {
    this.name = name;
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
  }

  /**
   * Check if circuit allows a call
   */
  canCall(): boolean {
    if (this.state === CircuitState.CLOSED) {
      return true;
    }

    if (this.state === CircuitState.OPEN) {
      // Check if enough time has passed to try again
      if (Date.now() - this.lastFailureTime >= this.config.resetTimeoutMs) {
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
        logger.info(`[CircuitBreaker:${this.name}] Transitioning to HALF_OPEN`);
        return true;
      }
      return false;
    }

    // HALF_OPEN - allow limited calls
    return true;
  }

  /**
   * Record a successful call
   */
  recordSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        logger.info(`[CircuitBreaker:${this.name}] Circuit CLOSED after recovery`);
      }
    } else if (this.state === CircuitState.CLOSED) {
      // Reset failure count on success
      this.failureCount = Math.max(0, this.failureCount - 1);
    }
  }

  /**
   * Record a failed call
   */
  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      // Immediately open circuit on failure in half-open state
      this.state = CircuitState.OPEN;
      logger.warn(`[CircuitBreaker:${this.name}] Circuit OPEN (failure in half-open state)`);
    } else if (this.state === CircuitState.CLOSED && this.failureCount >= this.config.failureThreshold) {
      this.state = CircuitState.OPEN;
      logger.warn(`[CircuitBreaker:${this.name}] Circuit OPEN (threshold reached: ${this.failureCount} failures)`);
    }
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get time until circuit might close (for OPEN state)
   */
  getTimeUntilRetry(): number {
    if (this.state !== CircuitState.OPEN) {
      return 0;
    }
    return Math.max(0, this.config.resetTimeoutMs - (Date.now() - this.lastFailureTime));
  }

  /**
   * Force reset the circuit breaker
   */
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
  }

  /**
   * Get circuit breaker status for monitoring
   */
  getStatus(): { state: CircuitState; failureCount: number; timeUntilRetry: number } {
    return {
      state: this.state,
      failureCount: this.failureCount,
      timeUntilRetry: this.getTimeUntilRetry(),
    };
  }
}

/**
 * Global circuit breaker registry
 */
const circuitBreakers = new Map<string, CircuitBreaker>();

/**
 * Get or create a circuit breaker by name
 */
export function getCircuitBreaker(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
  let breaker = circuitBreakers.get(name);
  if (!breaker) {
    breaker = new CircuitBreaker(name, config);
    circuitBreakers.set(name, breaker);
  }
  return breaker;
}

/**
 * Calculate delay with exponential backoff and optional jitter
 */
export function calculateDelay(attempt: number, config: RetryConfig): number {
  let delay = config.baseDelayMs * Math.pow(config.backoffFactor, attempt);
  delay = Math.min(delay, config.maxDelayMs);

  if (config.jitter) {
    // Add random jitter of ±25%
    const jitterRange = delay * 0.25;
    delay = delay - jitterRange + Math.random() * jitterRange * 2;
  }

  return Math.round(delay);
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wrap a promise with timeout
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message?: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message || `Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then(result => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch(error => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
  totalTimeMs: number;
}

/**
 * Execute a function with enhanced retry logic
 */
export async function withEnhancedRetry<T>(
  fn: () => Promise<T>,
  options: {
    config?: Partial<RetryConfig>;
    circuitBreaker?: CircuitBreaker | string;
    shouldRetry?: (error: Error, attempt: number) => boolean;
    onRetry?: (error: Error, attempt: number, delayMs: number) => void;
    label?: string;
  } = {}
): Promise<RetryResult<T>> {
  const config = { ...DEFAULT_RETRY_CONFIG, ...options.config };
  const label = options.label || 'operation';
  const startTime = Date.now();

  // Get circuit breaker if specified
  let breaker: CircuitBreaker | undefined;
  if (options.circuitBreaker) {
    breaker = typeof options.circuitBreaker === 'string'
      ? getCircuitBreaker(options.circuitBreaker)
      : options.circuitBreaker;
  }

  // Check circuit breaker before starting
  if (breaker && !breaker.canCall()) {
    const waitTime = breaker.getTimeUntilRetry();
    return {
      success: false,
      error: new Error(`Circuit breaker is OPEN. Retry in ${Math.round(waitTime / 1000)}s`),
      attempts: 0,
      totalTimeMs: Date.now() - startTime,
    };
  }

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      // Execute with optional timeout
      let result: T;
      if (config.attemptTimeoutMs) {
        result = await withTimeout(fn(), config.attemptTimeoutMs, `${label} timed out`);
      } else {
        result = await fn();
      }

      // Success - record in circuit breaker
      if (breaker) {
        breaker.recordSuccess();
      }

      return {
        success: true,
        result,
        attempts: attempt + 1,
        totalTimeMs: Date.now() - startTime,
      };
    } catch (error: any) {
      lastError = error;

      // Record failure in circuit breaker
      if (breaker) {
        breaker.recordFailure();
        if (!breaker.canCall()) {
          logger.warn(`[${label}] Circuit breaker opened, stopping retries`);
          break;
        }
      }

      // Check if we should retry
      if (options.shouldRetry && !options.shouldRetry(error, attempt)) {
        logger.warn(`[${label}] Error is not retryable: ${error.message}`);
        break;
      }

      // Check if we have more retries
      if (attempt >= config.maxRetries) {
        logger.error(`[${label}] All ${config.maxRetries + 1} attempts failed`);
        break;
      }

      // Calculate delay
      const delay = calculateDelay(attempt, config);

      // Notify on retry
      if (options.onRetry) {
        options.onRetry(error, attempt, delay);
      } else {
        logger.warn(`[${label}] Attempt ${attempt + 1} failed: ${error.message}. Retrying in ${delay}ms...`);
      }

      await sleep(delay);
    }
  }

  return {
    success: false,
    error: lastError,
    attempts: config.maxRetries + 1,
    totalTimeMs: Date.now() - startTime,
  };
}

/**
 * Check if an error is transient and worth retrying
 */
export function isTransientError(error: Error): boolean {
  const message = error.message.toLowerCase();

  // Network errors
  if (message.includes('econnreset') || 
      message.includes('econnrefused') ||
      message.includes('etimedout') ||
      message.includes('enotfound') ||
      message.includes('socket hang up')) {
    return true;
  }

  // Service unavailable
  if (message.includes('unavailable') ||
      message.includes('503') ||
      message.includes('502') ||
      message.includes('504')) {
    return true;
  }

  // Rate limiting (should retry after delay)
  if (message.includes('rate limit') ||
      message.includes('429') ||
      message.includes('too many requests')) {
    return true;
  }

  // Temporary server errors
  if (message.includes('internal server error') ||
      message.includes('500') ||
      message.includes('temporarily')) {
    return true;
  }

  return false;
}

/**
 * Check if an error is permanent and should not be retried
 */
export function isPermanentError(error: Error): boolean {
  const message = error.message.toLowerCase();

  // Authentication errors
  if (message.includes('unauthorized') ||
      message.includes('401') ||
      message.includes('forbidden') ||
      message.includes('403') ||
      message.includes('not authenticated')) {
    return true;
  }

  // Configuration/setup errors
  if (message.includes('not found') ||
      message.includes('404') ||
      message.includes('invalid configuration') ||
      message.includes('invalid api key')) {
    return true;
  }

  return false;
}

/**
 * Default retry predicate
 */
export function defaultShouldRetry(error: Error, attempt: number): boolean {
  if (isPermanentError(error)) {
    return false;
  }
  return isTransientError(error);
}


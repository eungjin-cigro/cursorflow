/**
 * Enhanced file-based locking with async support and stale lock detection
 */

import * as fs from 'fs';
import * as path from 'path';
import { safeJoin } from './path';

export interface LockInfo {
  pid: number;
  timestamp: number;
  operation: string;
  hostname?: string;
}

export interface LockOptions {
  /** Maximum time to wait for lock in milliseconds */
  timeoutMs?: number;
  /** Delay between retry attempts in milliseconds */
  retryDelayMs?: number;
  /** Lock is considered stale after this many milliseconds */
  staleTimeoutMs?: number;
  /** Description of the operation for logging */
  operation?: string;
}

export const DEFAULT_LOCK_OPTIONS: Required<LockOptions> = {
  timeoutMs: 30000,
  retryDelayMs: 100,
  staleTimeoutMs: 60000,
  operation: 'unknown',
};

/**
 * Check if a process is still running
 */
export function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 checks if process exists without actually signaling it
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the lock directory for a given base path
 */
export function getLockDir(basePath: string): string {
  return safeJoin(basePath, '_cursorflow', 'locks');
}

/**
 * Ensure lock directory exists
 */
export function ensureLockDir(basePath: string): string {
  const lockDir = getLockDir(basePath);
  if (!fs.existsSync(lockDir)) {
    fs.mkdirSync(lockDir, { recursive: true });
  }
  return lockDir;
}

/**
 * Read lock file info
 */
export function readLockInfo(lockFile: string): LockInfo | null {
  try {
    if (!fs.existsSync(lockFile)) {
      return null;
    }
    const content = fs.readFileSync(lockFile, 'utf8');
    return JSON.parse(content) as LockInfo;
  } catch {
    return null;
  }
}

/**
 * Check if a lock is stale
 */
export function isLockStale(lockInfo: LockInfo, staleTimeoutMs: number): boolean {
  // Check if process is dead
  if (!isProcessRunning(lockInfo.pid)) {
    return true;
  }

  // Check if lock has expired
  if (Date.now() - lockInfo.timestamp > staleTimeoutMs) {
    return true;
  }

  return false;
}

/**
 * Try to acquire a lock synchronously (for backward compatibility)
 */
export function tryAcquireLockSync(lockFile: string, options: LockOptions = {}): boolean {
  const opts = { ...DEFAULT_LOCK_OPTIONS, ...options };
  
  // Check for existing lock
  const existingLock = readLockInfo(lockFile);
  if (existingLock) {
    if (!isLockStale(existingLock, opts.staleTimeoutMs)) {
      return false;
    }
    // Stale lock - remove it
    try {
      fs.unlinkSync(lockFile);
    } catch {
      return false;
    }
  }

  // Try to create lock atomically
  const lockInfo: LockInfo = {
    pid: process.pid,
    timestamp: Date.now(),
    operation: opts.operation,
    hostname: require('os').hostname(),
  };

  try {
    fs.writeFileSync(lockFile, JSON.stringify(lockInfo, null, 2), { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Release a lock synchronously
 */
export function releaseLockSync(lockFile: string): void {
  try {
    const lockInfo = readLockInfo(lockFile);
    // Only release if we own the lock
    if (lockInfo && lockInfo.pid === process.pid) {
      fs.unlinkSync(lockFile);
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Acquire a lock with async waiting
 */
export async function acquireLock(lockFile: string, options: LockOptions = {}): Promise<boolean> {
  const opts = { ...DEFAULT_LOCK_OPTIONS, ...options };
  const startTime = Date.now();

  while (Date.now() - startTime < opts.timeoutMs) {
    if (tryAcquireLockSync(lockFile, opts)) {
      return true;
    }

    // Wait before retrying with jitter
    const jitter = Math.random() * opts.retryDelayMs * 0.5;
    await new Promise(resolve => setTimeout(resolve, opts.retryDelayMs + jitter));
  }

  return false;
}

/**
 * Release a lock
 */
export async function releaseLock(lockFile: string): Promise<void> {
  releaseLockSync(lockFile);
}

/**
 * Execute a function while holding a lock
 */
export async function withLock<T>(
  lockFile: string,
  fn: () => Promise<T>,
  options: LockOptions = {}
): Promise<T> {
  const acquired = await acquireLock(lockFile, options);
  if (!acquired) {
    throw new Error(`Failed to acquire lock: ${lockFile} (timeout: ${options.timeoutMs || DEFAULT_LOCK_OPTIONS.timeoutMs}ms)`);
  }

  try {
    return await fn();
  } finally {
    await releaseLock(lockFile);
  }
}

/**
 * Execute a synchronous function while holding a lock
 */
export function withLockSync<T>(
  lockFile: string,
  fn: () => T,
  options: LockOptions = {}
): T {
  const opts = { ...DEFAULT_LOCK_OPTIONS, ...options };
  const startTime = Date.now();

  // Busy wait for lock (synchronous)
  while (Date.now() - startTime < opts.timeoutMs) {
    if (tryAcquireLockSync(lockFile, opts)) {
      try {
        return fn();
      } finally {
        releaseLockSync(lockFile);
      }
    }

    // Sync sleep
    const end = Date.now() + opts.retryDelayMs;
    while (Date.now() < end) { /* busy wait */ }
  }

  throw new Error(`Failed to acquire lock: ${lockFile} (timeout: ${opts.timeoutMs}ms)`);
}

/**
 * Clean up stale locks in a directory
 */
export function cleanStaleLocks(lockDir: string, staleTimeoutMs: number = DEFAULT_LOCK_OPTIONS.staleTimeoutMs): number {
  if (!fs.existsSync(lockDir)) {
    return 0;
  }

  let cleaned = 0;
  const files = fs.readdirSync(lockDir);

  for (const file of files) {
    if (!file.endsWith('.lock')) continue;

    const lockFile = safeJoin(lockDir, file);
    const lockInfo = readLockInfo(lockFile);

    if (lockInfo && isLockStale(lockInfo, staleTimeoutMs)) {
      try {
        fs.unlinkSync(lockFile);
        cleaned++;
      } catch {
        // Ignore
      }
    }
  }

  return cleaned;
}

/**
 * Get status of all locks in a directory
 */
export function getLockStatus(lockDir: string): Array<{ file: string; info: LockInfo; stale: boolean }> {
  if (!fs.existsSync(lockDir)) {
    return [];
  }

  const result: Array<{ file: string; info: LockInfo; stale: boolean }> = [];
  const files = fs.readdirSync(lockDir);

  for (const file of files) {
    if (!file.endsWith('.lock')) continue;

    const lockFile = safeJoin(lockDir, file);
    const lockInfo = readLockInfo(lockFile);

    if (lockInfo) {
      result.push({
        file,
        info: lockInfo,
        stale: isLockStale(lockInfo, DEFAULT_LOCK_OPTIONS.staleTimeoutMs),
      });
    }
  }

  return result;
}

/**
 * Named lock manager for managing multiple locks
 */
export class LockManager {
  private readonly basePath: string;
  private readonly heldLocks: Set<string> = new Set();

  constructor(basePath: string) {
    this.basePath = basePath;
    ensureLockDir(basePath);

    // Register cleanup on process exit
    process.on('exit', () => this.releaseAll());
    process.on('SIGINT', () => {
      this.releaseAll();
      process.exit(130);
    });
    process.on('SIGTERM', () => {
      this.releaseAll();
      process.exit(143);
    });
  }

  private getLockPath(name: string): string {
    return safeJoin(getLockDir(this.basePath), `${name}.lock`);
  }

  async acquire(name: string, options: LockOptions = {}): Promise<boolean> {
    const lockPath = this.getLockPath(name);
    const acquired = await acquireLock(lockPath, options);
    if (acquired) {
      this.heldLocks.add(name);
    }
    return acquired;
  }

  async release(name: string): Promise<void> {
    const lockPath = this.getLockPath(name);
    await releaseLock(lockPath);
    this.heldLocks.delete(name);
  }

  releaseAll(): void {
    for (const name of this.heldLocks) {
      const lockPath = this.getLockPath(name);
      releaseLockSync(lockPath);
    }
    this.heldLocks.clear();
  }

  async withLock<T>(name: string, fn: () => Promise<T>, options: LockOptions = {}): Promise<T> {
    const lockPath = this.getLockPath(name);
    return withLock(lockPath, fn, options);
  }

  cleanStale(staleTimeoutMs?: number): number {
    return cleanStaleLocks(getLockDir(this.basePath), staleTimeoutMs);
  }

  getStatus(): Array<{ file: string; info: LockInfo; stale: boolean }> {
    return getLockStatus(getLockDir(this.basePath));
  }
}


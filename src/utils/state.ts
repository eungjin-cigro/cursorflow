/**
 * State management utilities for CursorFlow
 * 
 * Features:
 * - Atomic writes to prevent corruption
 * - State validation and repair
 * - Versioned state with conflict detection
 */

import * as fs from 'fs';
import * as path from 'path';
import { safeJoin } from './path';
import { 
  LaneState, 
  ConversationEntry, 
  GitLogEntry, 
  EventEntry, 
  RunnerConfig 
} from './types';
import { tryAcquireLockSync, releaseLockSync, LockOptions } from './lock';
import * as git from './git';

export { LaneState, ConversationEntry, GitLogEntry, EventEntry };

/**
 * Extended state with metadata for versioning
 */
export interface VersionedState<T> {
  _version: number;
  _updatedAt: number;
  _pid: number;
  data: T;
}

/**
 * State validation result
 */
export interface StateValidationResult {
  valid: boolean;
  issues: string[];
  repaired: boolean;
  repairedState?: LaneState;
}

/**
 * Save state to JSON file with atomic write
 */
export function saveState(statePath: string, state: any): void {
  const stateDir = path.dirname(statePath);
  
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
  
  // Atomic write: write to temp file, then rename
  const tempPath = `${statePath}.tmp.${process.pid}`;
  
  try {
    fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tempPath, statePath);
  } catch (error) {
    // Clean up temp file if rename fails
    try {
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

/**
 * Save state with file lock to prevent race conditions
 */
export function saveStateWithLock(statePath: string, state: any, lockOptions?: LockOptions): void {
  const lockPath = `${statePath}.lock`;
  
  // Try to acquire lock
  const maxRetries = 50;
  let acquired = false;
  let retries = 0;
  
  while (retries < maxRetries && !acquired) {
    acquired = tryAcquireLockSync(lockPath, { 
      operation: 'saveState',
      staleTimeoutMs: 10000,
      ...lockOptions 
    });
    
    if (!acquired) {
      retries++;
      // Sync sleep
      const end = Date.now() + 100;
      while (Date.now() < end) { /* wait */ }
    }
  }
  
  if (!acquired) {
    throw new Error(`Failed to acquire lock for state file: ${statePath}`);
  }
  
  try {
    saveState(statePath, state);
  } finally {
    releaseLockSync(lockPath);
  }
}

/**
 * Load state from JSON file with corruption recovery
 */
export function loadState<T = any>(statePath: string): T | null {
  if (!fs.existsSync(statePath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(statePath, 'utf8');
    return JSON.parse(content) as T;
  } catch (error: any) {
    // Try to recover from backup if exists
    const backupPath = `${statePath}.backup`;
    if (fs.existsSync(backupPath)) {
      try {
        console.warn(`Warning: Main state file corrupted, trying backup: ${statePath}`);
        const backupContent = fs.readFileSync(backupPath, 'utf8');
        const backupState = JSON.parse(backupContent) as T;
        
        // Restore from backup
        saveState(statePath, backupState);
        return backupState;
      } catch {
        // Backup also corrupted
      }
    }
    
    console.warn(`Warning: Failed to parse state file ${statePath}: ${error.message}`);
    return null;
  }
}

/**
 * Load state with automatic backup creation
 */
export function loadStateWithBackup<T = any>(statePath: string): T | null {
  const state = loadState<T>(statePath);
  
  if (state) {
    // Create backup
    const backupPath = `${statePath}.backup`;
    try {
      fs.copyFileSync(statePath, backupPath);
    } catch {
      // Ignore backup failures
    }
  }
  
  return state;
}

/**
 * Update state with optimistic locking
 */
export function updateStateAtomic(
  statePath: string, 
  updater: (state: LaneState | null) => LaneState
): LaneState {
  const lockPath = `${statePath}.lock`;
  
  // Acquire lock
  const maxRetries = 50;
  let acquired = false;
  let retries = 0;
  
  while (retries < maxRetries && !acquired) {
    acquired = tryAcquireLockSync(lockPath, { operation: 'updateState', staleTimeoutMs: 10000 });
    if (!acquired) {
      retries++;
      const end = Date.now() + 100;
      while (Date.now() < end) { /* wait */ }
    }
  }
  
  if (!acquired) {
    throw new Error(`Failed to acquire lock for state update: ${statePath}`);
  }
  
  try {
    const currentState = loadState<LaneState>(statePath);
    const newState = updater(currentState);
    newState.updatedAt = Date.now();
    saveState(statePath, newState);
    return newState;
  } finally {
    releaseLockSync(lockPath);
  }
}

/**
 * Validate lane state and check for inconsistencies
 */
export function validateLaneState(
  statePath: string,
  options: { 
    checkWorktree?: boolean; 
    checkBranch?: boolean;
    autoRepair?: boolean;
  } = {}
): StateValidationResult {
  const state = loadState<LaneState>(statePath);
  const issues: string[] = [];
  let repaired = false;
  let repairedState: LaneState | undefined;
  
  if (!state) {
    return {
      valid: false,
      issues: ['State file not found or corrupted'],
      repaired: false,
    };
  }
  
  // Check required fields
  if (!state.label) {
    issues.push('Missing label field');
  }
  
  if (state.status === undefined) {
    issues.push('Missing status field');
  }
  
  if (state.currentTaskIndex === undefined || state.currentTaskIndex < 0) {
    issues.push(`Invalid currentTaskIndex: ${state.currentTaskIndex}`);
  }
  
  if (state.totalTasks === undefined || state.totalTasks < 0) {
    issues.push(`Invalid totalTasks: ${state.totalTasks}`);
  }
  
  if (state.currentTaskIndex > state.totalTasks) {
    issues.push(`currentTaskIndex (${state.currentTaskIndex}) exceeds totalTasks (${state.totalTasks})`);
  }
  
  // Check worktree existence
  if (options.checkWorktree && state.worktreeDir) {
    if (!fs.existsSync(state.worktreeDir)) {
      issues.push(`Worktree directory not found: ${state.worktreeDir}`);
      
      if (options.autoRepair) {
        state.worktreeDir = null;
        repaired = true;
      }
    }
  }
  
  // Check branch existence
  if (options.checkBranch && state.pipelineBranch) {
    try {
      if (!git.branchExists(state.pipelineBranch)) {
        issues.push(`Branch not found: ${state.pipelineBranch}`);
        
        if (options.autoRepair) {
          state.pipelineBranch = null;
          repaired = true;
        }
      }
    } catch {
      // Git check failed, don't add issue
    }
  }
  
  // Check status consistency
  if (state.status === 'completed' && !state.endTime) {
    issues.push('Status is completed but endTime is not set');
    
    if (options.autoRepair) {
      state.endTime = Date.now();
      repaired = true;
    }
  }
  
  if (state.status === 'failed' && !state.error) {
    issues.push('Status is failed but no error message');
  }
  
  // Save repaired state if auto-repair was enabled
  if (repaired && options.autoRepair) {
    state.updatedAt = Date.now();
    saveState(statePath, state);
    repairedState = state;
  }
  
  return {
    valid: issues.length === 0,
    issues,
    repaired,
    repairedState,
  };
}

/**
 * Repair lane state by resetting inconsistent values
 */
export function repairLaneState(statePath: string): LaneState | null {
  const result = validateLaneState(statePath, {
    checkWorktree: true,
    checkBranch: true,
    autoRepair: true,
  });
  
  if (result.repairedState) {
    return result.repairedState;
  }
  
  // If validation failed completely, try to create minimal valid state
  const state = loadState<LaneState>(statePath);
  if (!state) {
    return null;
  }
  
  // Ensure all required fields have valid values
  const repairedState: LaneState = {
    label: state.label || path.basename(path.dirname(statePath)),
    status: 'pending',
    currentTaskIndex: Math.max(0, state.currentTaskIndex || 0),
    totalTasks: Math.max(0, state.totalTasks || 0),
    worktreeDir: state.worktreeDir && fs.existsSync(state.worktreeDir) ? state.worktreeDir : null,
    pipelineBranch: state.pipelineBranch,
    startTime: state.startTime || Date.now(),
    endTime: null,
    error: null,
    dependencyRequest: null,
    tasksFile: state.tasksFile,
    completedTasks: state.completedTasks || [],
    updatedAt: Date.now(),
  };
  
  // Ensure currentTaskIndex doesn't exceed totalTasks
  if (repairedState.currentTaskIndex > repairedState.totalTasks) {
    repairedState.currentTaskIndex = repairedState.totalTasks;
  }
  
  saveState(statePath, repairedState);
  return repairedState;
}

/**
 * Check if state needs recovery (e.g., after crash)
 */
export function stateNeedsRecovery(statePath: string): boolean {
  const state = loadState<LaneState>(statePath);
  
  if (!state) {
    return false;
  }
  
  // Running state with no recent update might indicate a crash
  if (state.status === 'running') {
    const lastUpdate = state.updatedAt || state.startTime;
    const staleThresholdMs = 5 * 60 * 1000; // 5 minutes
    
    if (Date.now() - lastUpdate > staleThresholdMs) {
      return true;
    }
  }
  
  // Check for temp files indicating incomplete write
  const tempPattern = `${statePath}.tmp.`;
  const stateDir = path.dirname(statePath);
  
  try {
    const files = fs.readdirSync(stateDir);
    for (const file of files) {
      if (file.startsWith(path.basename(tempPattern))) {
        return true;
      }
    }
  } catch {
    // Ignore
  }
  
  return false;
}

/**
 * Clean up temp files from incomplete writes
 */
export function cleanupTempFiles(stateDir: string): number {
  let cleaned = 0;
  
  try {
    const files = fs.readdirSync(stateDir);
    for (const file of files) {
      if (file.includes('.tmp.')) {
        try {
          fs.unlinkSync(safeJoin(stateDir, file));
          cleaned++;
        } catch {
          // Ignore
        }
      }
    }
  } catch {
    // Ignore
  }
  
  return cleaned;
}

/**
 * Append to JSONL log file
 */
export function appendLog(logPath: string, entry: any): void {
  const logDir = path.dirname(logPath);
  
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(logPath, line, 'utf8');
}

/**
 * Read JSONL log file
 */
export function readLog<T = any>(logPath: string): T[] {
  if (!fs.existsSync(logPath)) {
    return [];
  }
  
  try {
    const content = fs.readFileSync(logPath, 'utf8');
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line) as T);
  } catch (error: any) {
    console.warn(`Warning: Failed to parse log file ${logPath}: ${error.message}`);
    return [];
  }
}

/**
 * Create initial lane state
 */
export function createLaneState(
  laneName: string, 
  config: RunnerConfig, 
  tasksFile?: string,
  options: { pipelineBranch?: string; worktreeDir?: string } = {}
): LaneState {
  return {
    label: laneName,
    status: 'pending',
    currentTaskIndex: 0,
    totalTasks: config.tasks ? config.tasks.length : 0,
    worktreeDir: options.worktreeDir || null,
    pipelineBranch: options.pipelineBranch || null,
    startTime: Date.now(),
    endTime: null,
    error: null,
    dependencyRequest: null,
    tasksFile,
  };
}

/**
 * Update lane state
 */
export function updateLaneState(state: LaneState, updates: Partial<LaneState>): LaneState {
  return {
    ...state,
    ...updates,
    updatedAt: Date.now(),
  };
}

/**
 * Create conversation log entry
 */
export function createConversationEntry(role: ConversationEntry['role'], text: string, options: { task?: string; model?: string } = {}): ConversationEntry {
  return {
    timestamp: new Date().toISOString(),
    role,
    task: options.task || null,
    fullText: text,
    textLength: text.length,
    model: options.model || null,
  };
}

/**
 * Create git operation log entry
 */
export function createGitLogEntry(operation: string, details: any = {}): GitLogEntry {
  return {
    timestamp: new Date().toISOString(),
    operation,
    ...details,
  };
}

/**
 * Create event log entry
 */
export function createEventEntry(event: string, data: any = {}): EventEntry {
  return {
    timestamp: new Date().toISOString(),
    event,
    ...data,
  };
}

/**
 * Get latest run directory
 */
export function getLatestRunDir(logsDir: string): string | null {
  if (!fs.existsSync(logsDir)) {
    return null;
  }
  
  const runs = fs.readdirSync(logsDir)
    .filter(f => fs.statSync(safeJoin(logsDir, f)).isDirectory())
    .sort()
    .reverse();
  
  if (runs.length === 0) {
    return null;
  }
  
  return safeJoin(logsDir, runs[0]!);
}

/**
 * List all lanes in a run directory
 */
export function listLanesInRun(runDir: string): { name: string; dir: string; statePath: string }[] {
  if (!fs.existsSync(runDir)) {
    return [];
  }
  
  return fs.readdirSync(runDir)
    .filter(f => fs.statSync(safeJoin(runDir, f)).isDirectory())
    .map(laneName => ({
      name: laneName,
      dir: safeJoin(runDir, laneName),
      statePath: safeJoin(runDir, laneName, 'state.json'),
    }));
}

/**
 * Get lane state summary
 */
export function getLaneStateSummary(statePath: string): { status: string; progress: string; label?: string; error?: string | null } {
  const state = loadState<LaneState>(statePath);
  if (!state) {
    return { status: 'unknown', progress: '-' };
  }
  
  const progress = `${(state.currentTaskIndex || 0) + 1}/${state.totalTasks || '?'}`;
  
  return {
    status: state.status || 'unknown',
    progress,
    label: state.label,
    error: state.error,
  };
}

/**
 * State management utilities for CursorFlow
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
export { LaneState, ConversationEntry, GitLogEntry, EventEntry };

/**
 * Save state to JSON file
 */
export function saveState(statePath: string, state: any): void {
  const stateDir = path.dirname(statePath);
  
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
  
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * Load state from JSON file
 */
export function loadState<T = any>(statePath: string): T | null {
  if (!fs.existsSync(statePath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(statePath, 'utf8');
    return JSON.parse(content) as T;
  } catch (error: any) {
    console.warn(`Warning: Failed to parse state file ${statePath}: ${error.message}`);
    return null;
  }
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
    dependsOn: config.dependsOn || [],
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

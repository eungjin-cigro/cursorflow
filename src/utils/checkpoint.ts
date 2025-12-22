/**
 * Checkpoint and recovery system for CursorFlow
 */

import * as fs from 'fs';
import * as path from 'path';
import { safeJoin } from './path';
import * as git from './git';
import { LaneState } from './types';
import { loadState, saveState } from './state';
import * as logger from './logger';

export interface GitState {
  branch: string | null;
  commit: string | null;
  uncommittedChanges: boolean;
  changedFiles: string[];
}

export interface Checkpoint {
  id: string;
  timestamp: number;
  laneName: string;
  laneState: LaneState;
  gitState: GitState | null;
  taskIndex: number;
  description?: string;
}

export interface CheckpointOptions {
  /** Directory to store checkpoints */
  checkpointDir?: string;
  /** Maximum number of checkpoints to keep per lane */
  maxCheckpoints?: number;
  /** Description of the checkpoint */
  description?: string;
}

const DEFAULT_MAX_CHECKPOINTS = 10;

/**
 * Get checkpoint directory for a lane
 */
export function getCheckpointDir(laneDir: string): string {
  return safeJoin(laneDir, 'checkpoints');
}

/**
 * Generate checkpoint ID
 */
function generateCheckpointId(): string {
  return `cp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
}

/**
 * Create a checkpoint for a lane
 */
export async function createCheckpoint(
  laneName: string,
  laneDir: string,
  worktreeDir: string | null,
  options: CheckpointOptions = {}
): Promise<Checkpoint> {
  const checkpointDir = options.checkpointDir || getCheckpointDir(laneDir);
  const maxCheckpoints = options.maxCheckpoints || DEFAULT_MAX_CHECKPOINTS;

  // Ensure checkpoint directory exists
  if (!fs.existsSync(checkpointDir)) {
    fs.mkdirSync(checkpointDir, { recursive: true });
  }

  // Load current lane state
  const statePath = safeJoin(laneDir, 'state.json');
  const laneState = loadState<LaneState>(statePath);
  
  if (!laneState) {
    throw new Error(`Cannot create checkpoint: Lane state not found at ${statePath}`);
  }

  // Get Git state if worktree exists
  let gitState: GitState | null = null;
  if (worktreeDir && fs.existsSync(worktreeDir)) {
    try {
      const branch = git.getCurrentBranch(worktreeDir);
      const commit = git.runGit(['rev-parse', 'HEAD'], { cwd: worktreeDir, silent: true });
      const changedFiles = git.getChangedFiles(worktreeDir);

      gitState = {
        branch,
        commit,
        uncommittedChanges: changedFiles.length > 0,
        changedFiles: changedFiles.map(f => f.file),
      };
    } catch (e) {
      logger.warn(`Failed to capture Git state for checkpoint: ${e}`);
    }
  }

  // Create checkpoint
  const checkpoint: Checkpoint = {
    id: generateCheckpointId(),
    timestamp: Date.now(),
    laneName,
    laneState: { ...laneState },
    gitState,
    taskIndex: laneState.currentTaskIndex,
    description: options.description,
  };

  // Save checkpoint
  const checkpointPath = safeJoin(checkpointDir, `${checkpoint.id}.json`);
  fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2), 'utf8');

  // Cleanup old checkpoints
  await cleanupOldCheckpoints(checkpointDir, maxCheckpoints);

  logger.info(`Created checkpoint: ${checkpoint.id} (task ${checkpoint.taskIndex})`);

  return checkpoint;
}

/**
 * List all checkpoints for a lane
 */
export function listCheckpoints(laneDir: string): Checkpoint[] {
  const checkpointDir = getCheckpointDir(laneDir);
  
  if (!fs.existsSync(checkpointDir)) {
    return [];
  }

  const files = fs.readdirSync(checkpointDir)
    .filter(f => f.startsWith('cp-') && f.endsWith('.json'))
    .sort()
    .reverse(); // Most recent first

  return files.map(f => {
    try {
      const content = fs.readFileSync(safeJoin(checkpointDir, f), 'utf8');
      return JSON.parse(content) as Checkpoint;
    } catch {
      return null;
    }
  }).filter((cp): cp is Checkpoint => cp !== null);
}

/**
 * Get a specific checkpoint
 */
export function getCheckpoint(laneDir: string, checkpointId: string): Checkpoint | null {
  const checkpointDir = getCheckpointDir(laneDir);
  const checkpointPath = safeJoin(checkpointDir, `${checkpointId}.json`);

  if (!fs.existsSync(checkpointPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(checkpointPath, 'utf8');
    return JSON.parse(content) as Checkpoint;
  } catch {
    return null;
  }
}

/**
 * Get the latest checkpoint for a lane
 */
export function getLatestCheckpoint(laneDir: string): Checkpoint | null {
  const checkpoints = listCheckpoints(laneDir);
  return checkpoints.length > 0 ? checkpoints[0]! : null;
}

/**
 * Restore lane state from a checkpoint
 */
export async function restoreFromCheckpoint(
  checkpoint: Checkpoint,
  laneDir: string,
  options: {
    restoreGitState?: boolean;
    worktreeDir?: string;
  } = {}
): Promise<{ success: boolean; warnings: string[] }> {
  const warnings: string[] = [];

  // Restore lane state
  const statePath = safeJoin(laneDir, 'state.json');
  const restoredState: LaneState = {
    ...checkpoint.laneState,
    status: 'pending', // Reset status for resume
    error: null,
    updatedAt: Date.now(),
  };
  saveState(statePath, restoredState);

  logger.info(`Restored lane state from checkpoint ${checkpoint.id}`);

  // Restore Git state if requested
  if (options.restoreGitState && checkpoint.gitState && options.worktreeDir) {
    const worktreeDir = options.worktreeDir;
    
    if (!fs.existsSync(worktreeDir)) {
      warnings.push(`Worktree not found: ${worktreeDir}`);
    } else {
      try {
        // Check for uncommitted changes
        if (git.hasUncommittedChanges(worktreeDir)) {
          warnings.push('Worktree has uncommitted changes. Stashing...');
          git.runGit(['stash', 'push', '-m', `Pre-restore checkpoint ${checkpoint.id}`], { cwd: worktreeDir });
        }

        // Checkout the checkpoint commit if available
        if (checkpoint.gitState.commit) {
          git.runGit(['checkout', checkpoint.gitState.commit], { cwd: worktreeDir, silent: true });
          logger.info(`Restored Git state to commit ${checkpoint.gitState.commit.substring(0, 7)}`);
        }
      } catch (e: any) {
        warnings.push(`Failed to restore Git state: ${e.message}`);
      }
    }
  }

  return { success: true, warnings };
}

/**
 * Delete a checkpoint
 */
export function deleteCheckpoint(laneDir: string, checkpointId: string): boolean {
  const checkpointDir = getCheckpointDir(laneDir);
  const checkpointPath = safeJoin(checkpointDir, `${checkpointId}.json`);

  if (!fs.existsSync(checkpointPath)) {
    return false;
  }

  try {
    fs.unlinkSync(checkpointPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Clean up old checkpoints, keeping only the most recent ones
 */
async function cleanupOldCheckpoints(checkpointDir: string, maxCheckpoints: number): Promise<number> {
  if (!fs.existsSync(checkpointDir)) {
    return 0;
  }

  const files = fs.readdirSync(checkpointDir)
    .filter(f => f.startsWith('cp-') && f.endsWith('.json'))
    .sort()
    .reverse();

  let deleted = 0;
  for (let i = maxCheckpoints; i < files.length; i++) {
    try {
      fs.unlinkSync(safeJoin(checkpointDir, files[i]!));
      deleted++;
    } catch {
      // Ignore
    }
  }

  return deleted;
}

/**
 * Auto-checkpoint decorator - creates checkpoints before critical operations
 */
export function withAutoCheckpoint<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  options: {
    getLaneDir: (...args: Parameters<T>) => string;
    getLaneName: (...args: Parameters<T>) => string;
    getWorktreeDir?: (...args: Parameters<T>) => string | null;
    description?: string;
  }
): T {
  return (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    const laneDir = options.getLaneDir(...args);
    const laneName = options.getLaneName(...args);
    const worktreeDir = options.getWorktreeDir?.(...args) || null;

    try {
      await createCheckpoint(laneName, laneDir, worktreeDir, {
        description: options.description || `Before ${fn.name}`,
      });
    } catch (e) {
      logger.warn(`Auto-checkpoint failed: ${e}`);
    }

    return fn(...args);
  }) as T;
}

/**
 * Find the best checkpoint to recover from after a failure
 */
export function findRecoveryCheckpoint(
  laneDir: string,
  targetTaskIndex?: number
): Checkpoint | null {
  const checkpoints = listCheckpoints(laneDir);
  
  if (checkpoints.length === 0) {
    return null;
  }

  // If target task index is specified, find the checkpoint just before it
  if (targetTaskIndex !== undefined) {
    for (const cp of checkpoints) {
      if (cp.taskIndex <= targetTaskIndex) {
        return cp;
      }
    }
  }

  // Return the latest checkpoint
  return checkpoints[0]!;
}

/**
 * Checkpoint statistics for monitoring
 */
export interface CheckpointStats {
  totalCheckpoints: number;
  oldestTimestamp: number | null;
  newestTimestamp: number | null;
  totalSizeBytes: number;
}

/**
 * Get checkpoint statistics for a lane
 */
export function getCheckpointStats(laneDir: string): CheckpointStats {
  const checkpointDir = getCheckpointDir(laneDir);
  
  if (!fs.existsSync(checkpointDir)) {
    return {
      totalCheckpoints: 0,
      oldestTimestamp: null,
      newestTimestamp: null,
      totalSizeBytes: 0,
    };
  }

  const checkpoints = listCheckpoints(laneDir);
  let totalSize = 0;

  const files = fs.readdirSync(checkpointDir)
    .filter(f => f.startsWith('cp-') && f.endsWith('.json'));

  for (const f of files) {
    try {
      const stat = fs.statSync(safeJoin(checkpointDir, f));
      totalSize += stat.size;
    } catch {
      // Ignore
    }
  }

  return {
    totalCheckpoints: checkpoints.length,
    oldestTimestamp: checkpoints.length > 0 ? checkpoints[checkpoints.length - 1]!.timestamp : null,
    newestTimestamp: checkpoints.length > 0 ? checkpoints[0]!.timestamp : null,
    totalSizeBytes: totalSize,
  };
}


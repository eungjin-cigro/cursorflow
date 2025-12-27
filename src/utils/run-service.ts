/**
 * RunService - Manages CursorFlow run history and active processes
 * 
 * Provides:
 * - List all runs (with filtering by status)
 * - Get detailed run information
 * - Stop running processes
 * - Delete run resources
 */

import * as fs from 'fs';
import * as path from 'path';
import { RunStatus, RunInfo, LaneInfo, LaneState } from './types';
import * as logger from './logger';

export interface RunFilter {
  status?: RunStatus;
  limit?: number;
  taskName?: string;
}

export interface RunResources {
  branches: string[];
  worktrees: string[];
  logSize: number;
}

export class RunService {
  private logsDir: string;
  private runsDir: string;

  constructor(logsDir: string) {
    this.logsDir = logsDir;
    this.runsDir = path.join(logsDir, 'runs');
  }

  /**
   * List all runs with optional filtering
   */
  listRuns(filter: RunFilter = {}): RunInfo[] {
    const { status, limit, taskName } = filter;
    
    if (!fs.existsSync(this.runsDir)) {
      return [];
    }

    const runDirs = fs.readdirSync(this.runsDir)
      .filter(name => name.startsWith('run-'))
      .sort((a, b) => b.localeCompare(a)); // Most recent first

    let runs: RunInfo[] = [];

    for (const runId of runDirs) {
      const runInfo = this.getRunInfo(runId);
      
      if (!runInfo) continue;

      // Apply filters
      if (status && runInfo.status !== status) continue;
      if (taskName && !runInfo.taskName.toLowerCase().includes(taskName.toLowerCase())) continue;

      runs.push(runInfo);

      if (limit && runs.length >= limit) break;
    }

    return runs;
  }

  /**
   * Get detailed information about a specific run
   */
  getRunInfo(runId: string): RunInfo | null {
    const runPath = path.join(this.runsDir, runId);
    
    if (!fs.existsSync(runPath)) {
      return null;
    }

    try {
      // Read orchestrator state
      const statePath = path.join(runPath, 'state.json');
      let taskName = 'Unknown';
      let lanes: LaneInfo[] = [];
      let branches: string[] = [];
      let worktrees: string[] = [];

      if (fs.existsSync(statePath)) {
        const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
        taskName = state.taskName || this.extractTaskNameFromRunId(runId);
        
        // Extract lane info from state
        if (state.lanes) {
          for (const [laneName, laneState] of Object.entries(state.lanes)) {
            const ls = laneState as LaneState;
            lanes.push({
              name: laneName,
              status: ls.status,
              currentTask: ls.currentTaskIndex,
              totalTasks: ls.totalTasks,
              pid: ls.pid,
              pipelineBranch: ls.pipelineBranch || undefined,
            });
            
            if (ls.pipelineBranch) {
              branches.push(ls.pipelineBranch);
            }
            if (ls.worktreeDir) {
              worktrees.push(ls.worktreeDir);
            }
          }
        }
      }

      // Alternatively, scan lanes directory
      const lanesDir = path.join(runPath, 'lanes');
      if (fs.existsSync(lanesDir) && lanes.length === 0) {
        const laneDirs = fs.readdirSync(lanesDir);
        for (const laneName of laneDirs) {
          const laneStatePath = path.join(lanesDir, laneName, 'state.json');
          if (fs.existsSync(laneStatePath)) {
            try {
              const laneState = JSON.parse(fs.readFileSync(laneStatePath, 'utf-8')) as LaneState;
              lanes.push({
                name: laneName,
                status: laneState.status,
                currentTask: laneState.currentTaskIndex,
                totalTasks: laneState.totalTasks,
                pid: laneState.pid,
                pipelineBranch: laneState.pipelineBranch || undefined,
              });
              
              if (laneState.pipelineBranch) {
                branches.push(laneState.pipelineBranch);
              }
              if (laneState.worktreeDir) {
                worktrees.push(laneState.worktreeDir);
              }
            } catch {
              // Skip invalid state files
            }
          }
        }
      }

      // Calculate run status and timing
      const status = this.calculateRunStatus(lanes);
      const startTime = this.extractTimestampFromRunId(runId);
      const endTime = this.getRunEndTime(runPath, lanes);
      const duration = endTime ? endTime - startTime : Date.now() - startTime;

      return {
        id: runId,
        path: runPath,
        taskName,
        status,
        startTime,
        endTime,
        duration,
        lanes,
        branches: [...new Set(branches)],
        worktrees: [...new Set(worktrees)],
      };
    } catch (error) {
      logger.debug(`Failed to read run info for ${runId}: ${error}`);
      return null;
    }
  }

  /**
   * Get currently active (running) runs
   */
  getActiveRuns(): RunInfo[] {
    return this.listRuns({ status: 'running' });
  }

  /**
   * Calculate overall run status based on lane statuses
   */
  private calculateRunStatus(lanes: LaneInfo[]): RunStatus {
    if (lanes.length === 0) return 'pending';

    const statuses = lanes.map(l => l.status);
    
    // If any lane is running, the run is running
    if (statuses.some(s => s === 'running')) {
      return 'running';
    }
    
    // If all lanes are completed, the run is completed
    if (statuses.every(s => s === 'completed')) {
      return 'completed';
    }
    
    // If any lane failed and none are running, check for partial completion
    if (statuses.some(s => s === 'failed')) {
      const hasCompleted = statuses.some(s => s === 'completed');
      return hasCompleted ? 'partial' : 'failed';
    }
    
    // If some are pending and some completed
    if (statuses.some(s => s === 'pending' || s === 'waiting')) {
      return statuses.some(s => s === 'completed') ? 'partial' : 'pending';
    }

    return 'pending';
  }

  /**
   * Extract timestamp from run ID (format: run-TIMESTAMP)
   */
  private extractTimestampFromRunId(runId: string): number {
    const match = runId.match(/run-(\d+)/);
    return match ? parseInt(match[1], 10) : Date.now();
  }

  /**
   * Extract task name from run ID or directory structure
   */
  private extractTaskNameFromRunId(runId: string): string {
    // Try to read from any lane's tasks file reference
    const runPath = path.join(this.runsDir, runId);
    const lanesDir = path.join(runPath, 'lanes');
    
    if (fs.existsSync(lanesDir)) {
      const laneDirs = fs.readdirSync(lanesDir);
      for (const laneName of laneDirs) {
        const statePath = path.join(lanesDir, laneName, 'state.json');
        if (fs.existsSync(statePath)) {
          try {
            const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
            if (state.tasksFile) {
              const taskDir = path.basename(path.dirname(state.tasksFile));
              // Extract feature name from timestamp_FeatureName format
              const parts = taskDir.split('_');
              if (parts.length >= 2) {
                return parts.slice(1).join('_');
              }
              return taskDir;
            }
          } catch {
            // Continue to next lane
          }
        }
      }
    }
    
    return 'Unknown';
  }

  /**
   * Get run end time from lane states
   */
  private getRunEndTime(runPath: string, lanes: LaneInfo[]): number | undefined {
    const terminalStatuses = ['completed', 'failed'];
    
    if (!lanes.every(l => terminalStatuses.includes(l.status))) {
      return undefined; // Still running
    }

    // Find the latest end time from lane states
    const lanesDir = path.join(runPath, 'lanes');
    let latestEndTime = 0;

    if (fs.existsSync(lanesDir)) {
      const laneDirs = fs.readdirSync(lanesDir);
      for (const laneName of laneDirs) {
        const statePath = path.join(lanesDir, laneName, 'state.json');
        if (fs.existsSync(statePath)) {
          try {
            const state = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as LaneState;
            if (state.endTime && state.endTime > latestEndTime) {
              latestEndTime = state.endTime;
            }
          } catch {
            // Skip
          }
        }
      }
    }

    return latestEndTime > 0 ? latestEndTime : undefined;
  }

  /**
   * Get resources linked to a run (branches, worktrees)
   */
  getLinkedResources(runId: string): RunResources {
    const runInfo = this.getRunInfo(runId);
    
    if (!runInfo) {
      return { branches: [], worktrees: [], logSize: 0 };
    }

    // Calculate log size
    let logSize = 0;
    try {
      logSize = this.getDirectorySize(runInfo.path);
    } catch {
      // Ignore size calculation errors
    }

    return {
      branches: runInfo.branches,
      worktrees: runInfo.worktrees,
      logSize,
    };
  }

  /**
   * Stop a running workflow
   */
  stopRun(runId: string): boolean {
    const runInfo = this.getRunInfo(runId);
    
    if (!runInfo || runInfo.status !== 'running') {
      return false;
    }

    let stopped = false;
    for (const lane of runInfo.lanes) {
      if (lane.pid && lane.status === 'running') {
        try {
          process.kill(lane.pid, 'SIGTERM');
          stopped = true;
          logger.info(`Stopped lane ${lane.name} (PID: ${lane.pid})`, { context: runId });
        } catch (error) {
          logger.debug(`Failed to stop lane ${lane.name}: ${error}`);
        }
      }
    }

    return stopped;
  }

  /**
   * Stop all running workflows
   */
  stopAllRuns(): number {
    const activeRuns = this.getActiveRuns();
    let stoppedCount = 0;

    for (const run of activeRuns) {
      if (this.stopRun(run.id)) {
        stoppedCount++;
      }
    }

    return stoppedCount;
  }

  /**
   * Delete a run and optionally its associated resources
   */
  deleteRun(runId: string, options: { includeBranches?: boolean; force?: boolean } = {}): void {
    const runInfo = this.getRunInfo(runId);
    
    if (!runInfo) {
      throw new Error(`Run not found: ${runId}`);
    }

    // Don't delete running runs
    if (runInfo.status === 'running') {
      throw new Error(`Cannot delete running run: ${runId}. Stop it first.`);
    }

    // Delete log directory
    if (fs.existsSync(runInfo.path)) {
      fs.rmSync(runInfo.path, { recursive: true, force: true });
      logger.success(`Deleted run logs: ${runId}`);
    }

    // Note: Branch and worktree deletion should be handled by clean command
    // as it requires git operations
  }

  /**
   * Calculate directory size in bytes
   */
  private getDirectorySize(dirPath: string): number {
    let size = 0;
    
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stat = fs.statSync(filePath);
      
      if (stat.isDirectory()) {
        size += this.getDirectorySize(filePath);
      } else {
        size += stat.size;
      }
    }
    
    return size;
  }

  /**
   * Format duration for display
   */
  static formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Format bytes for display
   */
  static formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
}

/**
 * Create a RunService instance with default paths
 */
export function createRunService(projectRoot?: string): RunService {
  const root = projectRoot || process.cwd();
  const logsDir = path.join(root, '_cursorflow', 'logs');
  return new RunService(logsDir);
}

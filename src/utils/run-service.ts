import * as fs from 'fs';
import * as path from 'path';
import { safeJoin } from './path';
import { loadState, listLanesInRun } from './state';
import { LaneState, RunInfo, LaneInfo, RunStatus } from './types';
import * as git from './git';
import { ProcessManager } from './process-manager';

export interface ListRunsFilter {
  status?: RunStatus;
  limit?: number;
}

export class RunService {
  private logsDir: string;

  constructor(logsDir: string) {
    this.logsDir = logsDir;
  }

  /**
   * List all runs in the logs directory
   */
  listRuns(filter?: ListRunsFilter): RunInfo[] {
    if (!fs.existsSync(this.logsDir)) {
      return [];
    }

    const runs = fs.readdirSync(this.logsDir)
      .filter(f => fs.statSync(safeJoin(this.logsDir, f)).isDirectory() && f.startsWith('run-'))
      .map(runId => this.getRunInfo(runId))
      .filter((run): run is RunInfo => run !== null)
      .sort((a, b) => b.startTime - a.startTime);

    let result = runs;
    if (filter?.status) {
      result = result.filter(r => r.status === filter.status);
    }
    if (filter?.limit) {
      result = result.slice(0, filter.limit);
    }

    return result;
  }

  /**
   * Get detailed information for a single run
   */
  getRunInfo(runId: string): RunInfo | null {
    const runPath = safeJoin(this.logsDir, runId);
    if (!fs.existsSync(runPath)) {
      return null;
    }

    const lanes = listLanesInRun(runPath).map(l => {
      const state = loadState<LaneState>(l.statePath);
      return {
        name: l.name,
        status: state?.status || 'unknown',
        currentTask: (state?.currentTaskIndex || 0) + 1,
        totalTasks: state?.totalTasks || 0,
        pid: state?.pid,
        pipelineBranch: state?.pipelineBranch,
        worktreeDir: state?.worktreeDir,
        startTime: state?.startTime || 0,
        endTime: state?.endTime || 0
      };
    });

    const status = this.calculateRunStatusFromLanes(lanes);
    
    // Extract task name from meta.json if it exists, otherwise use runId
    let taskName = runId;
    const metaPath = safeJoin(runPath, 'meta.json');
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        if (meta.taskName) {
          taskName = meta.taskName;
        }
      } catch (e) {
        // Ignore
      }
    }

    // Associated resources
    const branches = Array.from(new Set(lanes.map(l => l.pipelineBranch).filter((b): b is string => !!b)));
    const worktrees = Array.from(new Set(lanes.map(l => l.worktreeDir).filter((w): w is string => !!w)));

    // Start time and duration
    const startTimes = lanes.map(l => l.startTime).filter(t => t > 0);
    const startTime = startTimes.length > 0 ? Math.min(...startTimes) : fs.statSync(runPath).birthtimeMs;
    
    const endTimes = lanes.map(l => l.endTime).filter(t => t > 0);
    
    let duration = 0;
    if (status === 'running') {
      duration = Date.now() - startTime;
    } else if (endTimes.length > 0) {
      const endTime = Math.max(...endTimes);
      duration = endTime - startTime;
    } else {
      // If no end times but not running, use last modified time of run dir
      const mtime = fs.statSync(runPath).mtimeMs;
      duration = mtime - startTime;
    }

    return {
      id: runId,
      path: runPath,
      taskName,
      status,
      startTime,
      duration,
      lanes: lanes.map(l => ({
        name: l.name,
        status: l.status,
        currentTask: l.currentTask,
        totalTasks: l.totalTasks,
        pid: l.pid
      })),
      branches,
      worktrees
    };
  }

  /**
   * Get all currently running runs
   */
  getActiveRuns(): RunInfo[] {
    return this.listRuns({ status: 'running' });
  }

  /**
   * Calculate overall run status based on individual lane statuses
   */
  calculateRunStatus(runPath: string): RunStatus {
    const lanes = listLanesInRun(runPath).map(l => {
      const state = loadState<LaneState>(l.statePath);
      return {
        status: state?.status || 'unknown'
      };
    });
    return this.calculateRunStatusFromLanes(lanes);
  }

  private calculateRunStatusFromLanes(lanes: { status: string }[]): RunStatus {
    if (lanes.length === 0) return 'pending';

    const statuses = lanes.map(l => l.status);
    
    if (statuses.some(s => s === 'running' || s === 'reviewing' || s === 'waiting' || s === 'paused')) {
      return 'running';
    }
    
    if (statuses.every(s => s === 'completed')) {
      return 'completed';
    }
    
    if (statuses.some(s => s === 'failed')) {
      return statuses.some(s => s === 'completed') ? 'partial' : 'failed';
    }

    if (statuses.some(s => s === 'completed')) {
      return 'partial';
    }

    return 'pending';
  }

  /**
   * Get Git branches and worktrees linked to a run
   */
  getLinkedResources(runId: string): { branches: string[]; worktrees: string[] } {
    const run = this.getRunInfo(runId);
    if (!run) return { branches: [], worktrees: [] };
    return {
      branches: run.branches,
      worktrees: run.worktrees
    };
  }

  /**
   * Stop a specific run by killing all lane processes
   */
  stopRun(runId: string): boolean {
    const run = this.getRunInfo(runId);
    if (!run) return false;

    let stopped = false;
    for (const lane of run.lanes) {
      if (lane.pid) {
        if (ProcessManager.killProcess(lane.pid)) {
          stopped = true;
        }
      }
    }
    return stopped;
  }

  /**
   * Stop all active runs
   */
  stopAllRuns(): number {
    const activeRuns = this.getActiveRuns();
    let count = 0;
    for (const run of activeRuns) {
      if (this.stopRun(run.id)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Delete a run and optionally its associated resources
   */
  deleteRun(runId: string, options?: { includeBranches?: boolean; force?: boolean }): void {
    const run = this.getRunInfo(runId);
    if (!run) return;

    if (run.status === 'running' && !options?.force) {
      throw new Error(`Cannot delete running run ${runId}. Use force: true to stop and delete.`);
    }

    if (run.status === 'running') {
      this.stopRun(runId);
      
      // Wait up to 2 seconds for processes to exit
      let attempts = 0;
      while (attempts < 20) {
        const stillRunning = run.lanes.some(l => l.pid && ProcessManager.isProcessRunning(l.pid));
        if (!stillRunning) break;
        
        // Synchronous sleep
        const end = Date.now() + 100;
        while (Date.now() < end) {}
        attempts++;
      }
    }

    // Delete branches if requested
    if (options?.includeBranches) {
      for (const branch of run.branches) {
        try {
          git.deleteBranch(branch, { force: true });
        } catch (e) {
          // Ignore
        }
      }
    }

    // Delete run directory
    if (fs.existsSync(run.path)) {
      fs.rmSync(run.path, { recursive: true, force: true });
    }
  }
}

/**
 * Singleton factory for RunService
 */
let runServiceInstance: RunService | null = null;

export function getRunService(logsDir: string): RunService {
  if (!runServiceInstance) {
    runServiceInstance = new RunService(logsDir);
  }
  return runServiceInstance;
}

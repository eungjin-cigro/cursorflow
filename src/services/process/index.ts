/**
 * Process Management Service
 * 
 * Utilities for detecting and managing lane processes.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawnSync } from 'child_process';

export interface ProcessInfo {
  pid: number;
  exists: boolean;
  isRunning: boolean;
  command?: string;
  uptime?: number;
  cpuPercent?: number;
  memoryMb?: number;
}

export interface LaneProcessStatus {
  laneName: string;
  pid: number | null;
  processExists: boolean;
  processRunning: boolean;
  stateStatus: string;
  actualStatus: 'running' | 'dead' | 'unknown' | 'completed' | 'failed' | 'pending';
  startTime: number | null;
  endTime: number | null;
  duration: number;
  isStale: boolean;
  processInfo?: ProcessInfo;
}

/**
 * Check if a process exists and is running
 */
export function checkProcess(pid: number): ProcessInfo {
  const result: ProcessInfo = {
    pid,
    exists: false,
    isRunning: false,
  };

  try {
    // Send signal 0 to check if process exists
    process.kill(pid, 0);
    result.exists = true;
    result.isRunning = true;

    // Try to get more info on Linux/macOS
    if (process.platform !== 'win32') {
      try {
        const psResult = spawnSync('ps', ['-p', pid.toString(), '-o', 'pid,stat,comm,etime,%cpu,%mem'], {
          encoding: 'utf8',
          timeout: 1000,
        });

        if (psResult.status === 0) {
          const psOutput = psResult.stdout.trim();
          const lines = psOutput.split('\n');
          if (lines.length > 1) {
            const fields = lines[1]!.trim().split(/\s+/);
            if (fields.length >= 4) {
              result.command = fields[2];
              
              // Parse elapsed time (formats: MM:SS, HH:MM:SS, D-HH:MM:SS)
              const etime = fields[3]!;
              result.uptime = parseElapsedTime(etime);
              
              if (fields.length >= 5) {
                result.cpuPercent = parseFloat(fields[4]!);
              }
              if (fields.length >= 6) {
                result.memoryMb = parseFloat(fields[5]!);
              }
            }
          }
        }
      } catch {
        // ps failed, but process exists
      }
    }
  } catch (err: any) {
    // ESRCH = no such process
    // EPERM = permission denied but process exists
    if (err.code === 'EPERM') {
      result.exists = true;
      result.isRunning = true;
    }
  }

  return result;
}

/**
 * Parse ps elapsed time format to milliseconds
 */
function parseElapsedTime(etime: string): number {
  // Formats: SS, MM:SS, HH:MM:SS, D-HH:MM:SS
  const parts = etime.split('-');
  let days = 0;
  let timeStr = etime;

  if (parts.length === 2) {
    days = parseInt(parts[0]!, 10);
    timeStr = parts[1]!;
  }

  const timeParts = timeStr.split(':').reverse();
  let seconds = 0;

  if (timeParts.length >= 1) seconds += parseInt(timeParts[0]!, 10);
  if (timeParts.length >= 2) seconds += parseInt(timeParts[1]!, 10) * 60;
  if (timeParts.length >= 3) seconds += parseInt(timeParts[2]!, 10) * 3600;
  seconds += days * 86400;

  return seconds * 1000;
}

/**
 * Get accurate lane process status
 */
export function getLaneProcessStatus(lanePath: string, laneName: string): LaneProcessStatus {
  const statePath = path.join(lanePath, 'state.json');
  
  const result: LaneProcessStatus = {
    laneName,
    pid: null,
    processExists: false,
    processRunning: false,
    stateStatus: 'unknown',
    actualStatus: 'unknown',
    startTime: null,
    endTime: null,
    duration: 0,
    isStale: false,
  };

  if (!fs.existsSync(statePath)) {
    result.stateStatus = 'pending';
    result.actualStatus = 'pending';
    return result;
  }

  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    result.stateStatus = state.status || 'unknown';
    result.pid = state.pid || null;
    result.startTime = state.startTime || null;
    result.endTime = state.endTime || null;

    // Calculate duration
    if (result.startTime) {
      if (result.endTime) {
        result.duration = result.endTime - result.startTime;
      } else if (result.stateStatus === 'running') {
        result.duration = Date.now() - result.startTime;
      }
    }

    // Determine actual status based on process check
    if (result.stateStatus === 'completed') {
      result.actualStatus = 'completed';
    } else if (result.stateStatus === 'failed') {
      result.actualStatus = 'failed';
    } else if (result.stateStatus === 'pending' || result.stateStatus === 'waiting') {
      result.actualStatus = 'pending';
    } else if (result.pid) {
      // Check if process is actually running
      const processInfo = checkProcess(result.pid);
      result.processInfo = processInfo;
      result.processExists = processInfo.exists;
      result.processRunning = processInfo.isRunning;

      if (processInfo.isRunning) {
        result.actualStatus = 'running';
      } else {
        // Process is gone but state says running - stale state
        result.actualStatus = 'dead';
        result.isStale = true;
      }
    } else {
      // No PID but state says running
      if (result.stateStatus === 'running') {
        result.actualStatus = 'dead';
        result.isStale = true;
      } else {
        result.actualStatus = 'pending';
      }
    }
  } catch {
    result.actualStatus = 'unknown';
  }

  return result;
}

/**
 * Get all lane process statuses for a run directory
 */
export function getAllLaneProcessStatuses(runDir: string): LaneProcessStatus[] {
  const lanesDir = path.join(runDir, 'lanes');
  if (!fs.existsSync(lanesDir)) return [];

  const lanes = fs.readdirSync(lanesDir).filter(name => {
    const dirPath = path.join(lanesDir, name);
    return fs.statSync(dirPath).isDirectory();
  });

  return lanes.map(laneName => {
    const lanePath = path.join(lanesDir, laneName);
    return getLaneProcessStatus(lanePath, laneName);
  });
}

/**
 * Check if any flow process is alive
 */
export function isFlowAlive(runDir: string): boolean {
  const statuses = getAllLaneProcessStatuses(runDir);
  return statuses.some(s => s.actualStatus === 'running');
}

/**
 * Get flow status summary
 */
export function getFlowSummary(runDir: string): {
  total: number;
  running: number;
  completed: number;
  failed: number;
  pending: number;
  dead: number;
  isAlive: boolean;
} {
  const statuses = getAllLaneProcessStatuses(runDir);
  
  return {
    total: statuses.length,
    running: statuses.filter(s => s.actualStatus === 'running').length,
    completed: statuses.filter(s => s.actualStatus === 'completed').length,
    failed: statuses.filter(s => s.actualStatus === 'failed').length,
    pending: statuses.filter(s => s.actualStatus === 'pending').length,
    dead: statuses.filter(s => s.actualStatus === 'dead').length,
    isAlive: statuses.some(s => s.actualStatus === 'running'),
  };
}

/**
 * Kill a lane process
 */
export function killLaneProcess(pid: number, signal: NodeJS.Signals = 'SIGTERM'): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}


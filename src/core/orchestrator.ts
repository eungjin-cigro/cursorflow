/**
 * Orchestrator - Parallel lane execution with dependency management
 * 
 * Adapted from admin-domains-orchestrator.js
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';

import * as logger from '../utils/logger';
import { loadState } from '../utils/state';
import { LaneState, RunnerConfig } from '../utils/types';

export interface LaneInfo {
  name: string;
  path: string;
  dependsOn: string[];
}

export interface SpawnLaneResult {
  child: ChildProcess;
  logPath: string;
}

/**
 * Spawn a lane process
 */
export function spawnLane({ tasksFile, laneRunDir, executor }: { 
  laneName: string; 
  tasksFile: string; 
  laneRunDir: string; 
  executor: string; 
}): SpawnLaneResult {
  fs.mkdirSync(laneRunDir, { recursive: true});
  const logPath = path.join(laneRunDir, 'terminal.log');
  const logFd = fs.openSync(logPath, 'a');
  
  // Use extension-less resolve to handle both .ts (dev) and .js (dist)
  const runnerPath = require.resolve('./runner');
  
  const args = [
    runnerPath,
    tasksFile,
    '--run-dir', laneRunDir,
    '--executor', executor,
  ];
  
  const child = spawn('node', args, {
    stdio: ['ignore', logFd, logFd],
    env: process.env,
    detached: false,
  });
  
  try {
    fs.closeSync(logFd);
  } catch {
    // Ignore
  }
  
  return { child, logPath };
}

/**
 * Wait for child process to exit
 */
export function waitChild(proc: ChildProcess): Promise<number> {
  return new Promise((resolve) => {
    if (proc.exitCode !== null) {
      resolve(proc.exitCode);
      return;
    }
    
    proc.once('exit', (code) => resolve(code ?? 1));
    proc.once('error', () => resolve(1));
  });
}

/**
 * List lane task files in directory and load their configs for dependencies
 */
export function listLaneFiles(tasksDir: string): LaneInfo[] {
  if (!fs.existsSync(tasksDir)) {
    return [];
  }
  
  const files = fs.readdirSync(tasksDir);
  return files
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => {
      const filePath = path.join(tasksDir, f);
      const name = path.basename(f, '.json');
      let dependsOn: string[] = [];
      
      try {
        const config = JSON.parse(fs.readFileSync(filePath, 'utf8')) as RunnerConfig;
        dependsOn = config.dependsOn || [];
      } catch (e) {
        logger.warn(`Failed to parse config for lane ${name}: ${e}`);
      }
      
      return {
        name,
        path: filePath,
        dependsOn,
      };
    });
}

/**
 * Monitor lane states
 */
export function printLaneStatus(lanes: LaneInfo[], laneRunDirs: Record<string, string>): void {
  const rows = lanes.map(lane => {
    const dir = laneRunDirs[lane.name];
    if (!dir) return { lane: lane.name, status: '(unknown)', task: '-' };
    
    const statePath = path.join(dir, 'state.json');
    const state = loadState<LaneState>(statePath);
    
    if (!state) {
      const isWaiting = lane.dependsOn.length > 0;
      return { lane: lane.name, status: isWaiting ? 'waiting' : 'pending', task: '-' };
    }
    
    const idx = (state.currentTaskIndex || 0) + 1;
    return {
      lane: lane.name,
      status: state.status || 'unknown',
      task: `${idx}/${state.totalTasks || '?'}`,
    };
  });
  
  logger.section('📡 Lane Status');
  for (const r of rows) {
    console.log(`- ${r.lane}: ${r.status} (${r.task})`);
  }
}

/**
 * Run orchestration with dependency management
 */
export async function orchestrate(tasksDir: string, options: { 
  runDir?: string; 
  executor?: string; 
  pollInterval?: number; 
  maxConcurrentLanes?: number;
} = {}): Promise<{ lanes: LaneInfo[]; exitCodes: Record<string, number>; runRoot: string }> {
  const lanes = listLaneFiles(tasksDir);
  
  if (lanes.length === 0) {
    throw new Error(`No lane task files found in ${tasksDir}`);
  }
  
  const runRoot = options.runDir || `_cursorflow/logs/runs/run-${Date.now()}`;
  fs.mkdirSync(runRoot, { recursive: true });
  
  const laneRunDirs: Record<string, string> = {};
  for (const lane of lanes) {
    laneRunDirs[lane.name] = path.join(runRoot, 'lanes', lane.name);
    fs.mkdirSync(laneRunDirs[lane.name], { recursive: true });
  }
  
  logger.section('🧭 Starting Orchestration');
  logger.info(`Tasks directory: ${tasksDir}`);
  logger.info(`Run directory: ${runRoot}`);
  logger.info(`Lanes: ${lanes.length}`);
  
  const maxConcurrent = options.maxConcurrentLanes || 10;
  const running: Map<string, { child: ChildProcess; logPath: string }> = new Map();
  const exitCodes: Record<string, number> = {};
  const completedLanes = new Set<string>();
  const failedLanes = new Set<string>();
  
  // Monitor lanes
  const monitorInterval = setInterval(() => {
    printLaneStatus(lanes, laneRunDirs);
  }, options.pollInterval || 60000);
  
  while (completedLanes.size + failedLanes.size < lanes.length) {
    // 1. Identify lanes ready to start
    const readyToStart = lanes.filter(lane => {
      // Not already running or completed
      if (running.has(lane.name) || completedLanes.has(lane.name) || failedLanes.has(lane.name)) {
        return false;
      }
      
      // Check dependencies
      for (const dep of lane.dependsOn) {
        if (failedLanes.has(dep)) {
          // If a dependency failed, this lane fails too
          logger.error(`Lane ${lane.name} failed because dependency ${dep} failed`);
          failedLanes.add(lane.name);
          exitCodes[lane.name] = 1;
          return false;
        }
        if (!completedLanes.has(dep)) {
          return false;
        }
      }
      return true;
    });
    
    // 2. Spawn ready lanes up to maxConcurrent
    for (const lane of readyToStart) {
      if (running.size >= maxConcurrent) break;
      
      logger.info(`Lane started: ${lane.name}`);
      const spawnResult = spawnLane({
        laneName: lane.name,
        tasksFile: lane.path,
        laneRunDir: laneRunDirs[lane.name]!,
        executor: options.executor || 'cursor-agent',
      });
      
      running.set(lane.name, spawnResult);
    }
    
    // 3. Wait for any running lane to finish
    if (running.size > 0) {
      // We need to wait for at least one to finish
      const promises = Array.from(running.entries()).map(async ([name, { child }]) => {
        const code = await waitChild(child);
        return { name, code };
      });
      
      const finished = await Promise.race(promises);
      
      running.delete(finished.name);
      exitCodes[finished.name] = finished.code;
      
      if (finished.code === 0 || finished.code === 2) {
        completedLanes.add(finished.name);
      } else {
        failedLanes.add(finished.name);
      }
      
      printLaneStatus(lanes, laneRunDirs);
    } else {
      // Nothing running and nothing ready (but not all finished)
      // This could happen if there's a circular dependency or some logic error
      if (readyToStart.length === 0 && completedLanes.size + failedLanes.size < lanes.length) {
        const remaining = lanes.filter(l => !completedLanes.has(l.name) && !failedLanes.has(l.name));
        logger.error(`Deadlock detected! Remaining lanes cannot start: ${remaining.map(l => l.name).join(', ')}`);
        for (const l of remaining) {
          failedLanes.add(l.name);
          exitCodes[l.name] = 1;
        }
      }
    }
  }
  
  clearInterval(monitorInterval);
  printLaneStatus(lanes, laneRunDirs);
  
  // Check for failures
  const failed = Object.entries(exitCodes).filter(([, code]) => code !== 0 && code !== 2);
  
  if (failed.length > 0) {
    logger.error(`Lanes failed: ${failed.map(([l, c]) => `${l}(${c})`).join(', ')}`);
    process.exit(1);
  }
  
  // Check for blocked lanes
  const blocked = Object.entries(exitCodes)
    .filter(([, code]) => code === 2)
    .map(([lane]) => lane);
  
  if (blocked.length > 0) {
    logger.warn(`Lanes blocked on dependency: ${blocked.join(', ')}`);
    logger.info('Handle dependency changes manually and resume lanes');
    process.exit(2);
  }
  
  logger.success('All lanes completed successfully!');
  return { lanes, exitCodes, runRoot };
}

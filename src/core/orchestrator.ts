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
import { LaneState } from '../utils/types';

export interface LaneInfo {
  name: string;
  path: string;
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
 * List lane task files in directory
 */
export function listLaneFiles(tasksDir: string): LaneInfo[] {
  if (!fs.existsSync(tasksDir)) {
    return [];
  }
  
  const files = fs.readdirSync(tasksDir);
  return files
    .filter(f => f.endsWith('.json'))
    .sort()
    .map(f => ({
      name: path.basename(f, '.json'),
      path: path.join(tasksDir, f),
    }));
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
      return { lane: lane.name, status: '(no state)', task: '-' };
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
 * Run orchestration
 */
export async function orchestrate(tasksDir: string, options: { 
  runDir?: string; 
  executor?: string; 
  pollInterval?: number; 
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
  }
  
  logger.section('🧭 Starting Orchestration');
  logger.info(`Tasks directory: ${tasksDir}`);
  logger.info(`Run directory: ${runRoot}`);
  logger.info(`Lanes: ${lanes.length}`);
  
  // Spawn all lanes
  const running: { lane: string; child: ChildProcess; logPath: string }[] = [];
  
  for (const lane of lanes) {
    const { child, logPath } = spawnLane({
      laneName: lane.name,
      tasksFile: lane.path,
      laneRunDir: laneRunDirs[lane.name]!,
      executor: options.executor || 'cursor-agent',
    });
    
    running.push({ lane: lane.name, child, logPath });
    logger.info(`Lane started: ${lane.name}`);
  }
  
  // Monitor lanes
  const monitorInterval = setInterval(() => {
    printLaneStatus(lanes, laneRunDirs);
  }, options.pollInterval || 60000);
  
  // Wait for all lanes
  const exitCodes: Record<string, number> = {};
  
  for (const r of running) {
    exitCodes[r.lane] = await waitChild(r.child);
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

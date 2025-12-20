/**
 * CursorFlow monitor command
 */

import * as fs from 'fs';
import * as path from 'path';
import * as logger from '../utils/logger';
import { loadState } from '../utils/state';
import { LaneState } from '../utils/types';
import { loadConfig } from '../utils/config';

interface MonitorOptions {
  runDir?: string;
  watch: boolean;
  interval: number;
}

function parseArgs(args: string[]): MonitorOptions {
  const watch = args.includes('--watch');
  const intervalIdx = args.indexOf('--interval');
  const interval = intervalIdx >= 0 ? parseInt(args[intervalIdx + 1] || '2') || 2 : 2;
  
  // Find run directory (first non-option argument)
  const runDir = args.find(arg => !arg.startsWith('--') && args.indexOf(arg) !== intervalIdx + 1);
  
  return {
    runDir,
    watch,
    interval,
  };
}

/**
 * Find the latest run directory
 */
function findLatestRunDir(logsDir: string): string | null {
  const runsDir = path.join(logsDir, 'runs');
  
  if (!fs.existsSync(runsDir)) {
    return null;
  }
  
  const runs = fs.readdirSync(runsDir)
    .filter(d => d.startsWith('run-'))
    .map(d => ({
      name: d,
      path: path.join(runsDir, d),
      mtime: fs.statSync(path.join(runsDir, d)).mtime.getTime(),
    }))
    .sort((a, b) => b.mtime - a.mtime);
  
  return runs.length > 0 ? runs[0]!.path : null;
}

/**
 * List all lanes in a run directory
 */
function listLanes(runDir: string): { name: string; path: string }[] {
  const lanesDir = path.join(runDir, 'lanes');
  
  if (!fs.existsSync(lanesDir)) {
    return [];
  }
  
  return fs.readdirSync(lanesDir)
    .filter(d => {
      const stat = fs.statSync(path.join(lanesDir, d));
      return stat.isDirectory();
    })
    .map(name => ({
      name,
      path: path.join(lanesDir, name),
    }));
}

/**
 * Get lane status
 */
function getLaneStatus(lanePath: string): { 
  status: string; 
  currentTask: number | string; 
  totalTasks: number | string; 
  progress: string; 
  pipelineBranch?: string; 
  chatId?: string; 
} {
  const statePath = path.join(lanePath, 'state.json');
  const state = loadState<LaneState & { chatId?: string }>(statePath);
  
  if (!state) {
    return {
      status: 'no state',
      currentTask: '-',
      totalTasks: '?',
      progress: '0%',
    };
  }
  
  const progress = state.totalTasks > 0 
    ? Math.round((state.currentTaskIndex / state.totalTasks) * 100)
    : 0;
  
  return {
    status: state.status || 'unknown',
    currentTask: (state.currentTaskIndex || 0) + 1,
    totalTasks: state.totalTasks || '?',
    progress: `${progress}%`,
    pipelineBranch: state.pipelineBranch || '-',
    chatId: state.chatId || '-',
  };
}

/**
 * Get status icon
 */
function getStatusIcon(status: string): string {
  const icons: Record<string, string> = {
    'running': '🔄',
    'completed': '✅',
    'failed': '❌',
    'blocked_dependency': '🚫',
    'no state': '⚪',
  };
  
  return icons[status] || '❓';
}

/**
 * Display lane status table
 */
function displayStatus(runDir: string, lanes: { name: string; path: string }[]): void {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📊 Run: ${path.basename(runDir)}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  if (lanes.length === 0) {
    console.log('  No lanes found\n');
    return;
  }
  
  // Calculate column widths
  const maxNameLen = Math.max(...lanes.map(l => l.name.length), 10);
  
  // Header
  console.log(`  ${'Lane'.padEnd(maxNameLen)}  Status              Progress  Tasks`);
  console.log(`  ${'─'.repeat(maxNameLen)}  ${'─'.repeat(18)}  ${'─'.repeat(8)}  ${'─'.repeat(10)}`);
  
  // Lanes
  for (const lane of lanes) {
    const status = getLaneStatus(lane.path);
    const statusIcon = getStatusIcon(status.status);
    const statusText = `${statusIcon} ${status.status}`.padEnd(18);
    const progressText = status.progress.padEnd(8);
    const tasksText = `${status.currentTask}/${status.totalTasks}`;
    
    console.log(`  ${lane.name.padEnd(maxNameLen)}  ${statusText}  ${progressText}  ${tasksText}`);
  }
  
  console.log();
}

/**
 * Monitor lanes
 */
async function monitor(args: string[]): Promise<void> {
  logger.section('📡 Monitoring Lane Execution');
  
  const options = parseArgs(args);
  const config = loadConfig();
  
  // Determine run directory
  let runDir = options.runDir;
  
  if (!runDir || runDir === 'latest') {
    runDir = findLatestRunDir(config.logsDir) || undefined;
    
    if (!runDir) {
      logger.error(`Runs directory: ${path.join(config.logsDir, 'runs')}`);
      throw new Error('No run directories found');
    }
    
    logger.info(`Using latest run: ${path.basename(runDir)}`);
  }
  
  if (!fs.existsSync(runDir)) {
    throw new Error(`Run directory not found: ${runDir}`);
  }
  
  // Watch mode
  if (options.watch) {
    logger.info(`Watch mode: every ${options.interval}s (Ctrl+C to stop)\n`);
    
    let iteration = 0;
    
    const refresh = () => {
      if (iteration > 0) {
        // Clear screen
        process.stdout.write('\x1Bc');
      }
      
      const lanes = listLanes(runDir!);
      displayStatus(runDir!, lanes);
      
      iteration++;
    };
    
    // Initial display
    refresh();
    
    // Set up interval
    const intervalId = setInterval(refresh, options.interval * 1000);
    
    // Handle Ctrl+C
    return new Promise((_, reject) => {
      process.on('SIGINT', () => {
        clearInterval(intervalId);
        console.log('\n👋 Monitoring stopped\n');
        process.exit(0);
      });
    });
    
  } else {
    // Single shot
    const lanes = listLanes(runDir);
    displayStatus(runDir, lanes);
  }
}

export = monitor;

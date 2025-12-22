/**
 * CursorFlow runs command - List and view run details
 */

import * as fs from 'fs';
import * as path from 'path';
import * as logger from '../utils/logger';
import { loadConfig, getLogsDir } from '../utils/config';
import { RunService } from '../utils/run-service';
import { RunStatus, RunInfo } from '../utils/types';
import { safeJoin } from '../utils/path';

interface RunsOptions {
  status?: RunStatus;
  json: boolean;
  help: boolean;
  runId?: string;
}

function printHelp(): void {
  console.log(`
Usage: cursorflow runs [run-id] [options]

List all runs or view details of a specific run.

Options:
  [run-id]               View details of a specific run
  --running              Filter to show only running runs
  --status <status>      Filter by status: running, completed, failed, partial, pending
  --json                 Output in JSON format
  --help, -h             Show help

Examples:
  cursorflow runs              # List all runs
  cursorflow runs --running    # List only running runs
  cursorflow runs run-123      # View details of run-123
  `);
}

function parseArgs(args: string[]): RunsOptions {
  const statusIdx = args.indexOf('--status');
  const running = args.includes('--running');
  
  // Find run ID (first non-option argument)
  const runId = args.find((arg, i) => {
    if (arg.startsWith('--') || arg.startsWith('-')) return false;
    // Skip values for options
    const prevArg = args[i - 1];
    if (prevArg && ['--status'].includes(prevArg)) {
      return false;
    }
    return true;
  });

  return {
    runId,
    status: running ? 'running' : (statusIdx >= 0 ? args[statusIdx + 1] as RunStatus : undefined),
    json: args.includes('--json'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

/**
 * Format duration in a human-readable way
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Get status color and emoji
 */
function getStatusDisplay(status: RunStatus): string {
  switch (status) {
    case 'running':
      return `${logger.COLORS.blue}🔄 running${logger.COLORS.reset}`;
    case 'completed':
      return `${logger.COLORS.green}✅ done   ${logger.COLORS.reset}`;
    case 'failed':
      return `${logger.COLORS.red}❌ failed ${logger.COLORS.reset}`;
    case 'partial':
      return `${logger.COLORS.yellow}⚠️ partial${logger.COLORS.reset}`;
    case 'pending':
      return `${logger.COLORS.gray}⏳ pending${logger.COLORS.reset}`;
    default:
      return status;
  }
}

/**
 * Display list of runs
 */
function displayRunList(runs: RunInfo[]): void {
  if (runs.length === 0) {
    console.log('No runs found.');
    return;
  }

  console.log(`    Run ID              Task            Status     Lanes     Duration`);
  console.log(`${logger.COLORS.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${logger.COLORS.reset}`);

  for (const run of runs) {
    const isRunning = run.status === 'running';
    const prefix = isRunning ? `${logger.COLORS.blue}  ▶${logger.COLORS.reset}` : '   ';
    
    const id = run.id.padEnd(20);
    const task = (run.taskName || 'unnamed').substring(0, 15).padEnd(15);
    const status = getStatusDisplay(run.status);
    
    const completedLanes = run.lanes.filter(l => l.status === 'completed').length;
    const totalLanes = run.lanes.length;
    const lanes = `${completedLanes}/${totalLanes}`.padEnd(10);
    
    const duration = formatDuration(run.duration);
    
    console.log(`${prefix} ${id} ${task} ${status} ${lanes} ${duration}`);
  }
}

/**
 * Display detailed information for a single run
 */
function displayRunDetail(run: RunInfo): void {
  logger.section(`Run Details: ${run.id}`);
  
  console.log(`${logger.COLORS.bold}Task:${logger.COLORS.reset}      ${run.taskName}`);
  console.log(`${logger.COLORS.bold}Status:${logger.COLORS.reset}    ${getStatusDisplay(run.status)}`);
  console.log(`${logger.COLORS.bold}Start Time:${logger.COLORS.reset} ${new Date(run.startTime).toLocaleString()}`);
  console.log(`${logger.COLORS.bold}Duration:${logger.COLORS.reset}   ${formatDuration(run.duration)}`);
  console.log(`${logger.COLORS.bold}Path:${logger.COLORS.reset}       ${run.path}`);
  
  console.log(`\n${logger.COLORS.bold}Lanes:${logger.COLORS.reset}`);
  for (const lane of run.lanes) {
    const statusColor = lane.status === 'completed' ? logger.COLORS.green : 
                       lane.status === 'failed' ? logger.COLORS.red : 
                       lane.status === 'running' ? logger.COLORS.blue : logger.COLORS.reset;
    
    console.log(`  - ${lane.name.padEnd(20)} [${statusColor}${lane.status.toUpperCase()}${logger.COLORS.reset}] Task ${lane.currentTask}/${lane.totalTasks} (PID: ${lane.pid || 'N/A'})`);
  }
  
  if (run.branches.length > 0) {
    console.log(`\n${logger.COLORS.bold}Branches:${logger.COLORS.reset}`);
    for (const branch of run.branches) {
      console.log(`  - ${branch}`);
    }
  }
  
  if (run.worktrees.length > 0) {
    console.log(`\n${logger.COLORS.bold}Worktrees:${logger.COLORS.reset}`);
    for (const wt of run.worktrees) {
      console.log(`  - ${wt}`);
    }
  }
  
  console.log(`\nView logs: ${logger.COLORS.cyan}cursorflow logs ${run.id} --all${logger.COLORS.reset}`);
}

async function runs(args: string[]): Promise<void> {
  const options = parseArgs(args);
  
  if (options.help) {
    printHelp();
    return;
  }
  
  const config = loadConfig();
  const logsDir = getLogsDir(config);
  const runsDir = safeJoin(logsDir, 'runs');
  
  if (!fs.existsSync(runsDir)) {
    if (options.json) {
      console.log('[]');
    } else {
      console.log('No runs found. (Runs directory does not exist)');
    }
    return;
  }
  
  const runService = new RunService(runsDir);
  
  if (options.runId) {
    const run = runService.getRunInfo(options.runId);
    if (!run) {
      throw new Error(`Run not found: ${options.runId}`);
    }
    
    if (options.json) {
      console.log(JSON.stringify(run, null, 2));
    } else {
      displayRunDetail(run);
    }
    return;
  }
  
  const runsList = runService.listRuns({ status: options.status });
  
  if (options.json) {
    console.log(JSON.stringify(runsList, null, 2));
  } else {
    displayRunList(runsList);
  }
}

export = runs;

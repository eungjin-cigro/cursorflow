/**
 * CursorFlow status command - View detailed lane status for a run
 */

import * as path from 'path';
import * as fs from 'fs';
import * as logger from '../utils/logger';
import { loadConfig, getLogsDir } from '../utils/config';
import { loadState } from '../utils/state';
import { LaneState } from '../types';
import { safeJoin } from '../utils/path';
import { RunService } from '../utils/run-service';

interface StatusOptions {
  runId: string | null;
  lane: string | null;
  json: boolean;
  watch: boolean;
  help: boolean;
}

interface DetailedLaneStatus {
  name: string;
  status: string;
  progress: string;
  currentTask: number;
  totalTasks: number;
  branch: string | null;
  worktree: string | null;
  pid: number | null;
  processAlive: boolean;
  startTime: number | null;
  endTime: number | null;
  duration: string;
  error: string | null;
  waitingFor: string[];
  chatId: string | null;
  completedTasks: string[];
}

interface RunStatusSummary {
  runId: string;
  runDir: string;
  taskName: string;
  status: string;
  startTime: number;
  duration: string;
  lanes: DetailedLaneStatus[];
  summary: {
    total: number;
    running: number;
    completed: number;
    failed: number;
    pending: number;
    waiting: number;
    paused: number;
  };
}

/**
 * Status indicator colors
 */
const STATUS_COLORS: Record<string, string> = {
  completed: '\x1b[32m', // green
  running: '\x1b[36m',   // cyan
  pending: '\x1b[33m',   // yellow
  failed: '\x1b[31m',    // red
  paused: '\x1b[35m',    // magenta
  waiting: '\x1b[33m',   // yellow
  unknown: '\x1b[90m',   // gray
};
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

function printHelp(): void {
  console.log(`
Usage: cursorflow status [run-id] [options]

View detailed status of lanes in a run.

Options:
  [run-id]           Run ID (default: latest run)
  --lane <name>      Show detailed status for specific lane
  --json             Output as JSON
  --watch            Watch mode - refresh every 2 seconds
  --help, -h         Show help

Examples:
  cursorflow status                    # Status of latest run
  cursorflow status run-1234567890     # Status of specific run
  cursorflow status --lane backend     # Detailed status of specific lane
  cursorflow status --json             # JSON output for scripting
  cursorflow status --watch            # Live status updates
  `);
}

function parseArgs(args: string[]): StatusOptions {
  const laneIdx = args.indexOf('--lane');
  
  // Find run-id (first arg that starts with 'run-' or isn't an option)
  let runId: string | null = null;
  for (const arg of args) {
    if (arg.startsWith('run-')) {
      runId = arg;
      break;
    }
    if (!arg.startsWith('--') && !arg.startsWith('-') && args.indexOf(arg) === 0) {
      // First positional argument could be run-id or 'latest'
      if (arg !== 'latest') {
        runId = arg;
      }
      break;
    }
  }
  
  return {
    runId,
    lane: laneIdx >= 0 ? args[laneIdx + 1] || null : null,
    json: args.includes('--json'),
    watch: args.includes('--watch'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

/**
 * Check if a process is alive by its PID
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Format duration in human readable form
 */
function formatDuration(ms: number): string {
  if (ms < 0) return '-';
  
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Find the latest run directory
 */
function findLatestRunDir(logsDir: string): string | null {
  const runsDir = safeJoin(logsDir, 'runs');
  if (!fs.existsSync(runsDir)) return null;
  
  const runs = fs.readdirSync(runsDir)
    .filter(d => d.startsWith('run-'))
    .sort()
    .reverse();
    
  return runs.length > 0 ? runs[0]! : null;
}

/**
 * Get detailed lane status from lane directory
 */
function getDetailedLaneStatus(laneDir: string, laneName: string): DetailedLaneStatus {
  const statePath = safeJoin(laneDir, 'state.json');
  const state = loadState<LaneState>(statePath);
  
  if (!state) {
    return {
      name: laneName,
      status: 'pending',
      progress: '0%',
      currentTask: 0,
      totalTasks: 0,
      branch: null,
      worktree: null,
      pid: null,
      processAlive: false,
      startTime: null,
      endTime: null,
      duration: '-',
      error: null,
      waitingFor: [],
      chatId: null,
      completedTasks: [],
    };
  }
  
  const progress = state.totalTasks > 0 
    ? Math.round((state.currentTaskIndex / state.totalTasks) * 100) 
    : 0;
    
  const processAlive = state.pid ? isProcessAlive(state.pid) : false;
  
  let duration = 0;
  if (state.startTime) {
    if (state.endTime) {
      duration = state.endTime - state.startTime;
    } else if (state.status === 'running') {
      duration = Date.now() - state.startTime;
    }
  }
  
  return {
    name: laneName,
    status: state.status || 'unknown',
    progress: `${progress}%`,
    currentTask: state.currentTaskIndex || 0,
    totalTasks: state.totalTasks || 0,
    branch: state.pipelineBranch,
    worktree: state.worktreeDir,
    pid: state.pid || null,
    processAlive,
    startTime: state.startTime || null,
    endTime: state.endTime || null,
    duration: formatDuration(duration),
    error: state.error,
    waitingFor: state.waitingFor || [],
    chatId: state.chatId || null,
    completedTasks: state.completedTasks || [],
  };
}

/**
 * Get full run status with all lanes
 */
function getRunStatus(runDir: string, runId: string): RunStatusSummary {
  const lanesDir = safeJoin(runDir, 'lanes');
  const statePath = safeJoin(runDir, 'state.json');
  
  let taskName = 'Unknown';
  let runStartTime = 0;
  
  // Try to get task name from orchestrator state
  if (fs.existsSync(statePath)) {
    try {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      taskName = state.taskName || 'Unknown';
      runStartTime = state.startTime || extractTimestampFromRunId(runId);
    } catch {
      runStartTime = extractTimestampFromRunId(runId);
    }
  } else {
    runStartTime = extractTimestampFromRunId(runId);
  }
  
  const lanes: DetailedLaneStatus[] = [];
  const summary = {
    total: 0,
    running: 0,
    completed: 0,
    failed: 0,
    pending: 0,
    waiting: 0,
    paused: 0,
  };
  
  if (fs.existsSync(lanesDir)) {
    const laneDirs = fs.readdirSync(lanesDir)
      .filter(f => fs.statSync(safeJoin(lanesDir, f)).isDirectory())
      .sort();
      
    for (const laneName of laneDirs) {
      const laneDir = safeJoin(lanesDir, laneName);
      const laneStatus = getDetailedLaneStatus(laneDir, laneName);
      lanes.push(laneStatus);
      
      summary.total++;
      switch (laneStatus.status) {
        case 'running': summary.running++; break;
        case 'completed': summary.completed++; break;
        case 'failed': summary.failed++; break;
        case 'pending': summary.pending++; break;
        case 'waiting': summary.waiting++; break;
        case 'paused': summary.paused++; break;
      }
    }
  }
  
  // Calculate overall run status
  let runStatus = 'pending';
  if (summary.running > 0) {
    runStatus = 'running';
  } else if (summary.completed === summary.total && summary.total > 0) {
    runStatus = 'completed';
  } else if (summary.failed > 0) {
    runStatus = summary.completed > 0 ? 'partial' : 'failed';
  } else if (summary.waiting > 0 || summary.paused > 0) {
    runStatus = 'waiting';
  }
  
  // Calculate run duration
  let runDuration = 0;
  if (runStartTime) {
    const latestEndTime = lanes
      .filter(l => l.endTime)
      .reduce((max, l) => Math.max(max, l.endTime!), 0);
      
    if (runStatus === 'completed' || runStatus === 'failed') {
      runDuration = latestEndTime - runStartTime;
    } else {
      runDuration = Date.now() - runStartTime;
    }
  }
  
  return {
    runId,
    runDir,
    taskName,
    status: runStatus,
    startTime: runStartTime,
    duration: formatDuration(runDuration),
    lanes,
    summary,
  };
}

function extractTimestampFromRunId(runId: string): number {
  const match = runId.match(/run-(\d+)/);
  return match ? parseInt(match[1], 10) : Date.now();
}

/**
 * Print lane status table
 */
function printLaneTable(runStatus: RunStatusSummary): void {
  const { lanes, summary, runId, taskName, status, duration, startTime } = runStatus;
  
  // Header
  console.log('');
  console.log(`${BOLD}📊 Run Status${RESET}`);
  console.log(`${'─'.repeat(80)}`);
  console.log(`  ${DIM}Run ID:${RESET}     ${runId}`);
  console.log(`  ${DIM}Task:${RESET}       ${taskName}`);
  console.log(`  ${DIM}Status:${RESET}     ${STATUS_COLORS[status] || ''}${status}${RESET}`);
  console.log(`  ${DIM}Started:${RESET}    ${startTime ? new Date(startTime).toLocaleString() : '-'}`);
  console.log(`  ${DIM}Duration:${RESET}   ${duration}`);
  console.log('');
  
  // Summary bar
  const barWidth = 40;
  const completedWidth = Math.round((summary.completed / summary.total) * barWidth) || 0;
  const runningWidth = Math.round((summary.running / summary.total) * barWidth) || 0;
  const failedWidth = Math.round((summary.failed / summary.total) * barWidth) || 0;
  const remainingWidth = barWidth - completedWidth - runningWidth - failedWidth;
  
  const progressBar = 
    '\x1b[42m' + ' '.repeat(completedWidth) + '\x1b[0m' +  // green for completed
    '\x1b[46m' + ' '.repeat(runningWidth) + '\x1b[0m' +    // cyan for running
    '\x1b[41m' + ' '.repeat(failedWidth) + '\x1b[0m' +     // red for failed
    '\x1b[47m' + ' '.repeat(remainingWidth) + '\x1b[0m';   // white for pending
    
  console.log(`  [${progressBar}] ${summary.completed}/${summary.total} completed`);
  console.log('');
  
  if (lanes.length === 0) {
    console.log('  No lanes found.');
    return;
  }
  
  // Table header
  console.log(`${BOLD}${'─'.repeat(80)}${RESET}`);
  console.log(`  ${'Lane'.padEnd(20)} ${'Status'.padEnd(12)} ${'Progress'.padEnd(10)} ${'Duration'.padEnd(12)} ${'PID'.padEnd(8)} Branch`);
  console.log(`${'─'.repeat(80)}`);
  
  // Lane rows
  for (const lane of lanes) {
    const statusColor = STATUS_COLORS[lane.status] || STATUS_COLORS.unknown;
    const progressStr = `${lane.currentTask}/${lane.totalTasks}`;
    const pidStr = lane.pid 
      ? (lane.processAlive ? `${lane.pid}` : `${DIM}${lane.pid}†${RESET}`)
      : '-';
    const branchStr = lane.branch || '-';
    
    console.log(`  ${lane.name.padEnd(20)} ${statusColor}${lane.status.padEnd(12)}${RESET} ${progressStr.padEnd(10)} ${lane.duration.padEnd(12)} ${pidStr.padEnd(8)} ${branchStr}`);
    
    // Show error if failed
    if (lane.status === 'failed' && lane.error) {
      const errorMsg = lane.error.length > 60 ? lane.error.substring(0, 57) + '...' : lane.error;
      console.log(`  ${' '.repeat(20)} ${DIM}└─ \x1b[31m${errorMsg}${RESET}`);
    }
    
    // Show waiting dependencies
    if (lane.waitingFor && lane.waitingFor.length > 0) {
      console.log(`  ${' '.repeat(20)} ${DIM}└─ Waiting: ${lane.waitingFor.join(', ')}${RESET}`);
    }
  }
  
  console.log(`${'─'.repeat(80)}`);
  
  // Summary
  console.log('');
  const summaryParts = [];
  if (summary.completed > 0) summaryParts.push(`\x1b[32m${summary.completed} completed\x1b[0m`);
  if (summary.running > 0) summaryParts.push(`\x1b[36m${summary.running} running\x1b[0m`);
  if (summary.failed > 0) summaryParts.push(`\x1b[31m${summary.failed} failed\x1b[0m`);
  if (summary.pending > 0) summaryParts.push(`\x1b[33m${summary.pending} pending\x1b[0m`);
  if (summary.waiting > 0) summaryParts.push(`\x1b[33m${summary.waiting} waiting\x1b[0m`);
  if (summary.paused > 0) summaryParts.push(`\x1b[35m${summary.paused} paused\x1b[0m`);
  
  console.log(`  ${BOLD}Summary:${RESET} ${summaryParts.join(' | ')}`);
  
  // Tips
  if (summary.failed > 0 || summary.paused > 0) {
    console.log('');
    console.log(`  ${DIM}Tip: Run \x1b[32mcursorflow resume --all\x1b[0m${DIM} to resume incomplete lanes${RESET}`);
  }
  if (summary.running > 0) {
    console.log('');
    console.log(`  ${DIM}Tip: Run \x1b[32mcursorflow monitor\x1b[0m${DIM} for interactive monitoring${RESET}`);
  }
}

/**
 * Print detailed status for a single lane
 */
function printDetailedLaneStatus(laneStatus: DetailedLaneStatus, runId: string): void {
  console.log('');
  console.log(`${BOLD}🔍 Lane Details: ${laneStatus.name}${RESET}`);
  console.log(`${'─'.repeat(60)}`);
  console.log(`  ${DIM}Run:${RESET}              ${runId}`);
  console.log(`  ${DIM}Status:${RESET}           ${STATUS_COLORS[laneStatus.status] || ''}${laneStatus.status}${RESET}`);
  console.log(`  ${DIM}Progress:${RESET}         ${laneStatus.currentTask}/${laneStatus.totalTasks} (${laneStatus.progress})`);
  console.log(`  ${DIM}Branch:${RESET}           ${laneStatus.branch || '-'}`);
  console.log(`  ${DIM}Worktree:${RESET}         ${laneStatus.worktree || '-'}`);
  console.log(`  ${DIM}PID:${RESET}              ${laneStatus.pid || '-'}${laneStatus.pid && !laneStatus.processAlive ? ' (dead)' : ''}`);
  console.log(`  ${DIM}Duration:${RESET}         ${laneStatus.duration}`);
  console.log(`  ${DIM}Started:${RESET}          ${laneStatus.startTime ? new Date(laneStatus.startTime).toLocaleString() : '-'}`);
  console.log(`  ${DIM}Ended:${RESET}            ${laneStatus.endTime ? new Date(laneStatus.endTime).toLocaleString() : '-'}`);
  console.log(`  ${DIM}Chat ID:${RESET}          ${laneStatus.chatId || '-'}`);
  
  if (laneStatus.waitingFor && laneStatus.waitingFor.length > 0) {
    console.log(`  ${DIM}Waiting For:${RESET}      ${laneStatus.waitingFor.join(', ')}`);
  }
  
  if (laneStatus.completedTasks && laneStatus.completedTasks.length > 0) {
    console.log(`  ${DIM}Completed Tasks:${RESET}  ${laneStatus.completedTasks.join(', ')}`);
  }
  
  if (laneStatus.error) {
    console.log('');
    console.log(`  ${BOLD}\x1b[31mError:${RESET}`);
    console.log(`  ${laneStatus.error}`);
  }
  
  console.log(`${'─'.repeat(60)}`);
}

/**
 * Clear console and move cursor to top
 */
function clearScreen(): void {
  process.stdout.write('\x1b[2J\x1b[H');
}

async function status(args: string[]): Promise<void> {
  const options = parseArgs(args);
  
  if (options.help) {
    printHelp();
    return;
  }

  const config = loadConfig();
  const logsDir = getLogsDir(config);
  const runsDir = safeJoin(logsDir, 'runs');
  
  // Find run directory
  let runId = options.runId;
  if (!runId) {
    runId = findLatestRunDir(logsDir);
  }
  
  if (!runId) {
    logger.warn('No runs found. Run a flow first with: cursorflow run <flow-name>');
    return;
  }
  
  // Support both run ID and full path
  let runDir = runId.includes(path.sep) ? runId : safeJoin(runsDir, runId);
  if (!runId.startsWith('run-') && !fs.existsSync(runDir)) {
    // Try adding run- prefix
    runDir = safeJoin(runsDir, `run-${runId}`);
    runId = `run-${runId}`;
  }
  
  if (!fs.existsSync(runDir)) {
    throw new Error(`Run not found: ${runId}`);
  }
  
  // Extract just the run ID from the path if needed
  runId = path.basename(runDir);

  const displayStatus = () => {
    const runStatus = getRunStatus(runDir, runId!);
    
    if (options.json) {
      console.log(JSON.stringify(runStatus, null, 2));
      return;
    }
    
    if (options.lane) {
      const lane = runStatus.lanes.find(l => l.name === options.lane);
      if (!lane) {
        throw new Error(`Lane '${options.lane}' not found in run ${runId}`);
      }
      printDetailedLaneStatus(lane, runId!);
    } else {
      printLaneTable(runStatus);
    }
  };
  
  if (options.watch) {
    // Watch mode
    const refreshInterval = 2000;
    
    const refresh = () => {
      clearScreen();
      console.log(`${DIM}[Auto-refresh every ${refreshInterval/1000}s - Press Ctrl+C to exit]${RESET}`);
      displayStatus();
    };
    
    refresh();
    const interval = setInterval(refresh, refreshInterval);
    
    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      clearInterval(interval);
      console.log('\n');
      process.exit(0);
    });
    
    // Keep process alive
    await new Promise(() => {});
  } else {
    displayStatus();
  }
}

export = status;

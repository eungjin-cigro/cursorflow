/**
 * CursorFlow resume command
 */

import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess, execSync } from 'child_process';
import * as logger from '../utils/logger';
import { loadConfig, getLogsDir } from '../utils/config';
import { loadState, saveState } from '../utils/state';
import { LaneState } from '../utils/types';
import { runDoctor } from '../utils/doctor';
import { safeJoin } from '../utils/path';
import { 
  EnhancedLogManager, 
  createLogManager, 
  DEFAULT_LOG_CONFIG,
  stripAnsi,
  ParsedMessage
} from '../utils/enhanced-logger';

interface ResumeOptions {
  lane: string | null;
  runDir: string | null;
  clean: boolean;
  restart: boolean;
  skipDoctor: boolean;
  all: boolean;
  status: boolean;
  maxConcurrent: number;
  help: boolean;
  noGit: boolean;
  executor: string | null;
}

function printHelp(): void {
  console.log(`
Usage: cursorflow resume [lane] [options]

Resume interrupted or failed lanes.

Options:
  <lane>                 Lane name to resume (single lane mode)
  --all                  Resume ALL incomplete/failed lanes
  --status               Show status of all lanes in the run (no resume)
  --run-dir <path>       Use a specific run directory (default: latest)
  --max-concurrent <n>   Max lanes to run in parallel (default: 3)
  --clean                Clean up existing worktree before resuming
  --restart              Restart from the first task (index 0)
  --skip-doctor          Skip environment/branch checks (not recommended)
  --no-git               Disable Git operations (must match original run)
  --executor <type>      Override executor (default: cursor-agent)
  --help, -h             Show help

Examples:
  cursorflow resume --status                 # Check status of all lanes
  cursorflow resume --all                    # Resume all incomplete lanes
  cursorflow resume lane-1                   # Resume single lane
  cursorflow resume --all --restart          # Restart all incomplete lanes from task 0
  cursorflow resume --all --max-concurrent 2 # Resume with max 2 parallel lanes
  `);
}

function parseArgs(args: string[]): ResumeOptions {
  const runDirIdx = args.indexOf('--run-dir');
  const maxConcurrentIdx = args.indexOf('--max-concurrent');
  const executorIdx = args.indexOf('--executor');
  
  return {
    lane: args.find(a => !a.startsWith('--')) || null,
    runDir: runDirIdx >= 0 ? args[runDirIdx + 1] || null : null,
    clean: args.includes('--clean'),
    restart: args.includes('--restart'),
    skipDoctor: args.includes('--skip-doctor') || args.includes('--no-doctor'),
    all: args.includes('--all'),
    status: args.includes('--status'),
    maxConcurrent: maxConcurrentIdx >= 0 ? parseInt(args[maxConcurrentIdx + 1] || '3') : 3,
    help: args.includes('--help') || args.includes('-h'),
    noGit: args.includes('--no-git'),
    executor: executorIdx >= 0 ? args[executorIdx + 1] || null : null,
  };
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
    
  return runs.length > 0 ? safeJoin(runsDir, runs[0]!) : null;
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
  reviewing: '\x1b[36m', // cyan
  unknown: '\x1b[90m',   // gray
};
const RESET = '\x1b[0m';

/**
 * Format and print parsed message to console (copied from orchestrator.ts)
 */
function handleParsedMessage(laneName: string, msg: ParsedMessage): void {
  const ts = new Date(msg.timestamp).toLocaleTimeString('en-US', { hour12: false });
  const laneLabel = `[${laneName}]`.padEnd(12);
  
  let prefix = '';
  let content = msg.content;
  
  switch (msg.type) {
    case 'user':
      prefix = `${logger.COLORS.cyan}🧑 USER${logger.COLORS.reset}`;
      content = content.replace(/\n/g, ' ');
      break;
    case 'assistant':
      prefix = `${logger.COLORS.green}🤖 ASST${logger.COLORS.reset}`;
      break;
    case 'tool':
      prefix = `${logger.COLORS.yellow}🔧 TOOL${logger.COLORS.reset}`;
      const toolMatch = content.match(/\[Tool: ([^\]]+)\] (.*)/);
      if (toolMatch) {
        const [, name, args] = toolMatch;
        try {
          const parsedArgs = JSON.parse(args!);
          let argStr = '';
          if (name === 'read_file' && parsedArgs.target_file) argStr = parsedArgs.target_file;
          else if (name === 'run_terminal_cmd' && parsedArgs.command) argStr = parsedArgs.command;
          else if (name === 'write' && parsedArgs.file_path) argStr = parsedArgs.file_path;
          else if (name === 'search_replace' && parsedArgs.file_path) argStr = parsedArgs.file_path;
          else {
            const keys = Object.keys(parsedArgs);
            if (keys.length > 0) argStr = String(parsedArgs[keys[0]]).substring(0, 50);
          }
          content = `${logger.COLORS.bold}${name}${logger.COLORS.reset}(${argStr})`;
        } catch {
          content = `${logger.COLORS.bold}${name}${logger.COLORS.reset}: ${args}`;
        }
      }
      break;
    case 'tool_result':
      prefix = `${logger.COLORS.gray}📄 RESL${logger.COLORS.reset}`;
      const resMatch = content.match(/\[Tool Result: ([^\]]+)\]/);
      content = resMatch ? `${resMatch[1]} OK` : 'result';
      break;
    case 'result':
      prefix = `${logger.COLORS.green}✅ DONE${logger.COLORS.reset}`;
      break;
    case 'system':
      prefix = `${logger.COLORS.gray}⚙️  SYS${logger.COLORS.reset}`;
      break;
    case 'thinking':
      prefix = `${logger.COLORS.gray}🤔 THNK${logger.COLORS.reset}`;
      break;
  }
  
  if (prefix) {
    const lines = content.split('\n');
    const tsPrefix = `${logger.COLORS.gray}[${ts}]${logger.COLORS.reset} ${logger.COLORS.magenta}${laneLabel}${logger.COLORS.reset}`;
    
    if (msg.type === 'user' || msg.type === 'assistant' || msg.type === 'result' || msg.type === 'thinking') {
      const header = `${prefix} ┌${'─'.repeat(60)}`;
      process.stdout.write(`${tsPrefix} ${header}\n`);
      for (const line of lines) {
        process.stdout.write(`${tsPrefix} ${' '.repeat(stripAnsi(prefix).length)} │ ${line}\n`);
      }
      process.stdout.write(`${tsPrefix} ${' '.repeat(stripAnsi(prefix).length)} └${'─'.repeat(60)}\n`);
    } else {
      process.stdout.write(`${tsPrefix} ${prefix} ${content}\n`);
    }
  }
}

interface LaneInfo {
  name: string;
  dir: string;
  state: LaneState | null;
  needsResume: boolean;
  dependsOn: string[];
  isCompleted: boolean;
}

/**
 * Check if a process is alive by its PID
 */
function isProcessAlive(pid: number): boolean {
  try {
    // On Unix-like systems, sending signal 0 checks if process exists
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check for zombie "running" lanes and fix them
 * A zombie lane is one that has status "running" but its process is dead
 */
function checkAndFixZombieLanes(runDir: string): { fixed: string[]; pofCreated: boolean } {
  const lanesDir = safeJoin(runDir, 'lanes');
  if (!fs.existsSync(lanesDir)) {
    return { fixed: [], pofCreated: false };
  }
  
  const fixed: string[] = [];
  const zombieDetails: Array<{
    name: string;
    pid: number;
    taskIndex: number;
    totalTasks: number;
  }> = [];
  
  const laneDirs = fs.readdirSync(lanesDir)
    .filter(f => fs.statSync(safeJoin(lanesDir, f)).isDirectory());
  
  for (const laneName of laneDirs) {
    const dir = safeJoin(lanesDir, laneName);
    const statePath = safeJoin(dir, 'state.json');
    
    if (!fs.existsSync(statePath)) continue;
    
    const state = loadState<LaneState>(statePath);
    if (!state) continue;
    
    // Check for zombie: status is "running" but process is dead
    if (state.status === 'running' && state.pid) {
      const alive = isProcessAlive(state.pid);
      
      if (!alive) {
        logger.warn(`🧟 Zombie lane detected: ${laneName} (PID ${state.pid} is dead)`);
        
        // Update state to failed
        const updatedState: LaneState = {
          ...state,
          status: 'failed',
          error: `Process terminated unexpectedly (PID ${state.pid} was running but is now dead)`,
          endTime: Date.now(),
        };
        
        saveState(statePath, updatedState);
        fixed.push(laneName);
        
        zombieDetails.push({
          name: laneName,
          pid: state.pid,
          taskIndex: state.currentTaskIndex,
          totalTasks: state.totalTasks,
        });
        
        logger.info(`  → Status changed to 'failed', ready for resume`);
      }
    }
  }
  
  // Create POF file if any zombies were found
  let pofCreated = false;
  if (zombieDetails.length > 0) {
    const pofPath = safeJoin(runDir, 'pof.json');
    const existingPof = fs.existsSync(pofPath) 
      ? JSON.parse(fs.readFileSync(pofPath, 'utf-8')) 
      : null;
    
    const pof = {
      title: 'Run Failure Post-mortem',
      runId: path.basename(runDir),
      failureTime: new Date().toISOString(),
      detectedAt: new Date().toISOString(),
      summary: `${zombieDetails.length} lane(s) found with dead processes (zombie state)`,
      
      rootCause: {
        type: 'ZOMBIE_PROCESS',
        description: 'Lane processes were marked as running but the processes are no longer alive',
        symptoms: [
          'Process PIDs no longer exist in the system',
          'Lanes were stuck in "running" state',
          'No completion or error was recorded before process death',
        ],
      },
      
      affectedLanes: zombieDetails.map(z => ({
        name: z.name,
        status: 'failed (was: running)',
        task: `[${z.taskIndex + 1}/${z.totalTasks}]`,
        taskIndex: z.taskIndex,
        pid: z.pid,
        reason: 'Process terminated unexpectedly',
      })),
      
      possibleCauses: [
        'System killed process due to memory pressure (OOM)',
        'User killed process manually (Ctrl+C, kill command)',
        'Agent timeout exceeded and process was terminated',
        'System restart or crash',
        'Agent hung and watchdog terminated it',
      ],
      
      recovery: {
        command: `cursorflow resume --all --run-dir ${runDir}`,
        description: 'Resume all failed lanes from their last checkpoint',
        alternativeCommand: `cursorflow resume --all --restart --run-dir ${runDir}`,
        alternativeDescription: 'Restart all failed lanes from the beginning',
      },
      
      // Merge with existing POF if present
      previousFailures: existingPof ? [existingPof] : undefined,
    };
    
    fs.writeFileSync(pofPath, JSON.stringify(pof, null, 2));
    pofCreated = true;
    logger.info(`📋 POF file created: ${pofPath}`);
  }
  
  return { fixed, pofCreated };
}

/**
 * Get all lane statuses from a run directory
 */
function getAllLaneStatuses(runDir: string): LaneInfo[] {
  const lanesDir = safeJoin(runDir, 'lanes');
  if (!fs.existsSync(lanesDir)) {
    return [];
  }
  
  const lanes = fs.readdirSync(lanesDir)
    .filter(f => fs.statSync(safeJoin(lanesDir, f)).isDirectory())
    .map(name => {
      const dir = safeJoin(lanesDir, name);
      const statePath = safeJoin(dir, 'state.json');
      const state = fs.existsSync(statePath) ? loadState<LaneState>(statePath) : null;
      
      // Determine if lane needs resume: everything that is not completed
      const needsResume = state ? (
        state.status !== 'completed'
      ) : true;
      
      const isCompleted = state?.status === 'completed';
      const dependsOn = state?.dependsOn || [];
      
      return { name, dir, state, needsResume, dependsOn, isCompleted };
    });
  
  return lanes;
}

/**
 * Check if all dependencies of a lane are completed
 */
function areDependenciesCompleted(
  lane: LaneInfo, 
  allLanes: LaneInfo[],
  completedLanes: Set<string>
): boolean {
  if (!lane.dependsOn || lane.dependsOn.length === 0) {
    return true;
  }
  
  for (const depName of lane.dependsOn) {
    // Check if dependency is in completed set (already succeeded in this resume session)
    if (completedLanes.has(depName)) {
      continue;
    }
    
    // Check if dependency was already completed before this resume
    const depLane = allLanes.find(l => l.name === depName);
    if (!depLane || !depLane.isCompleted) {
      return false;
    }
  }
  
  return true;
}

/**
 * Print status of all lanes
 */
function printAllLaneStatus(runDir: string): { total: number; completed: number; needsResume: number } {
  const lanes = getAllLaneStatuses(runDir);
  
  if (lanes.length === 0) {
    logger.warn('No lanes found in this run.');
    return { total: 0, completed: 0, needsResume: 0 };
  }
  
  logger.section(`📊 Lane Status (${path.basename(runDir)})`);
  console.log('');
  
  // Table header
  console.log('  ' + 
    'Lane'.padEnd(25) + 
    'Status'.padEnd(12) + 
    'Progress'.padEnd(12) + 
    'DependsOn'.padEnd(15) +
    'Resumable'
  );
  console.log('  ' + '-'.repeat(75));
  
  let completedCount = 0;
  let needsResumeCount = 0;
  const completedSet = new Set<string>();
  
  // First pass: collect completed lanes
  for (const lane of lanes) {
    if (lane.isCompleted) {
      completedSet.add(lane.name);
    }
  }
  
  for (const lane of lanes) {
    const state = lane.state;
    const status = state?.status || 'unknown';
    const color = STATUS_COLORS[status] || STATUS_COLORS.unknown;
    const progress = state ? `${state.currentTaskIndex}/${state.totalTasks}` : '-/-';
    const dependsOnStr = lane.dependsOn.length > 0 ? lane.dependsOn.join(',').substring(0, 12) : '-';
    
    // Check if dependencies are met
    const depsCompleted = areDependenciesCompleted(lane, lanes, completedSet);
    const canResume = lane.needsResume && depsCompleted;
    const blockedByDep = lane.needsResume && !depsCompleted;
    
    if (status === 'completed') completedCount++;
    if (lane.needsResume) needsResumeCount++;
    
    let resumeIndicator = '';
    if (canResume) {
      resumeIndicator = '\x1b[33m✓\x1b[0m';
    } else if (blockedByDep) {
      resumeIndicator = '\x1b[90m⏳ waiting\x1b[0m';
    }
    
    console.log('  ' + 
      lane.name.padEnd(25) + 
      `${color}${status.padEnd(12)}${RESET}` +
      progress.padEnd(12) +
      dependsOnStr.padEnd(15) +
      resumeIndicator
    );
    
    // Show error if failed
    if (status === 'failed' && state?.error) {
      console.log(`  ${''.padEnd(25)}\x1b[31m└─ ${state.error.substring(0, 50)}${state.error.length > 50 ? '...' : ''}\x1b[0m`);
    }
    
    // Show blocked dependency info
    if (blockedByDep) {
      const pendingDeps = lane.dependsOn.filter(d => !completedSet.has(d));
      console.log(`  ${''.padEnd(25)}\x1b[90m└─ waiting for: ${pendingDeps.join(', ')}\x1b[0m`);
    }
  }
  
  console.log('');
  console.log(`  Total: ${lanes.length} | Completed: ${completedCount} | Needs Resume: ${needsResumeCount}`);
  
  if (needsResumeCount > 0) {
    console.log('');
    console.log('  \x1b[33mTip:\x1b[0m Run \x1b[32mcursorflow resume --all\x1b[0m to resume all incomplete lanes');
    console.log('       Lanes with dependencies will wait until their dependencies complete.');
  }
  
  return { total: lanes.length, completed: completedCount, needsResume: needsResumeCount };
}

/**
 * Resume a single lane and return the child process and its log manager
 */
function spawnLaneResume(
  laneName: string,
  laneDir: string,
  state: LaneState,
  options: { 
    restart: boolean;
    noGit?: boolean;
    pipelineBranch?: string;
    executor?: string | null;
    enhancedLogConfig?: any;
  }
): { child: ChildProcess; logManager: EnhancedLogManager } {
  const runnerPath = require.resolve('../core/runner');
  const startIndex = options.restart ? 0 : state.currentTaskIndex;
  
  const runnerArgs = [
    runnerPath,
    state.tasksFile!,
    '--run-dir', laneDir,
    '--start-index', String(startIndex),
  ];

  if (state.worktreeDir) {
    runnerArgs.push('--worktree-dir', state.worktreeDir);
  }

  if (options.noGit) {
    runnerArgs.push('--no-git');
  }

  // Explicitly pass pipeline branch if available (either from state or override)
  const branch = options.pipelineBranch || state.pipelineBranch;
  if (branch) {
    runnerArgs.push('--pipeline-branch', branch);
  }
  
  // Pass executor if provided
  if (options.executor) {
    runnerArgs.push('--executor', options.executor);
  }

  const logManager = createLogManager(laneDir, laneName, options.enhancedLogConfig || {}, (msg) => handleParsedMessage(laneName, msg));
  
  const child = spawn('node', runnerArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  
  let lineBuffer = '';
  
  if (child.stdout) {
    child.stdout.on('data', (data: Buffer) => {
      logManager.writeStdout(data);
      
      const str = data.toString();
      lineBuffer += str;
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() || '';
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && 
            !trimmed.startsWith('{') && 
            !trimmed.startsWith('[') && 
            !trimmed.includes('{"type"')) {
          process.stdout.write(`${logger.COLORS.gray}[${new Date().toLocaleTimeString('en-US', { hour12: false })}]${logger.COLORS.reset} ${logger.COLORS.magenta}${laneName.padEnd(10)}${logger.COLORS.reset} ${line}\n`);
        }
      }
    });
  }
  
  if (child.stderr) {
    child.stderr.on('data', (data: Buffer) => {
      logManager.writeStderr(data);
      const str = data.toString();
      const lines = str.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          const isStatus = trimmed.startsWith('Preparing worktree') || 
                           trimmed.startsWith('Switched to a new branch') ||
                           trimmed.startsWith('HEAD is now at') ||
                           trimmed.includes('actual output');
          
          if (isStatus) {
            process.stdout.write(`${logger.COLORS.gray}[${new Date().toLocaleTimeString('en-US', { hour12: false })}]${logger.COLORS.reset} ${logger.COLORS.magenta}${laneName.padEnd(10)}${logger.COLORS.reset} ${trimmed}\n`);
          } else {
            process.stderr.write(`${logger.COLORS.red}[${laneName}] ERROR: ${trimmed}${logger.COLORS.reset}\n`);
          }
        }
      }
    });
  }
  
  child.on('exit', () => {
    logManager.close();
  });
  
  return { child, logManager };
}

/**
 * Wait for a child process to exit
 */
function waitForChild(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.on('exit', (code) => {
      resolve(code ?? -1);
    });
    child.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Resume multiple lanes with concurrency control and dependency awareness
 */
async function resumeAllLanes(
  runDir: string,
  options: { 
    restart: boolean; 
    maxConcurrent: number; 
    skipDoctor: boolean; 
    noGit: boolean;
    executor: string | null;
    enhancedLogConfig?: any;
  }
): Promise<{ succeeded: string[]; failed: string[]; skipped: string[] }> {
  const allLanes = getAllLaneStatuses(runDir);
  const lanesToResume = allLanes.filter(l => l.needsResume && l.state?.tasksFile);
  const missingTaskInfo = allLanes.filter(l => l.needsResume && !l.state?.tasksFile);
  
  if (missingTaskInfo.length > 0) {
    logger.warn(`Lanes that haven't started yet and have no task info: ${missingTaskInfo.map(l => l.name).join(', ')}`);
    logger.warn('These lanes cannot be resumed because their original task file paths were not recorded.');
  }
  
  if (lanesToResume.length === 0) {
    logger.success('All lanes are already completed! Nothing to resume.');
    return { succeeded: [], failed: [], skipped: [] };
  }
  
  // Check for lanes with unmet dependencies that can never be satisfied
  const completedSet = new Set<string>(allLanes.filter(l => l.isCompleted).map(l => l.name));
  const toResumeNames = new Set<string>(lanesToResume.map(l => l.name));
  
  const skippedLanes: string[] = [];
  const resolvableLanes: LaneInfo[] = [];
  
  for (const lane of lanesToResume) {
    // Check if all dependencies can be satisfied (either already completed or in the resume list)
    const unmetDeps = lane.dependsOn.filter(dep => 
      !completedSet.has(dep) && !toResumeNames.has(dep)
    );
    
    if (unmetDeps.length > 0) {
      logger.warn(`⏭ Skipping ${lane.name}: unresolvable dependencies (${unmetDeps.join(', ')})`);
      skippedLanes.push(lane.name);
    } else {
      resolvableLanes.push(lane);
    }
  }
  
  if (resolvableLanes.length === 0) {
    logger.warn('No lanes can be resumed due to dependency constraints.');
    return { succeeded: [], failed: [], skipped: skippedLanes };
  }
  
  logger.section(`🔁 Resuming ${resolvableLanes.length} Lane(s)`);
  logger.info(`Max concurrent: ${options.maxConcurrent}`);
  logger.info(`Mode: ${options.restart ? 'Restart from beginning' : 'Continue from last task'}`);
  
  // Show dependency order
  const lanesWithDeps = resolvableLanes.filter(l => l.dependsOn.length > 0);
  if (lanesWithDeps.length > 0) {
    logger.info(`Dependency-aware: ${lanesWithDeps.length} lane(s) have dependencies`);
  }
  console.log('');
  
  // Run doctor check once if needed (check git status)
  if (!options.skipDoctor) {
    logger.info('Running pre-flight checks...');
    
    // Use the first lane's tasksDir for doctor check
    const firstLane = resolvableLanes[0]!;
    const tasksDir = path.dirname(firstLane.state!.tasksFile!);
    
    const report = runDoctor({
      cwd: process.cwd(),
      tasksDir,
      includeCursorAgentChecks: false,
    });
    
    const blockingIssues = report.issues.filter(i => 
      i.severity === 'error' && 
      (i.id.startsWith('branch.') || i.id.startsWith('git.'))
    );
    
    if (blockingIssues.length > 0) {
      logger.section('🛑 Pre-resume check found issues');
      for (const issue of blockingIssues) {
        logger.error(`${issue.title} (${issue.id})`, '❌');
        console.log(`   ${issue.message}`);
      }
      throw new Error('Pre-resume checks failed. Use --skip-doctor to bypass.');
    }
  }
  
  const succeeded: string[] = [];
  const failed: string[] = [];
  
  // Create a mutable set for tracking completed lanes (including those from this session)
  const sessionCompleted = new Set<string>(completedSet);
  
  // Queue management with dependency awareness
  const pending = new Set<string>(resolvableLanes.map(l => l.name));
  const active: Map<string, ChildProcess> = new Map();
  const laneMap = new Map<string, LaneInfo>(resolvableLanes.map(l => [l.name, l]));
  
  /**
   * Find the next lane that can be started (all dependencies met)
   */
  const findReadyLane = (): LaneInfo | null => {
    for (const laneName of pending) {
      const lane = laneMap.get(laneName)!;
      if (areDependenciesCompleted(lane, allLanes, sessionCompleted)) {
        return lane;
      }
    }
    return null;
  };
  
  /**
   * Process lanes with dependency awareness
   */
  const processNext = (): void => {
    while (active.size < options.maxConcurrent) {
      const lane = findReadyLane();
      
      if (!lane) {
        // No lane ready to start
        if (pending.size > 0 && active.size === 0) {
          // Deadlock: pending lanes exist but none can start and none are running
          const pendingList = Array.from(pending).join(', ');
          logger.error(`Deadlock detected! Lanes waiting: ${pendingList}`);
          for (const ln of pending) {
            failed.push(ln);
          }
          pending.clear();
        }
        break;
      }
      
      pending.delete(lane.name);
      
      const depsInfo = lane.dependsOn.length > 0 ? ` (after: ${lane.dependsOn.join(', ')})` : '';
      logger.info(`Starting: ${lane.name} (task ${lane.state!.currentTaskIndex}/${lane.state!.totalTasks})${depsInfo}`);
      
      const { child } = spawnLaneResume(lane.name, lane.dir, lane.state!, {
        restart: options.restart,
        noGit: options.noGit,
        executor: options.executor,
        enhancedLogConfig: options.enhancedLogConfig,
      });
      
      active.set(lane.name, child);
      
      // Handle completion
      waitForChild(child).then(code => {
        active.delete(lane.name);
        
        if (code === 0) {
          logger.success(`✓ ${lane.name} completed`);
          succeeded.push(lane.name);
          sessionCompleted.add(lane.name); // Mark as completed for dependency resolution
        } else if (code === 2) {
          logger.warn(`⚠ ${lane.name} blocked on dependency change`);
          failed.push(lane.name);
        } else {
          logger.error(`✗ ${lane.name} failed (exit ${code})`);
          failed.push(lane.name);
        }
        
        // Try to start more lanes now that one completed
        processNext();
      }).catch(err => {
        active.delete(lane.name);
        logger.error(`✗ ${lane.name} error: ${err.message}`);
        failed.push(lane.name);
        processNext();
      });
    }
  };
  
  // Start initial batch
  processNext();
  
  // Wait for all to complete
  while (active.size > 0 || pending.size > 0) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Check if we can start more (in case completion handlers haven't triggered processNext yet)
    if (active.size < options.maxConcurrent && pending.size > 0) {
      processNext();
    }
  }
  
  // Summary
  console.log('');
  logger.section('📊 Resume Summary');
  logger.info(`Succeeded: ${succeeded.length}`);
  if (failed.length > 0) {
    logger.error(`Failed: ${failed.length} (${failed.join(', ')})`);
  }
  if (skippedLanes.length > 0) {
    logger.warn(`Skipped: ${skippedLanes.length} (${skippedLanes.join(', ')})`);
  }
  
  return { succeeded, failed, skipped: skippedLanes };
}

async function resume(args: string[]): Promise<void> {
  const options = parseArgs(args);
  
  if (options.help) {
    printHelp();
    return;
  }

  const config = loadConfig();
  const logsDir = getLogsDir(config);
  
  // Find run directory
  let runDir = options.runDir;
  if (!runDir) {
    runDir = findLatestRunDir(logsDir);
  }
  
  if (!runDir || !fs.existsSync(runDir)) {
    throw new Error(`Run directory not found: ${runDir || 'latest'}. Have you run any tasks yet?`);
  }
  
  // Check for zombie lanes (running status but dead process) and fix them
  const zombieCheck = checkAndFixZombieLanes(runDir);
  if (zombieCheck.fixed.length > 0) {
    logger.section('🔧 Zombie Lane Recovery');
    logger.info(`Fixed ${zombieCheck.fixed.length} zombie lane(s): ${zombieCheck.fixed.join(', ')}`);
    if (zombieCheck.pofCreated) {
      logger.info(`Post-mortem file created for debugging`);
    }
    console.log('');
  }
  
  // Status mode: just show status and exit
  if (options.status) {
    printAllLaneStatus(runDir);
    return;
  }
  
  // All mode: resume all incomplete lanes
  if (options.all) {
    const result = await resumeAllLanes(runDir, {
      restart: options.restart,
      maxConcurrent: options.maxConcurrent,
      skipDoctor: options.skipDoctor,
      noGit: options.noGit,
      executor: options.executor,
      enhancedLogConfig: config.enhancedLogging,
    });
    
    if (result.failed.length > 0) {
      throw new Error(`${result.failed.length} lane(s) failed to complete`);
    }
    return;
  }
  
  // Single lane mode (original behavior)
  if (!options.lane) {
    // Show status by default if no lane specified
    printAllLaneStatus(runDir);
    console.log('');
    console.log('Usage: cursorflow resume <lane> [options]');
    console.log('       cursorflow resume --all           # Resume all incomplete lanes');
    return;
  }
  
  const laneDir = safeJoin(runDir, 'lanes', options.lane);
  const statePath = safeJoin(laneDir, 'state.json');
  
  if (!fs.existsSync(statePath)) {
    throw new Error(`Lane state not found at ${statePath}. Is the lane name correct?`);
  }
  
  const state = loadState<LaneState>(statePath);
  if (!state) {
    throw new Error(`Failed to load state from ${statePath}`);
  }
  
  if (!state.tasksFile || !fs.existsSync(state.tasksFile)) {
    throw new Error(`Original tasks file not found: ${state.tasksFile}. Resume impossible without task definition.`);
  }
  
  // Run doctor check before resuming (check branches, etc.)
  if (!options.skipDoctor) {
    const tasksDir = path.dirname(state.tasksFile);
    logger.info('Running pre-flight checks...');
    
    const report = runDoctor({
      cwd: process.cwd(),
      tasksDir,
      includeCursorAgentChecks: false, // Skip agent checks for resume
    });
    
    // Only show blocking errors for resume
    const blockingIssues = report.issues.filter(i => 
      i.severity === 'error' && 
      (i.id.startsWith('branch.') || i.id.startsWith('git.'))
    );
    
    if (blockingIssues.length > 0) {
      logger.section('🛑 Pre-resume check found issues');
      for (const issue of blockingIssues) {
        logger.error(`${issue.title} (${issue.id})`, '❌');
        console.log(`   ${issue.message}`);
        if (issue.details) console.log(`   Details: ${issue.details}`);
        if (issue.fixes?.length) {
          console.log('   Fix:');
          for (const fix of issue.fixes) console.log(`     - ${fix}`);
        }
        console.log('');
      }
      throw new Error('Pre-resume checks failed. Use --skip-doctor to bypass (not recommended).');
    }
    
    // Show warnings but don't block
    const warnings = report.issues.filter(i => i.severity === 'warn' && i.id.startsWith('branch.'));
    if (warnings.length > 0) {
      logger.warn(`${warnings.length} warning(s) found. Run 'cursorflow doctor' for details.`);
    }
  }
  
  logger.section(`🔁 Resuming Lane: ${options.lane}`);
  logger.info(`Run: ${path.basename(runDir)}`);
  logger.info(`Tasks: ${state.tasksFile}`);
  logger.info(`Starting from task index: ${options.restart ? 0 : state.currentTaskIndex}`);
  
  const { child } = spawnLaneResume(options.lane, laneDir, state, {
    restart: options.restart,
    noGit: options.noGit,
    executor: options.executor,
    enhancedLogConfig: config.enhancedLogging,
  });
  
  logger.info(`Spawning runner process...`);
  
  return new Promise((resolve, reject) => {
    child.on('exit', (code) => {
      if (code === 0) {
        logger.success(`Lane ${options.lane} completed successfully`);
        resolve();
      } else if (code === 2) {
        logger.warn(`Lane ${options.lane} blocked on dependency change`);
        resolve();
      } else {
        reject(new Error(`Lane ${options.lane} failed with exit code ${code}`));
      }
    });
    
    child.on('error', (error) => {
      reject(new Error(`Failed to start runner: ${error.message}`));
    });
  });
}

export = resume;

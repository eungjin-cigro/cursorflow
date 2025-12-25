/**
 * CursorFlow resume command
 */

import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import * as logger from '../utils/logger';
import { loadConfig, getLogsDir, getPofDir } from '../utils/config';
import { loadState, saveState } from '../utils/state';
import { LaneState } from '../types';
import { runDoctor } from '../utils/doctor';
import { safeJoin } from '../utils/path';
import { 
  EnhancedLogManager, 
  createLogManager, 
  ParsedMessage
} from '../utils/enhanced-logger';
import { formatMessageForConsole } from '../utils/log-formatter';

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
  <lane>                 Lane name or tasks directory to resume
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
  cursorflow resume _cursorflow/tasks/feat1  # Resume all lanes in directory
  cursorflow resume --all --restart          # Restart all incomplete lanes from task 0
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

interface LaneInfo {
  name: string;
  dir: string;
  state: LaneState | null;
  needsResume: boolean;
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
    const config = loadConfig();
    const pofDir = getPofDir(config);
    if (!fs.existsSync(pofDir)) {
      fs.mkdirSync(pofDir, { recursive: true });
    }
    
    const runId = path.basename(runDir);
    const pofPath = safeJoin(pofDir, `pof-${runId}.json`);
    
    let existingPof = null;
    try {
      existingPof = JSON.parse(fs.readFileSync(pofPath, 'utf-8'));
    } catch {
      // Ignore errors (file might not exist)
    }
    
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
    
    // Use atomic write: write to temp file then rename
    const tempPath = `${pofPath}.${Math.random().toString(36).substring(2, 7)}.tmp`;
    try {
      fs.writeFileSync(tempPath, JSON.stringify(pof, null, 2), 'utf8');
      fs.renameSync(tempPath, pofPath);
      pofCreated = true;
      logger.info(`📋 POF file created: ${pofPath}`);
    } catch (err) {
      // If temp file was created, try to clean it up
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch { /* ignore */ }
      throw err;
    }
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
      
      return { name, dir, state, needsResume, isCompleted };
    });
  
  return lanes;
}

/**
 * Check if lane can be resumed (lane-level deps removed, always true)
 */
function areDependenciesCompleted(
  _lane: LaneInfo, 
  _allLanes: LaneInfo[],
  _completedLanes: Set<string>
): boolean {
  // Lane-level dependencies removed - use task-level dependsOn instead
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
    
    if (status === 'completed') completedCount++;
    if (lane.needsResume) needsResumeCount++;
    
    let resumeIndicator = '';
    if (lane.needsResume) {
      resumeIndicator = '\x1b[33m✓ resumable\x1b[0m';
    }
    
    console.log('  ' + 
      lane.name.padEnd(30) + 
      `${color}${status.padEnd(12)}${RESET}` +
      progress.padEnd(12) +
      resumeIndicator
    );
    
    // Show error if failed
    if (status === 'failed' && state?.error) {
      console.log(`  ${''.padEnd(30)}\x1b[31m└─ ${state.error.substring(0, 50)}${state.error.length > 50 ? '...' : ''}\x1b[0m`);
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

  const logManager = createLogManager(laneDir, laneName, options.enhancedLogConfig || {}, (msg) => {
    const formatted = formatMessageForConsole(msg, { 
      laneLabel: `[${laneName}]`,
      includeTimestamp: true 
    });
    process.stdout.write(formatted + '\n');
  });
  
  const child = spawn('node', runnerArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  
  if (child.stdout) {
    child.stdout.on('data', (data: Buffer) => {
      logManager.writeStdout(data);
    });
  }
  
  if (child.stderr) {
    child.stderr.on('data', (data: Buffer) => {
      logManager.writeStderr(data);
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
async function resumeLanes(
  lanesToResume: LaneInfo[],
  allLanes: LaneInfo[],
  options: { 
    restart: boolean; 
    maxConcurrent: number; 
    skipDoctor: boolean; 
    noGit: boolean;
    executor: string | null;
    enhancedLogConfig?: any;
  }
): Promise<{ succeeded: string[]; failed: string[]; skipped: string[] }> {
  const completedSet = new Set<string>(allLanes.filter(l => l.isCompleted).map(l => l.name));
  const toResumeNames = new Set<string>(lanesToResume.map(l => l.name));
  
  const skippedLanes: string[] = [];
  const resolvableLanes: LaneInfo[] = [];
  
  for (const lane of lanesToResume) {
    // Lane-level dependencies removed - all lanes can be resumed
    resolvableLanes.push(lane);
  }
  
  if (resolvableLanes.length === 0) {
    logger.warn('No lanes can be resumed due to dependency constraints.');
    return { succeeded: [], failed: [], skipped: skippedLanes };
  }
  
  logger.section(`🔁 Resuming ${resolvableLanes.length} Lane(s)`);
  logger.info(`Max concurrent: ${options.maxConcurrent}`);
  logger.info(`Mode: ${options.restart ? 'Restart from beginning' : 'Continue from last task'}`);
  
  // Run doctor check once if needed (check git status)
  if (!options.skipDoctor) {
    logger.info('Running pre-flight checks...');
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
  const sessionCompleted = new Set<string>(completedSet);
  const pending = new Set<string>(resolvableLanes.map(l => l.name));
  const active: Map<string, ChildProcess> = new Map();
  const laneMap = new Map<string, LaneInfo>(resolvableLanes.map(l => [l.name, l]));
  
  const findReadyLane = (): LaneInfo | null => {
    for (const laneName of pending) {
      const lane = laneMap.get(laneName)!;
      if (areDependenciesCompleted(lane, allLanes, sessionCompleted)) {
        return lane;
      }
    }
    return null;
  };
  
  const processNext = (): void => {
    while (active.size < options.maxConcurrent) {
      const lane = findReadyLane();
      if (!lane) {
        if (pending.size > 0 && active.size === 0) {
          const pendingList = Array.from(pending).join(', ');
          logger.error(`Deadlock detected! Lanes waiting: ${pendingList}`);
          for (const ln of pending) failed.push(ln);
          pending.clear();
        }
        break;
      }
      
      pending.delete(lane.name);
      logger.info(`Starting: ${lane.name} (task ${lane.state!.currentTaskIndex}/${lane.state!.totalTasks})`);
      
      const { child } = spawnLaneResume(lane.name, lane.dir, lane.state!, {
        restart: options.restart,
        noGit: options.noGit,
        executor: options.executor,
        enhancedLogConfig: options.enhancedLogConfig,
      });
      
      active.set(lane.name, child);
      
      waitForChild(child).then(code => {
        active.delete(lane.name);
        if (code === 0) {
          logger.success(`✓ ${lane.name} completed`);
          succeeded.push(lane.name);
          sessionCompleted.add(lane.name);
        } else if (code === 2) {
          logger.warn(`⚠ ${lane.name} blocked on dependency change`);
          failed.push(lane.name);
        } else {
          logger.error(`✗ ${lane.name} failed (exit ${code})`);
          failed.push(lane.name);
        }
        processNext();
      }).catch(err => {
        active.delete(lane.name);
        logger.error(`✗ ${lane.name} error: ${err.message}`);
        failed.push(lane.name);
        processNext();
      });
    }
  };
  
  processNext();
  
  while (active.size > 0 || pending.size > 0) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (active.size < options.maxConcurrent && pending.size > 0) {
      processNext();
    }
  }
  
  console.log('');
  logger.section('📊 Resume Summary');
  logger.info(`Succeeded: ${succeeded.length}`);
  if (failed.length > 0) logger.error(`Failed: ${failed.length} (${failed.join(', ')})`);
  if (skippedLanes.length > 0) logger.warn(`Skipped: ${skippedLanes.length} (${skippedLanes.join(', ')})`);
  
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
  
  let runDir = options.runDir;
  if (!runDir) {
    runDir = findLatestRunDir(logsDir);
  }
  
  if (!runDir || !fs.existsSync(runDir)) {
    throw new Error(`Run directory not found: ${runDir || 'latest'}. Have you run any tasks yet?`);
  }
  
  const allLanes = getAllLaneStatuses(runDir);
  let lanesToResume: LaneInfo[] = [];

  // Check if the lane argument is actually a tasks directory
  if (options.lane && fs.existsSync(options.lane) && fs.statSync(options.lane).isDirectory()) {
    const tasksDir = path.resolve(options.lane);
    lanesToResume = allLanes.filter(l => l.needsResume && l.state?.tasksFile && path.resolve(l.state.tasksFile).startsWith(tasksDir));
    
    if (lanesToResume.length > 0) {
      logger.info(`📂 Task directory detected: ${options.lane}`);
      logger.info(`Resuming ${lanesToResume.length} lane(s) from this directory.`);
    } else {
      logger.warn(`No incomplete lanes found using tasks from directory: ${options.lane}`);
      return;
    }
  } else if (options.all) {
    lanesToResume = allLanes.filter(l => l.needsResume && l.state?.tasksFile);
  } else if (options.lane) {
    const lane = allLanes.find(l => l.name === options.lane);
    if (!lane) {
      throw new Error(`Lane '${options.lane}' not found in run directory.`);
    }
    if (!lane.needsResume) {
      logger.success(`Lane '${options.lane}' is already completed.`);
      return;
    }
    lanesToResume = [lane];
  }

  // Check for zombie lanes
  const zombieCheck = checkAndFixZombieLanes(runDir);
  if (zombieCheck.fixed.length > 0) {
    logger.section('🔧 Zombie Lane Recovery');
    logger.info(`Fixed ${zombieCheck.fixed.length} zombie lane(s): ${zombieCheck.fixed.join(', ')}`);
    console.log('');
  }
  
  if (options.status) {
    printAllLaneStatus(runDir);
    return;
  }
  
  if (lanesToResume.length === 0) {
    if (options.lane || options.all) {
      logger.success('No lanes need to be resumed.');
    } else {
      printAllLaneStatus(runDir);
    }
    return;
  }

  const result = await resumeLanes(lanesToResume, allLanes, {
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
}

export = resume;

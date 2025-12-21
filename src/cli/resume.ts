/**
 * CursorFlow resume command
 */

import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import * as logger from '../utils/logger';
import { loadConfig, getLogsDir } from '../utils/config';
import { loadState, listLanesInRun } from '../utils/state';
import { LaneState } from '../utils/types';
import { runDoctor } from '../utils/doctor';

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
  };
}

/**
 * Find the latest run directory
 */
function findLatestRunDir(logsDir: string): string | null {
  const runsDir = path.join(logsDir, 'runs');
  if (!fs.existsSync(runsDir)) return null;
  
  const runs = fs.readdirSync(runsDir)
    .filter(d => d.startsWith('run-'))
    .sort()
    .reverse();
    
  return runs.length > 0 ? path.join(runsDir, runs[0]!) : null;
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
  dependsOn: string[];
  isCompleted: boolean;
}

/**
 * Get all lane statuses from a run directory
 */
function getAllLaneStatuses(runDir: string): LaneInfo[] {
  const lanesDir = path.join(runDir, 'lanes');
  if (!fs.existsSync(lanesDir)) {
    return [];
  }
  
  const lanes = fs.readdirSync(lanesDir)
    .filter(f => fs.statSync(path.join(lanesDir, f)).isDirectory())
    .map(name => {
      const dir = path.join(lanesDir, name);
      const statePath = path.join(dir, 'state.json');
      const state = fs.existsSync(statePath) ? loadState<LaneState>(statePath) : null;
      
      // Determine if lane needs resume
      const needsResume = state ? (
        state.status === 'failed' ||
        state.status === 'paused' ||
        state.status === 'running' || // If process crashed mid-run
        (state.status === 'pending' && state.currentTaskIndex > 0)
      ) : false;
      
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
 * Resume a single lane and return the child process
 */
function spawnLaneResume(
  laneName: string,
  laneDir: string,
  state: LaneState,
  options: { restart: boolean }
): ChildProcess {
  const runnerPath = require.resolve('../core/runner');
  const startIndex = options.restart ? 0 : state.currentTaskIndex;
  
  const runnerArgs = [
    runnerPath,
    state.tasksFile!,
    '--run-dir', laneDir,
    '--start-index', String(startIndex),
  ];
  
  const child = spawn('node', runnerArgs, {
    stdio: 'inherit',
    env: process.env,
  });
  
  return child;
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
  options: { restart: boolean; maxConcurrent: number; skipDoctor: boolean }
): Promise<{ succeeded: string[]; failed: string[]; skipped: string[] }> {
  const allLanes = getAllLaneStatuses(runDir);
  const lanesToResume = allLanes.filter(l => l.needsResume && l.state?.tasksFile);
  
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
      
      const child = spawnLaneResume(lane.name, lane.dir, lane.state!, {
        restart: options.restart,
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
  
  const laneDir = path.join(runDir, 'lanes', options.lane);
  const statePath = path.join(laneDir, 'state.json');
  
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
  
  const child = spawnLaneResume(options.lane, laneDir, state, {
    restart: options.restart,
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

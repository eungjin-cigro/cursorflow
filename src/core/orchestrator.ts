/**
 * Orchestrator - Parallel lane execution with dependency management
 * 
 * Features:
 * - Multi-layer stall detection
 * - Cyclic dependency detection
 * - Enhanced recovery strategies
 * - Health checks before start
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';

import * as logger from '../utils/logger';
import { loadState, saveState, createLaneState, validateLaneState } from '../utils/state';
import { LaneState, RunnerConfig, WebhookConfig, DependencyRequestPlan, EnhancedLogConfig } from '../utils/types';
import { events } from '../utils/events';
import { registerWebhooks } from '../utils/webhook';
import { loadConfig, getLogsDir } from '../utils/config';
import * as git from '../utils/git';
import { execSync } from 'child_process';
import { safeJoin } from '../utils/path';
import { 
  EnhancedLogManager, 
  createLogManager, 
  DEFAULT_LOG_CONFIG,
  ParsedMessage
} from '../utils/enhanced-logger';
import { formatMessageForConsole } from '../utils/log-formatter';
import { analyzeFailure, analyzeStall, RecoveryAction, logFailure, DEFAULT_STALL_CONFIG, StallDetectionConfig } from './failure-policy';
import { detectCyclicDependencies, validateDependencies, printDependencyGraph, DependencyInfo } from '../utils/dependency';
import { preflightCheck, printPreflightReport, autoRepair } from '../utils/health';
import { getLatestCheckpoint } from '../utils/checkpoint';
import { cleanStaleLocks, getLockDir } from '../utils/lock';

/** Heartbeat interval: 30 seconds */
const HEARTBEAT_INTERVAL_MS = 30000;

/** Default stall detection configuration */
const DEFAULT_ORCHESTRATOR_STALL_CONFIG: StallDetectionConfig = {
  ...DEFAULT_STALL_CONFIG,
  idleTimeoutMs: 3 * 60 * 1000,      // 3 minutes
  progressTimeoutMs: 10 * 60 * 1000,  // 10 minutes
  maxRestarts: 2,
};

export interface LaneInfo {
  name: string;
  path: string;
  dependsOn: string[];
  startIndex?: number; // Current task index to resume from
  restartCount?: number; // Number of times restarted due to stall
  lastStateUpdate?: number; // Timestamp of last state file update
  taskStartTime?: number; // When current task started
}

export interface SpawnLaneResult {
  child: ChildProcess;
  logPath: string;
  logManager?: EnhancedLogManager;
}

/**
 * Lane execution tracking info
 */
interface RunningLaneInfo {
  child: ChildProcess;
  logPath: string;
  logManager?: EnhancedLogManager;
  lastActivity: number;
  lastStateUpdate: number;
  stallPhase: number; // 0: normal, 1: continued, 2: restarted
  taskStartTime: number;
  lastOutput: string;
  statePath: string;
}

/**
 * Spawn a lane process
 */
export function spawnLane({ 
  laneName,
  tasksFile, 
  laneRunDir, 
  executor, 
  startIndex = 0, 
  pipelineBranch,
  worktreeDir,
  enhancedLogConfig,
  noGit = false,
  onActivity,
}: { 
  laneName: string; 
  tasksFile: string; 
  laneRunDir: string; 
  executor: string; 
  startIndex?: number;
  pipelineBranch?: string;
  worktreeDir?: string;
  enhancedLogConfig?: Partial<EnhancedLogConfig>;
  noGit?: boolean;
  onActivity?: () => void;
}): SpawnLaneResult {
  fs.mkdirSync(laneRunDir, { recursive: true});
  
  // Use extension-less resolve to handle both .ts (dev) and .js (dist)
  const runnerPath = require.resolve('./runner');
  
  const args = [
    runnerPath,
    tasksFile,
    '--run-dir', laneRunDir,
    '--executor', executor,
    '--start-index', startIndex.toString(),
  ];

  if (pipelineBranch) {
    args.push('--pipeline-branch', pipelineBranch);
  }

  if (worktreeDir) {
    args.push('--worktree-dir', worktreeDir);
  }
  
  if (noGit) {
    args.push('--no-git');
  }
  
  // Create enhanced log manager if enabled
  const logConfig = { ...DEFAULT_LOG_CONFIG, ...enhancedLogConfig };
  let logManager: EnhancedLogManager | undefined;
  let logPath: string;
  let child: ChildProcess;
  
  // Build environment for child process
  const childEnv = {
    ...process.env,
  };
  
  if (logConfig.enabled) {
    // Create callback for clean console output
    const onParsedMessage = (msg: ParsedMessage) => {
      if (onActivity) onActivity();
      const formatted = formatMessageForConsole(msg, { 
        laneLabel: `[${laneName}]`,
        includeTimestamp: true 
      });
      process.stdout.write(formatted + '\n');
    };

    logManager = createLogManager(laneRunDir, laneName, logConfig, onParsedMessage);
    logPath = logManager.getLogPaths().clean;
    
    // Spawn with pipe for enhanced logging
    child = spawn('node', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv,
      detached: false,
    });
    
    // Buffer for non-JSON lines
    let lineBuffer = '';

    // Pipe stdout and stderr through enhanced logger
    if (child.stdout) {
      child.stdout.on('data', (data: Buffer) => {
        logManager!.writeStdout(data);
        
        // Filter out JSON lines from console output to keep it clean
        const str = data.toString();
        lineBuffer += str;
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || '';
        
        for (const line of lines) {
          const trimmed = line.trim();
          // Show if it's a timestamped log line (starts with [YYYY-MM-DD... or [HH:MM:SS])
          // or if it's NOT a noisy JSON line
          const hasTimestamp = /^\[\d{4}-\d{2}-\d{2}T|\^\[\d{2}:\d{2}:\d{2}\]/.test(trimmed);
          const isJson = trimmed.startsWith('{') || trimmed.includes('{"type"');
          
          if (trimmed && !isJson) {
            if (onActivity) onActivity();
            // If line already has timestamp format, just add lane prefix
            if (hasTimestamp) {
              // Insert lane name after first timestamp
              const formatted = trimmed.replace(/^(\[[^\]]+\])/, `$1 ${logger.COLORS.magenta}[${laneName}]${logger.COLORS.reset}`);
              process.stdout.write(formatted + '\n');
            } else {
              // Add full prefix: timestamp + lane
              process.stdout.write(`${logger.COLORS.gray}[${new Date().toLocaleTimeString('en-US', { hour12: false })}]${logger.COLORS.reset} ${logger.COLORS.magenta}[${laneName}]${logger.COLORS.reset} ${line}\n`);
            }
          }
        }
      });
    }
    
    if (child.stderr) {
      child.stderr.on('data', (data: Buffer) => {
        logManager!.writeStderr(data);
        const str = data.toString();
        const lines = str.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            // Check if it's a real error or just git/status output on stderr
            const isStatus = trimmed.startsWith('Preparing worktree') || 
                             trimmed.startsWith('Switched to a new branch') ||
                             trimmed.startsWith('HEAD is now at') ||
                             trimmed.includes('actual output');
            
            const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
            if (isStatus) {
              process.stdout.write(`${logger.COLORS.gray}[${ts}]${logger.COLORS.reset} ${logger.COLORS.magenta}[${laneName}]${logger.COLORS.reset} ${trimmed}\n`);
            } else {
              if (onActivity) onActivity();
              process.stderr.write(`${logger.COLORS.gray}[${ts}]${logger.COLORS.reset} ${logger.COLORS.magenta}[${laneName}]${logger.COLORS.reset} ${logger.COLORS.red}❌ ERR ${trimmed}${logger.COLORS.reset}\n`);
            }
          }
        }
      });
    }
    
    // Close log manager when process exits
    child.on('exit', () => {
      logManager?.close();
    });
  } else {
    // Fallback to simple file logging
    logPath = safeJoin(laneRunDir, 'terminal.log');
    const logFd = fs.openSync(logPath, 'a');
    
    child = spawn('node', args, {
      stdio: ['ignore', logFd, logFd],
      env: childEnv,
      detached: false,
    });
    
    try {
      fs.closeSync(logFd);
    } catch {
      // Ignore
    }
  }
  
  return { child, logPath, logManager };
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
      const filePath = safeJoin(tasksDir, f);
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
    
    const statePath = safeJoin(dir, 'state.json');
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
 * Resolve dependencies for all blocked lanes and sync with all active lanes
 */
async function resolveAllDependencies(
  blockedLanes: Map<string, DependencyRequestPlan>, 
  allLanes: LaneInfo[], 
  laneRunDirs: Record<string, string>,
  pipelineBranch: string,
  runRoot: string
) {
  // 1. Collect all unique changes and commands from blocked lanes
  const allChanges: string[] = [];
  const allCommands: string[] = [];
  
  for (const [, plan] of blockedLanes) {
    if (plan.changes) allChanges.push(...plan.changes);
    if (plan.commands) allCommands.push(...plan.commands);
  }
  
  const uniqueChanges = Array.from(new Set(allChanges));
  const uniqueCommands = Array.from(new Set(allCommands));
  
  if (uniqueCommands.length === 0) return;

  // 2. Setup a temporary worktree for resolution if needed, or use the first available one
  const firstLaneName = Array.from(blockedLanes.keys())[0]!;
  const statePath = safeJoin(laneRunDirs[firstLaneName]!, 'state.json');
  const state = loadState<LaneState>(statePath);
  const worktreeDir = state?.worktreeDir || safeJoin(runRoot, 'resolution-worktree');

  if (!fs.existsSync(worktreeDir)) {
    logger.info(`Creating resolution worktree at ${worktreeDir}`);
    git.createWorktree(worktreeDir, pipelineBranch, { baseBranch: git.getCurrentBranch() });
  }

  // 3. Resolve on pipeline branch
  logger.info(`Resolving dependencies on ${pipelineBranch}`);
  git.runGit(['checkout', pipelineBranch], { cwd: worktreeDir });
  
  for (const cmd of uniqueCommands) {
    logger.info(`Running: ${cmd}`);
    try {
      execSync(cmd, { cwd: worktreeDir, stdio: 'inherit' });
    } catch (e: any) {
      throw new Error(`Command failed: ${cmd}. ${e.message}`);
    }
  }
  
  try {
    git.runGit(['add', '.'], { cwd: worktreeDir });
    git.runGit(['commit', '-m', `chore: auto-resolve dependencies\n\n${uniqueChanges.join('\n')}`], { cwd: worktreeDir });

    // Log changed files
    const stats = git.getLastOperationStats(worktreeDir);
    if (stats) {
      logger.info('Changed files:\n' + stats);
    }

    git.push(pipelineBranch, { cwd: worktreeDir });
  } catch (e) { /* ignore if nothing to commit */ }

  // 4. Sync ALL active lanes (blocked + pending + running)
  // Since we only call this when running.size === 0, "active" means not completed/failed
  for (const lane of allLanes) {
    const laneDir = laneRunDirs[lane.name];
    if (!laneDir) continue;

    const laneState = loadState<LaneState>(safeJoin(laneDir, 'state.json'));
    if (!laneState || laneState.status === 'completed' || laneState.status === 'failed') continue;

    // Merge pipelineBranch into the lane's current task branch
    const currentIdx = laneState.currentTaskIndex;
    const taskConfig = JSON.parse(fs.readFileSync(lane.path, 'utf8')) as RunnerConfig;
    const task = taskConfig.tasks[currentIdx];
    
    if (task) {
      const lanePipelineBranch = `${pipelineBranch}/${lane.name}`;
      const taskBranch = `${lanePipelineBranch}--${String(currentIdx + 1).padStart(2, '0')}-${task.name}`;
      logger.info(`Syncing lane ${lane.name} branch ${taskBranch}`);
      
      try {
        // If task branch doesn't exist yet, it will be created from pipelineBranch when the lane starts
        if (git.branchExists(taskBranch, { cwd: worktreeDir })) {
          git.runGit(['checkout', taskBranch], { cwd: worktreeDir });
          git.runGit(['merge', pipelineBranch, '--no-edit'], { cwd: worktreeDir });
          
          // Log changed files
          const stats = git.getLastOperationStats(worktreeDir);
          if (stats) {
            logger.info(`Sync results for ${lane.name}:\n` + stats);
          }

          git.push(taskBranch, { cwd: worktreeDir });
        }
      } catch (e: any) {
        logger.warn(`Failed to sync branch ${taskBranch}: ${e.message}`);
      }
    }
  }
  
  git.runGit(['checkout', pipelineBranch], { cwd: worktreeDir });
}

/**
 * Run orchestration with dependency management
 */
export async function orchestrate(tasksDir: string, options: { 
  runDir?: string; 
  executor?: string; 
  pollInterval?: number; 
  maxConcurrentLanes?: number;
  webhooks?: WebhookConfig[];
  autoResolveDependencies?: boolean;
  enhancedLogging?: Partial<EnhancedLogConfig>;
  noGit?: boolean;
  skipPreflight?: boolean;
  stallConfig?: Partial<StallDetectionConfig>;
} = {}): Promise<{ lanes: LaneInfo[]; exitCodes: Record<string, number>; runRoot: string }> {
  const lanes = listLaneFiles(tasksDir);
  
  if (lanes.length === 0) {
    throw new Error(`No lane task files found in ${tasksDir}`);
  }
  
  // Run preflight checks
  if (!options.skipPreflight) {
    logger.section('🔍 Preflight Checks');
    
    const preflight = await preflightCheck({
      requireRemote: !options.noGit,
      requireAuth: true,
    });
    
    if (!preflight.canProceed) {
      printPreflightReport(preflight);
      throw new Error('Preflight check failed. Please fix the blockers above.');
    }
    
    // Auto-repair if there are warnings
    if (preflight.warnings.length > 0) {
      logger.info('Attempting auto-repair...');
      const repair = await autoRepair();
      if (repair.repaired.length > 0) {
        for (const r of repair.repaired) {
          logger.success(`✓ ${r}`);
        }
      }
    }
    
    logger.success('✓ Preflight checks passed');
  }
  
  // Validate dependencies and detect cycles
  logger.section('📊 Dependency Analysis');
  
  const depInfos: DependencyInfo[] = lanes.map(l => ({
    name: l.name,
    dependsOn: l.dependsOn,
  }));
  
  const depValidation = validateDependencies(depInfos);
  
  if (!depValidation.valid) {
    logger.error('❌ Dependency validation failed:');
    for (const err of depValidation.errors) {
      logger.error(`   • ${err}`);
    }
    throw new Error('Invalid dependency configuration');
  }
  
  if (depValidation.warnings.length > 0) {
    for (const warn of depValidation.warnings) {
      logger.warn(`⚠️  ${warn}`);
    }
  }
  
  // Print dependency graph
  printDependencyGraph(depInfos);
  
  const config = loadConfig();
  const logsDir = getLogsDir(config);
  const runId = `run-${Date.now()}`;
  // Use absolute path for runRoot to avoid issues with subfolders
  const runRoot = options.runDir 
    ? (path.isAbsolute(options.runDir) ? options.runDir : path.resolve(process.cwd(), options.runDir)) // nosemgrep
    : safeJoin(logsDir, 'runs', runId);
  
  fs.mkdirSync(runRoot, { recursive: true });
  
  // Clean stale locks before starting
  try {
    const lockDir = getLockDir(git.getRepoRoot());
    const cleaned = cleanStaleLocks(lockDir);
    if (cleaned > 0) {
      logger.info(`Cleaned ${cleaned} stale lock(s)`);
    }
  } catch {
    // Ignore lock cleanup errors
  }

  const randomSuffix = Math.random().toString(36).substring(2, 7);
  const pipelineBranch = `cursorflow/run-${Date.now().toString(36)}-${randomSuffix}`;

  // Stall detection configuration
  const stallConfig: StallDetectionConfig = {
    ...DEFAULT_ORCHESTRATOR_STALL_CONFIG,
    ...options.stallConfig,
  };

  // Initialize event system
  events.setRunId(runId);
  if (options.webhooks) {
    registerWebhooks(options.webhooks);
  }

  events.emit('orchestration.started', {
    runId,
    tasksDir,
    laneCount: lanes.length,
    runRoot,
  });
  
  const maxConcurrent = options.maxConcurrentLanes || 10;
  const running: Map<string, RunningLaneInfo> = new Map();
  const exitCodes: Record<string, number> = {};
  const completedLanes = new Set<string>();
  const failedLanes = new Set<string>();
  const blockedLanes: Map<string, DependencyRequestPlan> = new Map();
  
  // Track start index for each lane (initially 0)
  for (const lane of lanes) {
    lane.startIndex = 0;
    lane.restartCount = 0;
  }
  
  const laneRunDirs: Record<string, string> = {};
  const laneWorktreeDirs: Record<string, string> = {};
  const repoRoot = git.getRepoRoot();
  
  for (const lane of lanes) {
    laneRunDirs[lane.name] = safeJoin(runRoot, 'lanes', lane.name);
    fs.mkdirSync(laneRunDirs[lane.name]!, { recursive: true });
    
    // Create initial state for ALL lanes so resume can find them even if they didn't start
    try {
      const taskConfig = JSON.parse(fs.readFileSync(lane.path, 'utf8')) as RunnerConfig;
      
      // Calculate unique branch and worktree for this lane
      const lanePipelineBranch = `${pipelineBranch}/${lane.name}`;
      
      // Use a flat worktree directory name to avoid race conditions in parent directory creation
      // repoRoot/_cursorflow/worktrees/cursorflow-run-xxx-lane-name
      const laneWorktreeDir = safeJoin(
        repoRoot, 
        taskConfig.worktreeRoot || '_cursorflow/worktrees', 
        lanePipelineBranch.replace(/\//g, '-')
      );
      
      // Ensure the parent directory exists before spawning the runner
      // to avoid race conditions in git worktree add or fs operations
      const worktreeParent = path.dirname(laneWorktreeDir);
      if (!fs.existsSync(worktreeParent)) {
        fs.mkdirSync(worktreeParent, { recursive: true });
      }
      
      laneWorktreeDirs[lane.name] = laneWorktreeDir;
      
      const initialState = createLaneState(lane.name, taskConfig, lane.path, {
        pipelineBranch: lanePipelineBranch,
        worktreeDir: laneWorktreeDir
      });
      saveState(safeJoin(laneRunDirs[lane.name]!, 'state.json'), initialState);
    } catch (e) {
      logger.warn(`Failed to create initial state for lane ${lane.name}: ${e}`);
    }
  }
  
  logger.section('🧭 Starting Orchestration');
  logger.info(`Tasks directory: ${tasksDir}`);
  logger.info(`Run directory: ${runRoot}`);
  logger.info(`Lanes: ${lanes.length}`);

  // Display dependency graph
  logger.info('\n📊 Dependency Graph:');
  for (const lane of lanes) {
    const deps = lane.dependsOn.length > 0 ? ` [depends on: ${lane.dependsOn.join(', ')}]` : '';
    console.log(`  ${logger.COLORS.cyan}${lane.name}${logger.COLORS.reset}${deps}`);
    
    // Simple tree-like visualization for deep dependencies
    if (lane.dependsOn.length > 0) {
      for (const dep of lane.dependsOn) {
        console.log(`    └─ ${dep}`);
      }
    }
  }
  console.log('');

  // Disable auto-resolve when noGit mode is enabled
  const autoResolve = !options.noGit && options.autoResolveDependencies !== false;
  
  if (options.noGit) {
    logger.info('🚫 Git operations disabled (--no-git mode)');
  }
  
  // Monitor lanes
  const monitorInterval = setInterval(() => {
    printLaneStatus(lanes, laneRunDirs);
  }, options.pollInterval || 60000);
  
  while (completedLanes.size + failedLanes.size + blockedLanes.size < lanes.length || (blockedLanes.size > 0 && running.size === 0)) {
    // 1. Identify lanes ready to start
    const readyToStart = lanes.filter(lane => {
      // Not already running or completed or failed or blocked
      if (running.has(lane.name) || completedLanes.has(lane.name) || failedLanes.has(lane.name) || blockedLanes.has(lane.name)) {
        return false;
      }
      
      // Check dependencies
      for (const dep of lane.dependsOn) {
        if (failedLanes.has(dep)) {
          logger.error(`Lane ${lane.name} will not start because dependency ${dep} failed`);
          failedLanes.add(lane.name);
          exitCodes[lane.name] = 1;
          return false;
        }
        if (blockedLanes.has(dep)) {
          // If a dependency is blocked, wait
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
      
      const laneStatePath = safeJoin(laneRunDirs[lane.name]!, 'state.json');
      
      // Validate and repair state before starting
      const validation = validateLaneState(laneStatePath, { autoRepair: true });
      if (!validation.valid && !validation.repaired) {
        logger.warn(`[${lane.name}] State validation issues: ${validation.issues.join(', ')}`);
      }
      
      logger.info(`Lane started: ${lane.name}${lane.startIndex ? ` (resuming from ${lane.startIndex})` : ''}`);
      
      let lastOutput = '';
      const spawnResult = spawnLane({
        laneName: lane.name,
        tasksFile: lane.path,
        laneRunDir: laneRunDirs[lane.name]!,
        executor: options.executor || 'cursor-agent',
        startIndex: lane.startIndex,
        pipelineBranch: `${pipelineBranch}/${lane.name}`,
        worktreeDir: laneWorktreeDirs[lane.name],
        enhancedLogConfig: options.enhancedLogging,
        noGit: options.noGit,
        onActivity: () => {
          const info = running.get(lane.name);
          if (info) {
            info.lastActivity = Date.now();
          }
        }
      });
      
      // Track last output for long operation detection
      if (spawnResult.child.stdout) {
        spawnResult.child.stdout.on('data', (data: Buffer) => {
          const info = running.get(lane.name);
          if (info) {
            info.lastOutput = data.toString().trim().split('\n').pop() || '';
          }
        });
      }
      
      const now = Date.now();
      running.set(lane.name, {
        ...spawnResult,
        lastActivity: now,
        lastStateUpdate: now,
        stallPhase: 0,
        taskStartTime: now,
        lastOutput: '',
        statePath: laneStatePath,
      });
      
      // Update lane tracking
      lane.taskStartTime = now;
      
      events.emit('lane.started', {
        laneName: lane.name,
        pid: spawnResult.child.pid,
        logPath: spawnResult.logPath,
      });
    }
    
    // 3. Wait for any running lane to finish OR check for stalls
    if (running.size > 0) {
      // Polling timeout for stall detection
      let pollTimeout: NodeJS.Timeout | undefined;
      const pollPromise = new Promise<{ name: string; code: number }>(resolve => {
        pollTimeout = setTimeout(() => resolve({ name: '__poll__', code: 0 }), 10000);
      });

      const promises = Array.from(running.entries()).map(async ([name, { child }]) => {
        const code = await waitChild(child);
        return { name, code };
      });
      
      const result = await Promise.race([...promises, pollPromise]);
      if (pollTimeout) clearTimeout(pollTimeout);
      
      if (result.name === '__poll__') {
        // Periodic stall check with multi-layer detection
        for (const [laneName, info] of running.entries()) {
          const now = Date.now();
          const idleTime = now - info.lastActivity;
          const lane = lanes.find(l => l.name === laneName)!;
          
          // Check state file for progress updates
          let progressTime = 0;
          try {
            const stateStat = fs.statSync(info.statePath);
            const stateUpdateTime = stateStat.mtimeMs;
            if (stateUpdateTime > info.lastStateUpdate) {
              info.lastStateUpdate = stateUpdateTime;
            }
            progressTime = now - info.lastStateUpdate;
          } catch {
            // State file might not exist yet
          }
          
          // Use multi-layer stall analysis
          const analysis = analyzeStall({
            stallPhase: info.stallPhase,
            idleTimeMs: idleTime,
            progressTimeMs: progressTime,
            lastOutput: info.lastOutput,
            restartCount: lane.restartCount || 0,
            taskStartTimeMs: info.taskStartTime,
          }, stallConfig);
          
          // Only act if action is not NONE
          if (analysis.action !== RecoveryAction.NONE) {
            logFailure(laneName, analysis);
            info.logManager?.log('error', analysis.message);

            if (analysis.action === RecoveryAction.CONTINUE_SIGNAL) {
              const interventionPath = safeJoin(laneRunDirs[laneName]!, 'intervention.txt');
              try {
                fs.writeFileSync(interventionPath, 'continue');
                info.stallPhase = 1;
                info.lastActivity = now;
                logger.info(`[${laneName}] Sent continue signal`);
              } catch (e) {
                logger.error(`Failed to write intervention file for ${laneName}: ${e}`);
              }
            } else if (analysis.action === RecoveryAction.RESTART_LANE || 
                       analysis.action === RecoveryAction.RESTART_LANE_FROM_CHECKPOINT) {
              lane.restartCount = (lane.restartCount || 0) + 1;
              info.stallPhase = 2;
              
              // Try to get checkpoint info
              const checkpoint = getLatestCheckpoint(laneRunDirs[laneName]!);
              if (checkpoint) {
                logger.info(`[${laneName}] Checkpoint available: ${checkpoint.id} (task ${checkpoint.taskIndex})`);
              }
              
              info.child.kill('SIGKILL');
              logger.info(`[${laneName}] Restarting lane (restart #${lane.restartCount})`);
            } else if (analysis.action === RecoveryAction.ABORT_LANE) {
              info.stallPhase = 3;
              info.child.kill('SIGKILL');
              logger.error(`[${laneName}] Aborting lane due to repeated stalls`);
            }
          }
        }
        continue;
      }

      const finished = result;
      const info = running.get(finished.name)!;
      running.delete(finished.name);
      exitCodes[finished.name] = finished.code;
      
      if (finished.code === 0) {
        completedLanes.add(finished.name);
        events.emit('lane.completed', {
          laneName: finished.name,
          exitCode: finished.code,
        });
      } else if (finished.code === 2) {
        // Blocked by dependency
        const statePath = safeJoin(laneRunDirs[finished.name]!, 'state.json');
        const state = loadState<LaneState>(statePath);
        
        if (state && state.dependencyRequest) {
          blockedLanes.set(finished.name, state.dependencyRequest);
          const lane = lanes.find(l => l.name === finished.name);
          if (lane) {
            lane.startIndex = Math.max(0, state.currentTaskIndex - 1); // Task was blocked, retry it
          }
          
          events.emit('lane.blocked', {
            laneName: finished.name,
            dependencyRequest: state.dependencyRequest,
          });
          logger.warn(`Lane ${finished.name} is blocked on dependency change request`);
        } else {
          failedLanes.add(finished.name);
          logger.error(`Lane ${finished.name} exited with code 2 but no dependency request found`);
        }
      } else {
        // Check if it was a restart request
        if (info.stallPhase === 2) {
          logger.info(`🔄 Lane ${finished.name} is being restarted due to stall...`);
          
          // Update startIndex from current state to resume from the same task
          const statePath = safeJoin(laneRunDirs[finished.name]!, 'state.json');
          const state = loadState<LaneState>(statePath);
          if (state) {
            const lane = lanes.find(l => l.name === finished.name);
            if (lane) {
              lane.startIndex = state.currentTaskIndex;
            }
          }
          
          // Note: we don't add to failedLanes or completedLanes, 
          // so it will be eligible to start again in the next iteration.
          continue; 
        }

        failedLanes.add(finished.name);
        events.emit('lane.failed', {
          laneName: finished.name,
          exitCode: finished.code,
          error: info.stallPhase === 3 ? 'Stopped due to repeated stall' : 'Process exited with non-zero code',
        });
      }
      
      printLaneStatus(lanes, laneRunDirs);
    } else {
      // Nothing running. Are we blocked?
      if (blockedLanes.size > 0 && autoResolve) {
        logger.section('🛠 Auto-Resolving Dependencies');
        
        try {
          await resolveAllDependencies(blockedLanes, lanes, laneRunDirs, pipelineBranch, runRoot);
          
          // Clear blocked status
          blockedLanes.clear();
          logger.success('Dependencies resolved and synced across all active lanes. Resuming...');
        } catch (error: any) {
          logger.error(`Auto-resolution failed: ${error.message}`);
          // Move blocked to failed
          for (const name of blockedLanes.keys()) {
            failedLanes.add(name);
          }
          blockedLanes.clear();
        }
      } else if (readyToStart.length === 0 && completedLanes.size + failedLanes.size + blockedLanes.size < lanes.length) {
        const remaining = lanes.filter(l => !completedLanes.has(l.name) && !failedLanes.has(l.name) && !blockedLanes.has(l.name));
        logger.error(`Deadlock detected! Remaining lanes cannot start: ${remaining.map(l => l.name).join(', ')}`);
        for (const l of remaining) {
          failedLanes.add(l.name);
          exitCodes[l.name] = 1;
        }
      } else {
        // All finished
        break;
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
  
  // Check for blocked lanes (if autoResolve was false)
  const blocked = Array.from(blockedLanes.keys());
  
  if (blocked.length > 0) {
    logger.warn(`Lanes blocked on dependency: ${blocked.join(', ')}`);
    logger.info('Handle dependency changes manually and resume lanes');
    events.emit('orchestration.failed', {
      error: 'Some lanes blocked on dependency change requests',
      blockedLanes: blocked,
    });
    process.exit(2);
  }
  
  logger.success('All lanes completed successfully!');
  events.emit('orchestration.completed', {
    runId,
    laneCount: lanes.length,
    completedCount: completedLanes.size,
    failedCount: failedLanes.size,
  });
  return { lanes, exitCodes, runRoot };
}

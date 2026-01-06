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
import { getLaneLogPath } from '../services/logging/paths';
import { 
  EnhancedLogManager, 
  createLogManager, 
  DEFAULT_LOG_CONFIG,
  ParsedMessage,
  stripAnsi
} from '../utils/enhanced-logger';
import { MAIN_LOG_FILENAME } from '../utils/log-constants';
import { formatMessageForConsole } from '../utils/log-formatter';
import { FailureType, analyzeFailure as analyzeFailureFromPolicy } from './failure-policy';
import { 
  savePOF,
  createPOFFromRecoveryState,
  getGitPushFailureGuidance,
  getMergeConflictGuidance,
  getGitErrorGuidance,
  LaneRecoveryState,
} from './auto-recovery';
import {
  isInterventionRestart,
} from './intervention';
import {
  StallDetectionService,
  getStallService,
  StallDetectionConfig,
  DEFAULT_STALL_CONFIG,
  RecoveryAction,
  StallPhase,
  StallAnalysis,
} from './stall-detection';
import { detectCyclicDependencies, validateDependencies, printDependencyGraph, DependencyInfo } from '../utils/dependency';
import { preflightCheck, printPreflightReport, autoRepair } from '../utils/health';
import { getLatestCheckpoint } from '../utils/checkpoint';
import { cleanStaleLocks, getLockDir } from '../utils/lock';

/** Default stall detection configuration - 2 minute idle timeout for recovery */
const DEFAULT_ORCHESTRATOR_STALL_CONFIG: Partial<StallDetectionConfig> = {
  idleTimeoutMs: 2 * 60 * 1000,       // 2 minutes (idle detection for continue signal)
  progressTimeoutMs: 10 * 60 * 1000,  // 10 minutes (only triggers if no activity at all)
  maxRestarts: 2,
};

export interface LaneInfo {
  name: string;
  path: string;
  startIndex?: number; // Current task index to resume from
  restartCount?: number; // Number of times restarted due to stall
  lastStateUpdate?: number; // Timestamp of last state file update
  taskStartTime?: number; // When current task started
}

export interface SpawnLaneResult {
  child: ChildProcess;
  logPath: string;
  logManager?: EnhancedLogManager;
  info: RunningLaneInfo;
}

/**
 * Lane execution tracking info
 * 
 * NOTE: Stall 감지 관련 상태(lastActivity, stallPhase 등)는 StallDetectionService에서 관리
 * 여기서는 프로세스 관리에 필요한 최소한의 정보만 유지
 */
interface RunningLaneInfo {
  child: ChildProcess;
  logPath: string;
  logManager?: EnhancedLogManager;
  statePath: string;
  laneIndex: number;
  currentTaskIndex?: number;
}

/**
 * Log the tail of a file
 */
function logFileTail(filePath: string, lines: number = 10): void {
  if (!fs.existsSync(filePath)) return;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const allLines = content.split('\n');
    const tail = allLines.slice(-lines).filter(l => l.trim());
    if (tail.length > 0) {
      logger.error(`  Last ${tail.length} lines of log:`);
      for (const line of tail) {
        logger.error(`    ${line}`);
      }
    }
  } catch (e) {
    // Ignore log reading errors
  }
}

/**
 * Handle RUN_DOCTOR action - runs async health diagnostics
 */
async function handleDoctorDiagnostics(
  laneName: string,
  laneRunDir: string,
  runId: string,
  runRoot: string,
  stallService: StallDetectionService,
  child: ChildProcess
): Promise<void> {
  // Import health check dynamically to avoid circular dependency
  const { checkAgentHealth, checkAuthHealth } = await import('../utils/health');
  
  const [agentHealth, authHealth] = await Promise.all([
    checkAgentHealth(),
    checkAuthHealth(),
  ]);
  
  const issues: string[] = [];
  if (!agentHealth.ok) issues.push(`Agent: ${agentHealth.message}`);
  if (!authHealth.ok) issues.push(`Auth: ${authHealth.message}`);
  
  if (issues.length > 0) {
    logger.error(`[${laneName}] Diagnostic issues found:\n  ${issues.join('\n  ')}`);
  } else {
    logger.warn(`[${laneName}] No obvious issues found. The problem may be with the AI model or network.`);
  }
  
  // Save diagnostic to file
  const diagnosticPath = safeJoin(laneRunDir, 'diagnostic.json');
  fs.writeFileSync(diagnosticPath, JSON.stringify({
    timestamp: Date.now(),
    agentHealthy: agentHealth.ok,
    authHealthy: authHealth.ok,
    issues,
  }, null, 2));
  
  // Kill the process
  try {
    child.kill('SIGKILL');
  } catch {
    // Process might already be dead
  }
  
  logger.error(`[${laneName}] Aborting lane after diagnostic. Check ${diagnosticPath} for details.`);
  
  // Save POF for failed recovery
  const stallState = stallService.getState(laneName);
  if (stallState) {
    try {
      const laneStatePath = safeJoin(laneRunDir, 'state.json');
      const laneState = loadState<LaneState>(laneStatePath);
      const pofDir = safeJoin(runRoot, '..', '..', 'pof');
      
      // Convert stall state to recovery state format for POF
      // Note: StallPhase and RecoveryStage have compatible numeric values (0-5)
      const recoveryState: LaneRecoveryState = {
        laneName,
        runId,
        stage: stallState.phase as unknown as number,  // Both enums use 0-5
        lastActivityTime: stallState.lastRealActivityTime,
        lastBytesReceived: stallState.bytesSinceLastCheck,
        totalBytesReceived: stallState.totalBytesReceived,
        lastOutput: stallState.lastOutput,
        restartCount: stallState.restartCount,
        continueSignalsSent: stallState.continueSignalCount,
        lastStageChangeTime: stallState.lastPhaseChangeTime,
        isLongOperation: stallState.isLongOperation,
        failureHistory: stallState.failureHistory.map(f => ({
          timestamp: f.timestamp,
          stage: f.phase as unknown as number,  // Both enums use 0-5
          action: f.action as string,
          message: f.message,
          idleTimeMs: f.idleTimeMs,
          bytesReceived: f.bytesReceived,
          lastOutput: f.lastOutput,
        })),
      };
      
      const diagnosticInfo = {
        timestamp: Date.now(),
        agentHealthy: agentHealth.ok,
        authHealthy: authHealth.ok,
        systemHealthy: true,
        suggestedAction: issues.length > 0 ? 'Fix the issues above and retry' : 'Try with a different model',
        details: issues.join('\n') || 'No obvious issues found',
      };
      
      const pofEntry = createPOFFromRecoveryState(
        runId,
        runRoot,
        laneName,
        recoveryState,
        laneState,
        diagnosticInfo
      );
      savePOF(runId, pofDir, pofEntry);
    } catch (pofError: any) {
      logger.warn(`[${laneName}] Failed to save POF: ${pofError.message}`);
    }
  }
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
  skipPreflight = false,
  onActivity,
  laneIndex = 0,
  browser,
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
  skipPreflight?: boolean;
  onActivity?: () => void;
  laneIndex?: number;
  browser?: boolean;
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

  if (skipPreflight) {
    args.push('--skip-preflight');
  }

  if (browser) {
    args.push('--browser');
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
    // Helper to get dynamic lane label like [1-1-refactor]
    const getDynamicLabel = () => {
      const laneNum = `${laneIndex + 1}`;
      const taskPart = `-${info.currentTaskIndex || 1}`;
      const shortLaneName = laneName.substring(0, 8);
      return `[${laneNum}${taskPart}-${shortLaneName}]`;
    };

    // Create callback for clean console output
    const onParsedMessage = (msg: ParsedMessage) => {
      if (onActivity) onActivity();
      const formatted = formatMessageForConsole(msg, { 
        laneLabel: getDynamicLabel(),
        includeTimestamp: true 
      });
      process.stdout.write(formatted + '\n');
    };

    logManager = createLogManager(laneRunDir, laneName, logConfig, onParsedMessage, laneIndex);
    logPath = logManager.getLogPaths().clean;
    
    // Spawn with pipe for enhanced logging
    child = spawn('node', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv,
      detached: false,
    });
    
    // Initialize info object for stdout handler to use
    const info: RunningLaneInfo = {
      child,
      logManager,
      logPath,
      statePath: safeJoin(laneRunDir, 'state.json'),
      laneIndex,
      currentTaskIndex: startIndex > 0 ? startIndex + 1 : 0
    };

    // Buffer for task progress detection
    let lineBuffer = '';

    // Pipe stdout and stderr through enhanced logger
    // Note: Console output is handled by onParsedMessage callback via logManager
    // Do NOT write to stdout/stderr directly here to avoid duplicate output
    if (child.stdout) {
      child.stdout.on('data', (data: Buffer) => {
        logManager!.writeStdout(data);
        
        // Track task progress for label updates (but don't output here)
        const str = data.toString();
        lineBuffer += str;
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() || '';
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // Detect task start/progress to update label
          // Example: [1/1] hello-task
          const cleanLine = stripAnsi(trimmed);
          const taskMatch = cleanLine.match(/^\s*\[(\d+)\/(\d+)\]\s+(.+)$/);
          if (taskMatch) {
            info.currentTaskIndex = parseInt(taskMatch[1]!);
            // Update log manager's task index to keep it in sync for readable log
            if (logManager) {
              logManager.setTask(taskMatch[3]!.trim(), undefined, info.currentTaskIndex - 1);
            }
          }

          // Track activity for stall detection (non-heartbeat lines only)
          const isJson = trimmed.startsWith('{') || trimmed.includes('{"type"');
          const isHeartbeat = trimmed.includes('Heartbeat') && trimmed.includes('bytes received');
          
          if (!isJson && !isHeartbeat && onActivity) {
            onActivity();
          }
        }
      });
    }
    
    if (child.stderr) {
      child.stderr.on('data', (data: Buffer) => {
        // Console output is handled by logManager's onParsedMessage callback
        logManager!.writeStderr(data);
      });
    }
    
    // Close log manager when process exits
    child.on('exit', () => {
      logManager?.close();
    });

    return { child, logPath, logManager, info };
  } else {
    // Fallback to simple file logging
    logPath = getLaneLogPath(laneRunDir, 'raw');
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

    return { 
      child, 
      logPath, 
      logManager, 
      info: {
        child,
        logPath,
        statePath: safeJoin(laneRunDir, 'state.json'),
        laneIndex
      }
    };
  }
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
    .filter(f => f.endsWith('.json') && f !== 'flow.meta.json')
    .sort()
    .map(f => {
      const filePath = safeJoin(tasksDir, f);
      const name = path.basename(f, '.json');
      
      return {
        name,
        path: filePath,
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
      return { lane: lane.name, status: 'pending', task: '-' };
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
    logger.info(`🏗️ Creating resolution worktree at ${worktreeDir}`);
    git.createWorktree(worktreeDir, pipelineBranch, { baseBranch: git.getCurrentBranch() });
  }

  // 3. Resolve on pipeline branch
  logger.info(`🔄 Resolving dependencies on branch ${pipelineBranch}`);
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
 * Finalize flow: merge all lane branches into integrated branch and cleanup
 */
export async function finalizeFlow(params: {
  tasksDir: string;
  runId: string;
  runRoot: string;
  laneRunDirs: Record<string, string>;
  laneWorktreeDirs: Record<string, string>;
  pipelineBranch: string;
  repoRoot: string;
  noCleanup?: boolean;
}): Promise<void> {
  const { tasksDir, runId, runRoot, laneRunDirs, laneWorktreeDirs, pipelineBranch, repoRoot, noCleanup } = params;
  
  // 1. Load FlowMeta
  const metaPath = safeJoin(tasksDir, 'flow.meta.json');
  let meta: any = null;
  let flowName = path.basename(tasksDir).replace(/^\d+_/, '');
  let baseBranch = 'main';
  
  if (fs.existsSync(metaPath)) {
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      flowName = meta.name || flowName;
      baseBranch = meta.baseBranch || 'main';
      
      // Update status to integrating
      meta.status = 'integrating';
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    } catch (e) {
      logger.warn(`Failed to read flow.meta.json: ${e}`);
    }
  }
  
  logger.section(`🏁 Finalizing Flow: ${flowName}`);
  
  // 2. Collect lane branches
  const laneBranches: string[] = [];
  for (const [laneName, laneDir] of Object.entries(laneRunDirs)) {
    const statePath = safeJoin(laneDir, 'state.json');
    if (fs.existsSync(statePath)) {
      try {
        const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        if (state.pipelineBranch) {
          laneBranches.push(state.pipelineBranch);
        }
      } catch (e) {
        logger.warn(`Failed to read lane state for ${laneName}: ${e}`);
      }
    }
  }
  
  if (laneBranches.length === 0) {
    logger.warn('No lane branches found to integrate');
    return;
  }
  
  // 3. Create integrated branch
  const targetBranch = `feature/${flowName}-integrated`;
  logger.info(`Target Branch: ${targetBranch}`);
  logger.info(`Base Branch: ${baseBranch}`);
  logger.info(`Lanes to merge: ${laneBranches.length}`);
  
  // Ensure we are on a clean state
  if (git.hasUncommittedChanges(repoRoot)) {
    logger.warn('Main repository has uncommitted changes. Stashing...');
    git.stash('auto-stash before flow completion', { cwd: repoRoot });
  }
  
  // Checkout base branch and create target branch
  logger.info(`Creating target branch '${targetBranch}' from '${baseBranch}'...`);
  git.runGit(['checkout', baseBranch], { cwd: repoRoot });
  git.runGit(['checkout', '-B', targetBranch], { cwd: repoRoot });
  
  // 4. Merge each lane branch
  for (const branch of laneBranches) {
    logger.info(`Merging ${branch}...`);
    
    // Determine what ref to use for merge
    let branchRef: string;
    
    if (git.branchExists(branch, { cwd: repoRoot })) {
      // Local branch exists, use it directly
      branchRef = branch;
    } else {
      // Local branch doesn't exist - fetch from remote with proper refspec
      // Note: `git fetch origin <branch>` only updates FETCH_HEAD, not origin/<branch>
      // We must use refspec to update the remote tracking ref
      try {
        git.runGit(['fetch', 'origin', `${branch}:refs/remotes/origin/${branch}`], { cwd: repoRoot });
        branchRef = `origin/${branch}`;
      } catch (e) {
        // Fallback: try fetching and use FETCH_HEAD directly
        logger.warn(`Failed to fetch with refspec, trying FETCH_HEAD: ${e}`);
        try {
          git.runGit(['fetch', 'origin', branch], { cwd: repoRoot });
          branchRef = 'FETCH_HEAD';
        } catch (e2) {
          logger.warn(`Failed to fetch ${branch}: ${e2}`);
          throw new Error(`Cannot fetch branch ${branch} from remote`);
        }
      }
    }
    
    const mergeResult = git.safeMerge(branchRef, {
      cwd: repoRoot,
      noFf: true,
      message: `chore: merge lane ${branch} into flow integration`,
      abortOnConflict: true,
    });
    
    if (!mergeResult.success) {
      if (mergeResult.conflict) {
        logger.error(`❌ Merge conflict with '${branch}': ${mergeResult.conflictingFiles.join(', ')}`);
        
        // Update meta with error
        if (meta) {
          meta.status = 'failed';
          meta.error = `Merge conflict: ${mergeResult.conflictingFiles.join(', ')}`;
          fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
        }
        
        throw new Error(`Merge conflict during integration: ${mergeResult.conflictingFiles.join(', ')}`);
      }
      throw new Error(`Merge failed for ${branch}: ${mergeResult.error}`);
    }
    logger.success(`✓ Merged ${branch}`);
  }
  
  // 5. Push final branch (with fallback if remote branch exists with different history)
  logger.info(`Pushing '${targetBranch}' to remote...`);
  const pushResult = git.pushWithFallbackBranchName(targetBranch, { cwd: repoRoot, setUpstream: true });
  
  if (!pushResult.success) {
    logger.error(`❌ Failed to push integrated branch: ${pushResult.error}`);
    if (meta) {
      meta.status = 'failed';
      meta.error = `Push failed: ${pushResult.error}`;
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    }
    throw new Error(`Failed to push integrated branch: ${pushResult.error}`);
  }
  
  const finalIntegratedBranch = pushResult.finalBranchName;
  if (pushResult.renamed) {
    logger.info(`📝 Branch was renamed from '${targetBranch}' to '${finalIntegratedBranch}' due to remote conflict`);
  }
  logger.success(`✓ Pushed ${finalIntegratedBranch}`);
  
  // 6. Cleanup (if not disabled)
  if (!noCleanup) {
    logger.info('🧹 Cleaning up temporary resources...');
    
    // Delete local and remote lane branches
    for (const branch of laneBranches) {
      // Delete local branch (if exists - lane runner may have already deleted it)
      if (git.branchExists(branch, { cwd: repoRoot })) {
        try {
          git.deleteBranch(branch, { cwd: repoRoot, force: true });
          logger.info(`  Deleted local branch: ${branch}`);
        } catch (e) {
          logger.warn(`Failed to delete local branch ${branch}: ${e}`);
        }
      }
      
      // Delete remote branch (always try - it should exist)
      try {
        git.deleteBranch(branch, { cwd: repoRoot, remote: true });
        logger.info(`  Deleted remote branch: ${branch}`);
      } catch {
        // Remote branch might not exist or no permission - this is OK
      }
    }
    
    // Remove worktrees
    for (const wtPath of Object.values(laneWorktreeDirs)) {
      if (fs.existsSync(wtPath)) {
        try {
          git.removeWorktree(wtPath, { cwd: repoRoot, force: true });
          if (fs.existsSync(wtPath)) {
            fs.rmSync(wtPath, { recursive: true, force: true });
          }
        } catch (e) {
          logger.warn(`Failed to remove worktree ${wtPath}: ${e}`);
        }
      }
    }
  }
  
  // 7. Update FlowMeta with completion info
  if (meta) {
    meta.status = 'completed';
    meta.integratedBranch = finalIntegratedBranch;
    meta.integratedAt = new Date().toISOString();
    delete meta.error;
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  }
  
  logger.section(`🎉 Flow Completed!`);
  logger.info(`Integrated branch: ${finalIntegratedBranch}`);
  logger.success(`All ${laneBranches.length} lanes merged successfully.`);
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
  browser?: boolean;
  /** Auto-complete flow when all lanes succeed (merge branches, cleanup) */
  autoComplete?: boolean;
  /** Skip cleanup even if autoComplete is true */
  noCleanup?: boolean;
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
  
  const config = loadConfig();
  
  // Set verbose git logging from config
  git.setVerboseGit(config.verboseGit || false);

  const logsDir = getLogsDir(config);
  const runId = `run-${Date.now()}`;
  // Use absolute path for runRoot to avoid issues with subfolders
  const runRoot = options.runDir 
    ? (path.isAbsolute(options.runDir) ? options.runDir : path.resolve(process.cwd(), options.runDir)) // nosemgrep
    : safeJoin(logsDir, 'runs', runId);
  
  fs.mkdirSync(runRoot, { recursive: true });
  // Main process logs live at the run root; lane/subprocess logs stay in per-lane directories.
  logger.setDefaultContext('MAIN');
  logger.setLogFile(safeJoin(runRoot, MAIN_LOG_FILENAME));
  
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

  // Initialize unified stall detection service (Single Source of Truth)
  const stallService = getStallService({
    ...DEFAULT_ORCHESTRATOR_STALL_CONFIG,
    ...options.stallConfig,
    verbose: process.env['DEBUG_STALL'] === 'true',
  });

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
  
  // Track waitChild promises outside the loop to avoid listener leak
  // Each lane gets exactly one promise that is reused across poll cycles
  const laneExitPromises: Map<string, Promise<{ name: string; code: number }>> = new Map();
  
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
      
      logger.info(`🏗️ Initializing lane ${lane.name}: branch=${lanePipelineBranch}`);
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

  // Disable auto-resolve when noGit mode is enabled
  const autoResolve = !options.noGit && options.autoResolveDependencies !== false;
  
  if (options.noGit) {
    logger.info('🚫 Git operations disabled (--no-git mode)');
  }
  
  // Monitor lanes
  const monitorInterval = setInterval(() => {
    printLaneStatus(lanes, laneRunDirs);
  }, options.pollInterval || 60000);
  
  // Handle process interruption
  const sigIntHandler = () => {
    logger.warn('\n⚠️  Orchestration interrupted! Stopping all lanes...');
    for (const [name, info] of running.entries()) {
      logger.info(`Stopping lane: ${name}`);
      try {
        info.child.kill('SIGTERM');
      } catch {
        // Ignore kill errors
      }
    }
    printLaneStatus(lanes, laneRunDirs);
    process.exit(130);
  };
  
  process.on('SIGINT', sigIntHandler);
  process.on('SIGTERM', sigIntHandler);
  
  let lastStallCheck = Date.now();
  
  try {
    while (completedLanes.size + failedLanes.size + blockedLanes.size < lanes.length || (blockedLanes.size > 0 && running.size === 0)) {
    // 1. Identify lanes ready to start (all lanes can start immediately - no lane-level dependencies)
    const readyToStart = lanes.filter(lane => {
      // Not already running or completed or failed or blocked
      if (running.has(lane.name) || completedLanes.has(lane.name) || failedLanes.has(lane.name) || blockedLanes.has(lane.name)) {
        return false;
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
      
      const now = Date.now();
      
      // Register lane with unified stall detection service FIRST
      // Pass intervention capability so stall service knows if continue signals will work
      stallService.registerLane(lane.name, {
        laneRunDir: laneRunDirs[lane.name]!,
        interventionEnabled: config.enableIntervention ?? true,
      });
      
      const laneIdx = lanes.findIndex(l => l.name === lane.name);
      
      // Pre-register lane in running map
      running.set(lane.name, {
        child: {} as any, // Placeholder, will be replaced below
        logManager: undefined,
        logPath: '',
        statePath: laneStatePath,
        laneIndex: laneIdx >= 0 ? laneIdx : 0,
      });

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
        skipPreflight: options.skipPreflight,
        laneIndex: laneIdx >= 0 ? laneIdx : 0,
        browser: options.browser,
        onActivity: () => {
          // Record state file update activity
          stallService.recordStateUpdate(lane.name);
        }
      });
      
      // Update with actual spawn result
      const existingInfo = running.get(lane.name)!;
      Object.assign(existingInfo, spawnResult.info);
      
      // Update stall service with child process reference
      stallService.setChildProcess(lane.name, spawnResult.child);
      
      // Track stdout for activity detection - delegate to StallDetectionService
      if (spawnResult.child.stdout) {
        spawnResult.child.stdout.on('data', (data: Buffer) => {
          const output = data.toString();
          const lines = output.split('\n').filter(l => l.trim());
          
          // Filter out heartbeats from activity tracking
          const realLines = lines.filter(line => !(line.includes('Heartbeat') && line.includes('bytes received')));
          
          if (realLines.length > 0) {
            // Real activity - record with bytes
            const lastRealLine = realLines[realLines.length - 1]!;
            stallService.recordActivity(lane.name, data.length, lastRealLine);
          } else if (lines.length > 0) {
            // Heartbeat only - record with 0 bytes (won't reset timer)
            stallService.recordActivity(lane.name, 0);
          }
        });
      }
      
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

      // Create exit promises only for lanes that don't have one yet
      // This prevents listener leak by reusing the same promise across poll cycles
      for (const [name, { child }] of running.entries()) {
        if (!laneExitPromises.has(name)) {
          laneExitPromises.set(name, waitChild(child).then(code => ({ name, code })));
        }
      }
      
      // Use existing promises instead of creating new ones
      const promises = Array.from(running.keys())
        .map(name => laneExitPromises.get(name)!)
        .filter(Boolean);
      
      const result = await Promise.race([...promises, pollPromise]);
      if (pollTimeout) clearTimeout(pollTimeout);
      
      const now = Date.now();
      if (result.name === '__poll__' || (now - lastStallCheck >= 10000)) {
        lastStallCheck = now;
        
        // Periodic stall check using unified StallDetectionService
        for (const [laneName, info] of running.entries()) {
          const lane = lanes.find(l => l.name === laneName)!;
          
          // Check state file for progress updates and sync lane status
          try {
            const stateStat = fs.statSync(info.statePath);
            const stallState = stallService.getState(laneName);
            if (stallState && stateStat.mtimeMs > stallState.lastStateUpdateTime) {
              stallService.recordStateUpdate(laneName);
            }
            
            // Sync lane status to stall service (skips stall detection when 'waiting' for dependencies)
            const laneState = loadState<LaneState>(info.statePath);
            if (laneState && stallState && laneState.status !== stallState.laneStatus) {
              stallService.setLaneStatus(laneName, laneState.status || 'running');
            }
          } catch {
            // State file might not exist yet
          }
          
          // Debug logging
          if (process.env['DEBUG_STALL']) {
            logger.debug(`[${laneName}] ${stallService.dumpState(laneName)}`);
          }
          
          // Run stall analysis and recovery (all logic is in StallDetectionService)
          // Note: checkAndRecover is now async as it may kill processes
          const analysis = await stallService.checkAndRecover(laneName);
          
          // Log to lane log manager if there was an action
          if (analysis.action !== RecoveryAction.NONE) {
            info.logManager?.log('error', analysis.message);
            
            // Handle special case: RUN_DOCTOR needs async operations
            if (analysis.action === RecoveryAction.RUN_DOCTOR) {
              await handleDoctorDiagnostics(
                laneName, 
                laneRunDirs[laneName]!, 
                runId, 
                runRoot, 
                stallService, 
                info.child
              );
            }
            
            // Sync restartCount back to lane info (for restart logic in process exit handler)
            lane.restartCount = stallService.getRestartCount(laneName);
          }
        }
        continue;
      } else {
        const finished = result;
        const info = running.get(finished.name)!;
        running.delete(finished.name);
        laneExitPromises.delete(finished.name); // Clean up promise to avoid memory leak
        exitCodes[finished.name] = finished.code;
        
        // Get stall state before unregistering
        const stallPhase = stallService.getPhase(finished.name);
        
        // Unregister from stall detection service
        stallService.unregisterLane(finished.name);
        
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
          // Check if it was a restart request or intervention (killed to be resumed)
          if (stallPhase === StallPhase.RESTART_REQUESTED || 
              stallPhase === StallPhase.CONTINUE_SENT || 
              stallPhase === StallPhase.STRONGER_PROMPT_SENT ||
              isInterventionRestart(laneRunDirs[finished.name]!)) {
            const isManual = isInterventionRestart(laneRunDirs[finished.name]!);
            const phaseName = isManual ? 'manual intervention' : 
                            (stallPhase === StallPhase.RESTART_REQUESTED ? 'restart' : 'automatic intervention');
            
            logger.info(`🔄 Lane ${finished.name} is being resumed/restarted due to ${phaseName}...`);
            
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
          
          let errorMsg = 'Process exited with non-zero code';
          if (stallPhase >= StallPhase.DIAGNOSED) {
            errorMsg = 'Stopped due to repeated stall';
          } else if (info.logManager) {
            const lastError = info.logManager.getLastError();
            if (lastError) {
              errorMsg = `Process failed: ${lastError}`;
            }
          }

          logger.error(`[${finished.name}] Lane failed with exit code ${finished.code}: ${errorMsg}`);
          
          // Log log tail for visibility
          if (info.logPath) {
            logFileTail(info.logPath, 15);
          }

          events.emit('lane.failed', {
            laneName: finished.name,
            exitCode: finished.code,
            error: errorMsg,
          });
        }
        
        printLaneStatus(lanes, laneRunDirs);
      }
    } else {
      // Nothing running. Are we blocked?
      
      // Wait a bit to avoid busy-spin while waiting for dependencies or new slots
      if (completedLanes.size + failedLanes.size + blockedLanes.size < lanes.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

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
  } finally {
    clearInterval(monitorInterval);
    process.removeListener('SIGINT', sigIntHandler);
    process.removeListener('SIGTERM', sigIntHandler);
  }
  
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
  
  // Auto-complete flow: merge all lane branches and cleanup
  const autoComplete = options.autoComplete !== false && !options.noGit;
  if (autoComplete && completedLanes.size === lanes.length) {
    try {
      await finalizeFlow({
        tasksDir,
        runId,
        runRoot,
        laneRunDirs,
        laneWorktreeDirs,
        pipelineBranch,
        repoRoot,
        noCleanup: options.noCleanup,
      });
    } catch (error: any) {
      logger.error(`Flow auto-completion failed: ${error.message}`);
      logger.info('You can manually complete the flow with: cursorflow complete');
    }
  }
  
  events.emit('orchestration.completed', {
    runId,
    laneCount: lanes.length,
    completedCount: completedLanes.size,
    failedCount: failedLanes.size,
  });
  return { lanes, exitCodes, runRoot };
}

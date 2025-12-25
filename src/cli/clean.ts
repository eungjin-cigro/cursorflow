/**
 * CursorFlow clean command
 * 
 * Clean up worktrees, branches, and logs created by CursorFlow
 */

import * as fs from 'fs';
import * as path from 'path';
import * as logger from '../utils/logger';
import * as git from '../utils/git';
import { loadConfig, getLogsDir, getTasksDir } from '../utils/config';
import { safeJoin } from '../utils/path';
import { RunService } from '../utils/run-service';

interface CleanOptions {
  type?: string;
  pattern: string | null;
  dryRun: boolean;
  force: boolean;
  all: boolean;
  help: boolean;
  keepLatest: boolean;
  includeLatest: boolean;
  run?: string;
  olderThan?: number;
  orphaned: boolean;
  noPush: boolean;  // Skip auto-push before cleaning
}

function printHelp(): void {
  console.log(`
Usage: cursorflow clean <type> [options]

Clean up resources created by CursorFlow.

Types:
  branches               Remove local feature branches
  worktrees              Remove temporary Git worktrees
  logs                   Clear log directories
  tasks                  Clear task directories
  all                    Remove all of the above (default)

Options:
  --run <id>             Clean resources linked to a specific run
  --older-than <days>    Clean resources older than N days
  --orphaned             Clean orphaned resources (not linked to any run)
  --dry-run              Show what would be removed without deleting
  --force                Force removal (ignore uncommitted changes)
  --include-latest       Also remove the most recent item (by default, latest is kept)
  --no-push              Skip auto-push to remote before cleaning worktrees
  --help, -h             Show help

Safety:
  By default, worktrees are pushed to remote before deletion to prevent data loss.
  Use --no-push only for truly ephemeral work that doesn't need backup.
  `);
}

function parseArgs(args: string[]): CleanOptions {
  const includeLatest = args.includes('--include-latest');
  const runIdx = args.indexOf('--run');
  const olderThanIdx = args.indexOf('--older-than');

  return {
    type: args.find(a => ['branches', 'worktrees', 'logs', 'tasks', 'all'].includes(a)),
    pattern: null,
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
    all: args.includes('--all'),
    help: args.includes('--help') || args.includes('-h'),
    keepLatest: !includeLatest, // Default: keep latest, unless --include-latest is specified
    includeLatest,
    run: runIdx >= 0 ? args[runIdx + 1] : undefined,
    olderThan: olderThanIdx >= 0 ? parseInt(args[olderThanIdx + 1] || '0') : undefined,
    orphaned: args.includes('--orphaned'),
    noPush: args.includes('--no-push'),
  };
}

/**
 * Get the modification time of a path (directory or file)
 */
function getModTime(targetPath: string): number {
  try {
    const stat = fs.statSync(targetPath);
    return stat.mtimeMs;
  } catch {
    return 0;
  }
}

interface ActiveFlowInfo {
  runId: string;
  activeLanes: number;
  pids: number[];
}

/**
 * Detect active flows by checking for running processes
 */
function detectActiveFlows(runsDir: string): ActiveFlowInfo[] {
  if (!fs.existsSync(runsDir)) {
    return [];
  }
  
  const activeFlows: ActiveFlowInfo[] = [];
  
  try {
    const runs = fs.readdirSync(runsDir)
      .filter(d => d.startsWith('run-'));
    
    for (const runId of runs) {
      const lanesDir = safeJoin(runsDir, runId, 'lanes');
      if (!fs.existsSync(lanesDir)) continue;
      
      const activePids: number[] = [];
      
      const lanes = fs.readdirSync(lanesDir)
        .filter(f => fs.statSync(safeJoin(lanesDir, f)).isDirectory());
      
      for (const laneName of lanes) {
        const statePath = safeJoin(lanesDir, laneName, 'state.json');
        if (!fs.existsSync(statePath)) continue;
        
        try {
          const stateContent = fs.readFileSync(statePath, 'utf8');
          const state = JSON.parse(stateContent);
          
          // Check if lane has a running process
          if (state.status === 'running' && state.pid) {
            // Verify process is actually alive
            try {
              process.kill(state.pid, 0);
              activePids.push(state.pid);
            } catch {
              // Process is dead - not active
            }
          }
        } catch {
          // Ignore parse errors
        }
      }
      
      if (activePids.length > 0) {
        activeFlows.push({
          runId,
          activeLanes: activePids.length,
          pids: activePids,
        });
      }
    }
  } catch {
    // Ignore errors
  }
  
  return activeFlows;
}

async function clean(args: string[]): Promise<void> {
  const options = parseArgs(args);
  
  if (options.help) {
    printHelp();
    return;
  }

  const config = loadConfig();
  const repoRoot = git.getRepoRoot();
  const logsDir = getLogsDir(config);
  const runsDir = safeJoin(logsDir, 'runs');
  const runService = new RunService(runsDir);

  logger.section('🧹 Cleaning CursorFlow Resources');

  // Check for active flows and warn
  const activeFlows = detectActiveFlows(runsDir);
  if (activeFlows.length > 0 && !options.dryRun) {
    logger.warn(`\n⚠️  Active flows detected: ${activeFlows.length}`);
    for (const flow of activeFlows) {
      logger.warn(`   - ${flow.runId}: ${flow.activeLanes} active lane(s)`);
    }
    
    if (!options.force) {
      logger.error('\nCleaning with active flows may cause data loss!');
      logger.info('Options:');
      logger.info('  --force       Proceed anyway (branches will be pushed first)');
      logger.info('  --dry-run     See what would be cleaned');
      logger.info('  --run <id>    Clean only a specific (non-active) run');
      throw new Error('Active flows detected. Use --force to proceed or wait for flows to complete.');
    }
    
    logger.warn('\nProceeding with --force. Branches will be pushed to remote before deletion.\n');
  }

  // Handle specific run cleanup
  if (options.run) {
    await cleanRunResources(runService, options.run, repoRoot, options);
    logger.success('\n✨ Run cleaning complete!');
    return;
  }

  // Handle older-than cleanup
  if (options.olderThan !== undefined) {
    await cleanOlderRuns(runService, options.olderThan, repoRoot, options);
    logger.success(`\n✨ Older than ${options.olderThan} days cleaning complete!`);
    return;
  }

  // Handle orphaned cleanup
  if (options.orphaned) {
    await cleanOrphanedResources(runService, config, repoRoot, options);
    logger.success('\n✨ Orphaned resources cleaning complete!');
    return;
  }

  const type = options.type || 'all';

  if (type === 'all') {
    await cleanWorktrees(config, repoRoot, options);
    await cleanBranches(config, repoRoot, options);
    await cleanLogs(config, options);
    await cleanTasks(config, options);
  } else if (type === 'worktrees') {
    await cleanWorktrees(config, repoRoot, options);
  } else if (type === 'branches') {
    await cleanBranches(config, repoRoot, options);
  } else if (type === 'logs') {
    await cleanLogs(config, options);
  } else if (type === 'tasks') {
    await cleanTasks(config, options);
  }

  logger.success('\n✨ Cleaning complete!');
}

/**
 * Push worktree changes to remote before deletion
 */
function pushWorktreeToRemote(wt: git.WorktreeInfo, options: CleanOptions): { success: boolean; skipped: boolean; error?: string } {
  if (options.noPush) {
    return { success: true, skipped: true };
  }
  
  if (!wt.branch) {
    return { success: true, skipped: true, error: 'No branch associated with worktree' };
  }
  
  // Extract branch name (remove refs/heads/ prefix if present)
  const branchName = wt.branch.replace('refs/heads/', '');
  
  // Check if worktree directory exists
  if (!fs.existsSync(wt.path)) {
    return { success: true, skipped: true };
  }
  
  // Push any uncommitted changes
  const result = git.checkpointAndPush({
    cwd: wt.path,
    message: '[cursorflow] checkpoint before clean',
    branchName,
  });
  
  if (result.success) {
    if (result.committed || result.pushed) {
      logger.info(`    📤 Pushed to remote: ${branchName}`);
    }
    return { success: true, skipped: false };
  }
  
  return { success: false, skipped: false, error: result.error };
}

async function cleanWorktrees(config: any, repoRoot: string, options: CleanOptions) {
  logger.info('\nChecking worktrees...');
  const worktrees = git.listWorktrees(repoRoot);
  
  const worktreeRoot = safeJoin(repoRoot, config.worktreeRoot || '_cursorflow/worktrees');
  let toRemove = worktrees.filter(wt => {
    // Skip main worktree
    if (wt.path === repoRoot) return false;
    
    const isInsideRoot = wt.path.startsWith(worktreeRoot);
    const hasPrefix = path.basename(wt.path).startsWith(config.worktreePrefix || 'cursorflow-');
    
    return isInsideRoot || hasPrefix;
  });

  if (toRemove.length === 0) {
    logger.info('  No worktrees found to clean.');
    return;
  }

  // If keepLatest is set, keep the most recent worktree
  if (options.keepLatest && toRemove.length > 1) {
    // Sort by modification time (newest first)
    toRemove.sort((a, b) => getModTime(b.path) - getModTime(a.path));
    const kept = toRemove[0];
    toRemove = toRemove.slice(1);
    logger.info(`  Keeping latest worktree: ${kept.path} (${kept.branch || 'no branch'})`);
  }

  // Auto-push worktrees before deletion (unless --no-push specified)
  if (!options.noPush && !options.dryRun) {
    logger.info('  📦 Backing up worktrees to remote before deletion...');
    for (const wt of toRemove) {
      const pushResult = pushWorktreeToRemote(wt, options);
      if (!pushResult.success && !pushResult.skipped) {
        logger.warn(`    ⚠️ Failed to push ${wt.branch || wt.path}: ${pushResult.error}`);
        if (!options.force) {
          logger.warn(`    Skipping deletion of ${wt.path}. Use --force to delete anyway.`);
          continue;
        }
      }
    }
  }

  for (const wt of toRemove) {
    if (options.dryRun) {
      logger.info(`  [DRY RUN] Would remove worktree: ${wt.path} (${wt.branch || 'no branch'})`);
    } else {
      try {
        logger.info(`  Removing worktree: ${wt.path}...`);
        git.removeWorktree(wt.path, { cwd: repoRoot, force: options.force });
        
        // Git worktree remove might leave the directory if it has untracked files
        if (fs.existsSync(wt.path)) {
           if (options.force) {
             fs.rmSync(wt.path, { recursive: true, force: true });
             logger.info(`  (Forced removal of directory)`);
           } else {
             logger.warn(`  Directory still exists: ${wt.path} (contains untracked files). Use --force to delete anyway.`);
           }
        }
      } catch (e: any) {
        logger.error(`  Failed to remove worktree ${wt.path}: ${e.message}`);
      }
    }
  }
}

/**
 * Get the commit timestamp of a branch
 */
function getBranchCommitTime(branch: string, repoRoot: string): number {
  try {
    const result = git.runGitResult(['log', '-1', '--format=%ct', branch], { cwd: repoRoot });
    if (result.success && result.stdout.trim()) {
      return parseInt(result.stdout.trim(), 10) * 1000; // Convert to milliseconds
    }
  } catch {
    // Ignore errors
  }
  return 0;
}

async function cleanBranches(config: any, repoRoot: string, options: CleanOptions) {
  logger.info('\nChecking branches...');
  
  // List all local branches
  const result = git.runGitResult(['branch', '--list'], { cwd: repoRoot });
  if (!result.success) return;

  const branches = result.stdout
    .split('\n')
    .map(b => b.replace(/\*/g, '').trim())
    .filter(b => b && b !== 'main' && b !== 'master');

  const prefix = config.branchPrefix || 'feature/';
  let toDelete = branches.filter(b => b.startsWith(prefix));

  if (toDelete.length === 0) {
    logger.info('  No branches found to clean.');
    return;
  }

  // If keepLatest is set, keep the most recent branch
  if (options.keepLatest && toDelete.length > 1) {
    // Sort by commit time (newest first)
    toDelete.sort((a, b) => getBranchCommitTime(b, repoRoot) - getBranchCommitTime(a, repoRoot));
    const kept = toDelete[0];
    toDelete = toDelete.slice(1);
    logger.info(`  Keeping latest branch: ${kept}`);
  }

  for (const branch of toDelete) {
    if (options.dryRun) {
      logger.info(`  [DRY RUN] Would delete branch: ${branch}`);
    } else {
      try {
        logger.info(`  Deleting branch: ${branch}...`);
        git.deleteBranch(branch, { cwd: repoRoot, force: options.force || options.all });
      } catch (e: any) {
        logger.warn(`  Could not delete branch ${branch}: ${e.message}. Use --force if it's not merged.`);
      }
    }
  }
}

async function cleanLogs(config: any, options: CleanOptions) {
  const logsDir = getLogsDir(config);
  logger.info(`\nChecking logs in ${logsDir}...`);

  if (!fs.existsSync(logsDir)) {
    logger.info('  Logs directory does not exist.');
    return;
  }

  // If keepLatest is set, keep the most recent log directory/file
  if (options.keepLatest) {
    const entries = fs.readdirSync(logsDir, { withFileTypes: true });
    let items = entries.map(entry => ({
      name: entry.name,
      path: safeJoin(logsDir, entry.name),
      isDir: entry.isDirectory(),
      mtime: getModTime(safeJoin(logsDir, entry.name))
    }));

    if (items.length <= 1) {
      logger.info('  Only one or no log entries found, nothing to clean.');
      return;
    }

    // Sort by modification time (newest first)
    items.sort((a, b) => b.mtime - a.mtime);
    const kept = items[0];
    const toRemove = items.slice(1);

    logger.info(`  Keeping latest log: ${kept.name}`);

    for (const item of toRemove) {
      if (options.dryRun) {
        logger.info(`  [DRY RUN] Would remove log: ${item.name}`);
      } else {
        try {
          logger.info(`  Removing log: ${item.name}...`);
          fs.rmSync(item.path, { recursive: true, force: true });
        } catch (e: any) {
          logger.error(`  Failed to remove log ${item.name}: ${e.message}`);
        }
      }
    }
  } else {
    if (options.dryRun) {
      logger.info(`  [DRY RUN] Would remove logs directory: ${logsDir}`);
    } else {
      try {
        logger.info(`  Removing logs...`);
        fs.rmSync(logsDir, { recursive: true, force: true });
        fs.mkdirSync(logsDir, { recursive: true });
        logger.info(`  Logs cleared.`);
      } catch (e: any) {
        logger.error(`  Failed to clean logs: ${e.message}`);
      }
    }
  }
}

async function cleanTasks(config: any, options: CleanOptions) {
  const tasksDir = getTasksDir(config);
  logger.info(`\nChecking tasks in ${tasksDir}...`);

  if (!fs.existsSync(tasksDir)) {
    logger.info('  Tasks directory does not exist.');
    return;
  }

  // If keepLatest is set, keep the most recent task directory/file
  if (options.keepLatest) {
    const entries = fs.readdirSync(tasksDir, { withFileTypes: true });
    // Skip example task if it exists and there are other tasks
    let items = entries
      .filter(entry => entry.name !== 'example')
      .map(entry => ({
        name: entry.name,
        path: safeJoin(tasksDir, entry.name),
        isDir: entry.isDirectory(),
        mtime: getModTime(safeJoin(tasksDir, entry.name))
      }));

    if (items.length <= 1) {
      logger.info('  Only one or no user task entries found, nothing to clean.');
      return;
    }

    // Sort by modification time (newest first)
    items.sort((a, b) => b.mtime - a.mtime);
    const kept = items[0];
    const toRemove = items.slice(1);

    logger.info(`  Keeping latest task: ${kept.name}`);

    for (const item of toRemove) {
      if (options.dryRun) {
        logger.info(`  [DRY RUN] Would remove task: ${item.name}`);
      } else {
        try {
          logger.info(`  Removing task: ${item.name}...`);
          fs.rmSync(item.path, { recursive: true, force: true });
        } catch (e: any) {
          logger.error(`  Failed to remove task ${item.name}: ${e.message}`);
        }
      }
    }
  } else {
    if (options.dryRun) {
      logger.info(`  [DRY RUN] Would remove tasks in directory: ${tasksDir} (except example)`);
    } else {
      try {
        const entries = fs.readdirSync(tasksDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === 'example') continue;
          const itemPath = safeJoin(tasksDir, entry.name);
          logger.info(`  Removing task: ${entry.name}...`);
          fs.rmSync(itemPath, { recursive: true, force: true });
        }
        logger.info(`  Tasks cleared.`);
      } catch (e: any) {
        logger.error(`  Failed to clean tasks: ${e.message}`);
      }
    }
  }
}

async function cleanRunResources(runService: RunService, runId: string, repoRoot: string, options: CleanOptions) {
  const run = runService.getRunInfo(runId);
  if (!run) {
    logger.warn(`Run not found: ${runId}`);
    return;
  }

  logger.info(`\nCleaning resources for run: ${runId} (${run.taskName})`);

  // Clean branches
  if (run.branches.length > 0) {
    logger.info('  Cleaning branches...');
    for (const branch of run.branches) {
      if (options.dryRun) {
        logger.info(`    [DRY RUN] Would delete branch: ${branch}`);
      } else {
        try {
          git.deleteBranch(branch, { cwd: repoRoot, force: true });
          logger.info(`    Deleted branch: ${branch}`);
        } catch (e: any) {
          logger.warn(`    Could not delete branch ${branch}: ${e.message}`);
        }
      }
    }
  }

  // Clean worktrees
  if (run.worktrees.length > 0) {
    logger.info('  Cleaning worktrees...');
    for (const wtPath of run.worktrees) {
      if (options.dryRun) {
        logger.info(`    [DRY RUN] Would remove worktree: ${wtPath}`);
      } else {
        try {
          git.removeWorktree(wtPath, { cwd: repoRoot, force: true });
          if (fs.existsSync(wtPath)) {
            fs.rmSync(wtPath, { recursive: true, force: true });
          }
          logger.info(`    Removed worktree: ${wtPath}`);
        } catch (e: any) {
          logger.warn(`    Could not remove worktree ${wtPath}: ${e.message}`);
        }
      }
    }
  }

  // Delete run directory
  if (options.dryRun) {
    logger.info(`  [DRY RUN] Would delete run directory: ${run.path}`);
  } else {
    try {
      runService.deleteRun(runId, { force: options.force });
      logger.info(`  Deleted run directory: ${run.path}`);
    } catch (e: any) {
      logger.error(`  Failed to delete run ${runId}: ${e.message}`);
    }
  }
}

async function cleanOlderRuns(runService: RunService, days: number, repoRoot: string, options: CleanOptions) {
  const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
  const runs = runService.listRuns();
  const olderRuns = runs.filter(run => run.startTime < cutoff);

  if (olderRuns.length === 0) {
    logger.info(`No runs found older than ${days} days.`);
    return;
  }

  logger.info(`Found ${olderRuns.length} runs older than ${days} days.`);
  for (const run of olderRuns) {
    await cleanRunResources(runService, run.id, repoRoot, options);
  }
}

async function cleanOrphanedResources(runService: RunService, config: any, repoRoot: string, options: CleanOptions) {
  const runs = runService.listRuns();
  const linkedWorktrees = new Set(runs.flatMap(r => r.worktrees));
  const linkedBranches = new Set(runs.flatMap(r => r.branches));

  // Clean orphaned worktrees
  logger.info('\nChecking for orphaned worktrees...');
  const worktrees = git.listWorktrees(repoRoot);
  const worktreeRoot = safeJoin(repoRoot, config.worktreeRoot || '_cursorflow/worktrees');
  
  const orphanedWorktrees = worktrees.filter(wt => {
    if (wt.path === repoRoot) return false;
    const isInsideRoot = wt.path.startsWith(worktreeRoot);
    const hasPrefix = path.basename(wt.path).startsWith(config.worktreePrefix || 'cursorflow-');
    return (isInsideRoot || hasPrefix) && !linkedWorktrees.has(wt.path);
  });

  if (orphanedWorktrees.length === 0) {
    logger.info('  No orphaned worktrees found.');
  } else {
    for (const wt of orphanedWorktrees) {
      if (options.dryRun) {
        logger.info(`  [DRY RUN] Would remove orphaned worktree: ${wt.path}`);
      } else {
        try {
          git.removeWorktree(wt.path, { cwd: repoRoot, force: true });
          if (fs.existsSync(wt.path)) {
            fs.rmSync(wt.path, { recursive: true, force: true });
          }
          logger.info(`  Removed orphaned worktree: ${wt.path}`);
        } catch (e: any) {
          logger.warn(`  Could not remove orphaned worktree ${wt.path}: ${e.message}`);
        }
      }
    }
  }

  // Clean orphaned branches
  logger.info('\nChecking for orphaned branches...');
  const result = git.runGitResult(['branch', '--list'], { cwd: repoRoot });
  if (result.success) {
    const branches = result.stdout
      .split('\n')
      .map(b => b.replace(/\*/g, '').trim())
      .filter(b => b && b !== 'main' && b !== 'master');

    const prefix = config.branchPrefix || 'feature/';
    const orphanedBranches = branches.filter(b => b.startsWith(prefix) && !linkedBranches.has(b));

    if (orphanedBranches.length === 0) {
      logger.info('  No orphaned branches found.');
    } else {
      for (const branch of orphanedBranches) {
        if (options.dryRun) {
          logger.info(`  [DRY RUN] Would delete orphaned branch: ${branch}`);
        } else {
          try {
            git.deleteBranch(branch, { cwd: repoRoot, force: true });
            logger.info(`  Deleted orphaned branch: ${branch}`);
          } catch (e: any) {
            logger.warn(`  Could not delete orphaned branch ${branch}: ${e.message}`);
          }
        }
      }
    }
  }
}

export = clean;

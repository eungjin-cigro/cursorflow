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

interface CleanOptions {
  type?: string;
  pattern: string | null;
  dryRun: boolean;
  force: boolean;
  all: boolean;
  help: boolean;
  keepLatest: boolean;
  includeLatest: boolean;
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
  --dry-run              Show what would be removed without deleting
  --force                Force removal (ignore uncommitted changes)
  --include-latest       Also remove the most recent item (by default, latest is kept)
  --help, -h             Show help
  `);
}

function parseArgs(args: string[]): CleanOptions {
  const includeLatest = args.includes('--include-latest');
  return {
    type: args.find(a => ['branches', 'worktrees', 'logs', 'tasks', 'all'].includes(a)),
    pattern: null,
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
    all: args.includes('--all'),
    help: args.includes('--help') || args.includes('-h'),
    keepLatest: !includeLatest, // Default: keep latest, unless --include-latest is specified
    includeLatest,
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

async function clean(args: string[]): Promise<void> {
  const options = parseArgs(args);
  
  if (options.help) {
    printHelp();
    return;
  }

  const config = loadConfig();
  const repoRoot = git.getRepoRoot();

  logger.section('🧹 Cleaning CursorFlow Resources');

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

async function cleanWorktrees(config: any, repoRoot: string, options: CleanOptions) {
  logger.info('\nChecking worktrees...');
  const worktrees = git.listWorktrees(repoRoot);
  
  const worktreeRoot = path.join(repoRoot, config.worktreeRoot || '_cursorflow/worktrees');
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
      path: path.join(logsDir, entry.name),
      isDir: entry.isDirectory(),
      mtime: getModTime(path.join(logsDir, entry.name))
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
        path: path.join(tasksDir, entry.name),
        isDir: entry.isDirectory(),
        mtime: getModTime(path.join(tasksDir, entry.name))
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
          const itemPath = path.join(tasksDir, entry.name);
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

export = clean;

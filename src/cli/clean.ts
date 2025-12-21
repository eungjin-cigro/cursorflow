/**
 * CursorFlow clean command
 * 
 * Clean up worktrees, branches, and logs created by CursorFlow
 */

import * as fs from 'fs';
import * as path from 'path';
import * as logger from '../utils/logger';
import * as git from '../utils/git';
import { loadConfig, getLogsDir } from '../utils/config';

interface CleanOptions {
  type?: string;
  pattern: string | null;
  dryRun: boolean;
  force: boolean;
  all: boolean;
  help: boolean;
}

function printHelp(): void {
  console.log(`
Usage: cursorflow clean <type> [options]

Clean up resources created by CursorFlow.

Types:
  branches               Remove local feature branches
  worktrees              Remove temporary Git worktrees
  logs                   Clear log directories
  all                    Remove all of the above (default)

Options:
  --dry-run              Show what would be removed without deleting
  --force                Force removal (ignore uncommitted changes)
  --help, -h             Show help
  `);
}

function parseArgs(args: string[]): CleanOptions {
  return {
    type: args.find(a => ['branches', 'worktrees', 'logs', 'all'].includes(a)),
    pattern: null,
    dryRun: args.includes('--dry-run'),
    force: args.includes('--force'),
    all: args.includes('--all'),
    help: args.includes('--help') || args.includes('-h'),
  };
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
  } else if (type === 'worktrees') {
    await cleanWorktrees(config, repoRoot, options);
  } else if (type === 'branches') {
    await cleanBranches(config, repoRoot, options);
  } else if (type === 'logs') {
    await cleanLogs(config, options);
  }

  logger.success('\n✨ Cleaning complete!');
}

async function cleanWorktrees(config: any, repoRoot: string, options: CleanOptions) {
  logger.info('\nChecking worktrees...');
  const worktrees = git.listWorktrees(repoRoot);
  
  const worktreeRoot = path.join(repoRoot, config.worktreeRoot || '_cursorflow/worktrees');
  const toRemove = worktrees.filter(wt => {
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

async function cleanBranches(config: any, repoRoot: string, options: CleanOptions) {
  logger.info('\nChecking branches...');
  
  // List all local branches
  const result = git.runGitResult(['branch', '--list'], { cwd: repoRoot });
  if (!result.success) return;

  const branches = result.stdout
    .split('\n')
    .map(b => b.replace('*', '').trim())
    .filter(b => b && b !== 'main' && b !== 'master');

  const prefix = config.branchPrefix || 'feature/';
  const toDelete = branches.filter(b => b.startsWith(prefix));

  if (toDelete.length === 0) {
    logger.info('  No branches found to clean.');
    return;
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

export = clean;

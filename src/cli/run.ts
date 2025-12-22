/**
 * CursorFlow run command
 */

import * as path from 'path';
import * as fs from 'fs';
import * as logger from '../utils/logger';
import { orchestrate } from '../core/orchestrator';
import { getLogsDir, loadConfig } from '../utils/config';
import { runDoctor, getDoctorStatus } from '../utils/doctor';
import { areCommandsInstalled, setupCommands } from './setup-commands';
import { safeJoin } from '../utils/path';

interface RunOptions {
  tasksDir?: string;
  dryRun: boolean;
  executor: string | null;
  maxConcurrent: number | null;
  skipDoctor: boolean;
  noGit: boolean;
  help: boolean;
}

function printHelp(): void {
  console.log(`
Usage: cursorflow run <tasks-dir> [options]

Run task orchestration based on dependency graph.

Options:
  <tasks-dir>            Directory containing task JSON files
  --max-concurrent <num> Limit parallel agents (overrides config)
  --executor <type>      cursor-agent | cloud
  --skip-doctor          Skip environment checks (not recommended)
  --no-git               Disable Git operations (worktree, push, commit)
  --dry-run              Show execution plan without starting agents
  --help, -h             Show help

Examples:
  cursorflow run _cursorflow/tasks
  cursorflow run _cursorflow/tasks --no-git --skip-doctor
  `);
}

function parseArgs(args: string[]): RunOptions {
  const tasksDir = args.find(a => !a.startsWith('--'));
  const executorIdx = args.indexOf('--executor');
  const maxConcurrentIdx = args.indexOf('--max-concurrent');
  
  return {
    tasksDir,
    dryRun: args.includes('--dry-run'),
    executor: executorIdx >= 0 ? args[executorIdx + 1] || null : null,
    maxConcurrent: maxConcurrentIdx >= 0 ? parseInt(args[maxConcurrentIdx + 1] || '0') || null : null,
    skipDoctor: args.includes('--skip-doctor') || args.includes('--no-doctor'),
    noGit: args.includes('--no-git'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

async function run(args: string[]): Promise<void> {
  const options = parseArgs(args);
  
  if (options.help) {
    printHelp();
    return;
  }

  // Auto-setup Cursor commands if missing or outdated
  if (!areCommandsInstalled()) {
    logger.info('Installing missing or outdated Cursor IDE commands...');
    try {
      setupCommands({ silent: true });
    } catch (e) {
      // Non-blocking
    }
  }

  if (!options.tasksDir) {
    console.log('\nUsage: cursorflow run <tasks-dir> [options]');
    throw new Error('Tasks directory required');
  }
  
  const config = loadConfig();
  const logsDir = getLogsDir(config);

  // Resolve tasks dir:
  // - Prefer the exact path if it exists relative to cwd
  // - Otherwise, fall back to projectRoot-relative path for better ergonomics
  const tasksDir =
    path.isAbsolute(options.tasksDir)
      ? options.tasksDir
      : (fs.existsSync(options.tasksDir)
        ? path.resolve(process.cwd(), options.tasksDir) // nosemgrep
        : safeJoin(config.projectRoot, options.tasksDir));

  if (!fs.existsSync(tasksDir)) {
    throw new Error(`Tasks directory not found: ${tasksDir}`);
  }

  // Check if doctor has been run at least once
  const doctorStatus = getDoctorStatus(config.projectRoot);
  if (!doctorStatus) {
    logger.warn('It looks like you haven\'t run `cursorflow doctor` yet.');
    logger.warn('Running doctor is highly recommended to catch environment issues early.');
    console.log('   Run: cursorflow doctor\n');
  }

  // Preflight checks (doctor)
  if (!options.skipDoctor) {
    const report = runDoctor({
      cwd: process.cwd(),
      tasksDir,
      executor: options.executor || config.executor,
      includeCursorAgentChecks: true,
    });

    if (!report.ok) {
      logger.section('🛑 Pre-flight check failed');
      for (const issue of report.issues) {
        const header = `${issue.title} (${issue.id})`;
        if (issue.severity === 'error') {
          logger.error(header, '❌');
        } else {
          logger.warn(header, '⚠️');
        }
        console.log(`   ${issue.message}`);
        if (issue.details) console.log(`   Details: ${issue.details}`);
        if (issue.fixes?.length) {
          console.log('   Fix:');
          for (const fix of issue.fixes) console.log(`     - ${fix}`);
        }
        console.log('');
      }
      throw new Error('Pre-flight checks failed. Run `cursorflow doctor` for details.');
    }
  }
  
  try {
    await orchestrate(tasksDir, {
      executor: options.executor || config.executor,
      pollInterval: config.pollInterval * 1000,
      runDir: path.join(logsDir, 'runs', `run-${Date.now()}`),
      maxConcurrentLanes: options.maxConcurrent || config.maxConcurrentLanes,
      webhooks: config.webhooks || [],
      enhancedLogging: config.enhancedLogging,
      noGit: options.noGit,
    });
  } catch (error: any) {
    // Re-throw to be handled by the main entry point
    throw new Error(`Orchestration failed: ${error.message}`);
  }
}

export = run;

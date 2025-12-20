/**
 * CursorFlow run command
 */

import * as path from 'path';
import * as fs from 'fs';
import * as logger from '../utils/logger';
import { orchestrate } from '../core/orchestrator';
import { loadConfig } from '../utils/config';

interface RunOptions {
  tasksDir?: string;
  dryRun: boolean;
  executor: string | null;
}

function parseArgs(args: string[]): RunOptions {
  const tasksDir = args.find(a => !a.startsWith('--'));
  const executorIdx = args.indexOf('--executor');
  
  return {
    tasksDir,
    dryRun: args.includes('--dry-run'),
    executor: executorIdx >= 0 ? args[executorIdx + 1] || null : null,
  };
}

async function run(args: string[]): Promise<void> {
  const options = parseArgs(args);
  
  if (!options.tasksDir) {
    console.log('\nUsage: cursorflow run <tasks-dir> [options]');
    throw new Error('Tasks directory required');
  }
  
  if (!fs.existsSync(options.tasksDir)) {
    throw new Error(`Tasks directory not found: ${options.tasksDir}`);
  }
  
  const config = loadConfig();
  
  try {
    await orchestrate(options.tasksDir, {
      executor: options.executor || config.executor,
      pollInterval: config.pollInterval * 1000,
      runDir: path.join(config.logsDir, 'runs', `run-${Date.now()}`),
    });
  } catch (error: any) {
    // Re-throw to be handled by the main entry point
    throw new Error(`Orchestration failed: ${error.message}`);
  }
}

export = run;

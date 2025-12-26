/**
 * Core Runner - Execute tasks sequentially in a lane
 * 
 * This file is now a wrapper around modular components in ./runner/
 */

import * as fs from 'fs';
import * as path from 'path';

import * as logger from '../utils/logger';
import { loadConfig } from '../utils/config';
import { registerWebhooks } from '../utils/webhook';
import { events } from '../utils/events';
import { RunnerConfig } from '../types';

// Re-export everything from modular components
export * from './runner/index';

// Import necessary parts for the CLI entry point
import { runTasks } from './runner/pipeline';
import { cleanupAgentChildren } from './runner/agent';

/**
 * CLI entry point
 */
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.error('Usage: node runner.js <tasks-file> --run-dir <dir> --executor <executor>');
    process.exit(1);
  }
  
  const tasksFile = args[0]!;
  const runDirIdx = args.indexOf('--run-dir');
  const startIdxIdx = args.indexOf('--start-index');
  const pipelineBranchIdx = args.indexOf('--pipeline-branch');
  const worktreeDirIdx = args.indexOf('--worktree-dir');
  
  const runDir = runDirIdx >= 0 ? args[runDirIdx + 1]! : '.';
  const startIndex = startIdxIdx >= 0 ? parseInt(args[startIdxIdx + 1] || '0') : 0;
  const forcedPipelineBranch = pipelineBranchIdx >= 0 ? args[pipelineBranchIdx + 1] : null;
  const forcedWorktreeDir = worktreeDirIdx >= 0 ? args[worktreeDirIdx + 1] : null;

  // Extract runId from runDir (format: .../runs/run-123/lanes/lane-name)
  const parts = runDir.split(path.sep);
  const runsIdx = parts.lastIndexOf('runs');
  const runId = runsIdx >= 0 && parts[runsIdx + 1] ? parts[runsIdx + 1]! : `run-${Date.now()}`;
  
  events.setRunId(runId);

  // Load global config for defaults and webhooks
  let globalConfig;
  try {
    globalConfig = loadConfig();
    if (globalConfig.webhooks) {
      registerWebhooks(globalConfig.webhooks);
    }
  } catch (e) {
    // Non-blocking
  }
  
  if (!fs.existsSync(tasksFile)) {
    console.error(`Tasks file not found: ${tasksFile}`);
    process.exit(1);
  }
  
  // Load tasks configuration
  let config: RunnerConfig;
  try {
    config = JSON.parse(fs.readFileSync(tasksFile, 'utf8')) as RunnerConfig;
    if (forcedPipelineBranch) {
      config.pipelineBranch = forcedPipelineBranch;
    }
    if (forcedWorktreeDir) {
      config.worktreeDir = forcedWorktreeDir;
    }
  } catch (error: any) {
    console.error(`Failed to load tasks file: ${error.message}`);
    process.exit(1);
  }
  
  // Add defaults from global config or hardcoded
  config.dependencyPolicy = config.dependencyPolicy || {
    allowDependencyChange: globalConfig?.allowDependencyChange ?? false,
    lockfileReadOnly: globalConfig?.lockfileReadOnly ?? true,
  };
  
  // Add agent output format default
  config.agentOutputFormat = config.agentOutputFormat || globalConfig?.agentOutputFormat || 'json';
  
  // Merge intervention and logging settings
  config.enableIntervention = config.enableIntervention ?? globalConfig?.enableIntervention ?? true;
  config.verboseGit = config.verboseGit ?? globalConfig?.verboseGit ?? false;
  
  // Handle process interruption to ensure cleanup
  const handleSignal = (signal: string) => {
    logger.warn(`\n⚠️ Runner received ${signal}. Shutting down...`);
    // Cleanup any active agent child processes
    cleanupAgentChildren();
    process.exit(1);
  };

  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));

  // Run tasks
  runTasks(tasksFile, config, runDir, { startIndex })
    .then(() => {
      process.exit(0);
    })
    .catch(error => {
      console.error(`Runner failed: ${error.message}`);
      if (process.env['DEBUG']) {
        console.error(error.stack);
      }
      process.exit(1);
    });
}

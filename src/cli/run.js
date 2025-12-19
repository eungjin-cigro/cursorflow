#!/usr/bin/env node
/**
 * CursorFlow run command
 */

const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');
const { orchestrate } = require('../core/orchestrator');
const { loadConfig } = require('../utils/config');

function parseArgs(args) {
  return {
    tasksDir: args.find(a => !a.startsWith('--')),
    dryRun: args.includes('--dry-run'),
    executor: args[args.indexOf('--executor') + 1] || null,
  };
}

async function run(args) {
  const options = parseArgs(args);
  
  if (!options.tasksDir) {
    logger.error('Tasks directory required');
    console.log('\nUsage: cursorflow run <tasks-dir> [options]');
    process.exit(1);
  }
  
  if (!fs.existsSync(options.tasksDir)) {
    logger.error(`Tasks directory not found: ${options.tasksDir}`);
    process.exit(1);
  }
  
  const config = loadConfig();
  
  try {
    await orchestrate(options.tasksDir, {
      executor: options.executor || config.executor,
      pollInterval: config.pollInterval * 1000,
      runDir: path.join(config.logsDir, 'runs', `run-${Date.now()}`),
    });
  } catch (error) {
    logger.error(`Orchestration failed: ${error.message}`);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

module.exports = run;

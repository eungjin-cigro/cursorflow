#!/usr/bin/env node
/**
 * CursorFlow CLI - Main entry point
 */

const logger = require('../utils/logger');

const COMMANDS = {
  init: require('./init'),
  run: require('./run'),
  monitor: require('./monitor'),
  clean: require('./clean'),
  resume: require('./resume'),
};

function printHelp() {
  console.log(`
CursorFlow - Git worktree-based parallel AI agent orchestration

Usage: cursorflow <command> [options]

Commands:
  init [options]              Initialize CursorFlow in project
  run <tasks-dir> [options]   Run orchestration
  monitor [run-dir] [options] Monitor lane execution
  clean <type> [options]      Clean branches/worktrees/logs
  resume <lane> [options]     Resume interrupted lane

Global Options:
  --config <path>             Config file path
  --help, -h                  Show help
  --version, -v               Show version

Examples:
  cursorflow init --example
  cursorflow run _cursorflow/tasks/MyFeature/
  cursorflow monitor --watch
  cursorflow clean branches --all

Documentation:
  https://github.com/eungjin-cigro/cursorflow#readme
  `);
}

function printVersion() {
  const pkg = require('../../package.json');
  console.log(`CursorFlow v${pkg.version}`);
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }
  
  if (args.includes('--version') || args.includes('-v')) {
    printVersion();
    process.exit(0);
  }
  
  const command = args[0];
  const commandArgs = args.slice(1);
  
  if (!COMMANDS[command]) {
    logger.error(`Unknown command: ${command}`);
    console.log('\nRun "cursorflow --help" for usage information.');
    process.exit(1);
  }
  
  try {
    await COMMANDS[command](commandArgs);
  } catch (error) {
    logger.error(error.message);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(error => {
    logger.error(`Fatal error: ${error.message}`);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  });
}

module.exports = main;

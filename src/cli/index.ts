/**
 * CursorFlow CLI - Main entry point
 */

import * as logger from '../utils/logger';

// Command functions signature
type CommandFn = (args: string[]) => Promise<void>;

// Lazy load commands to speed up help/version output
const COMMANDS: Record<string, CommandFn> = {
  init: require('./init'),
  run: require('./run'),
  monitor: require('./monitor'),
  clean: require('./clean'),
  resume: require('./resume'),
  doctor: require('./doctor'),
  signal: require('./signal'),
};

function printHelp(): void {
  console.log(`
CursorFlow - Git worktree-based parallel AI agent orchestration

Usage: cursorflow <command> [options]

Commands:
  init [options]              Initialize CursorFlow in project
  run <tasks-dir> [options]   Run orchestration
  monitor [run-dir] [options] Monitor lane execution
  clean <type> [options]      Clean branches/worktrees/logs
  resume <lane> [options]     Resume interrupted lane
  doctor [options]            Check environment and preflight
  signal <lane> <msg>         Directly intervene in a running lane

Global Options:
  --config <path>             Config file path
  --help, -h                  Show help
  --version, -v               Show version

Examples:
  cursorflow init --example
  cursorflow run _cursorflow/tasks/MyFeature/
  cursorflow monitor --watch
  cursorflow clean branches --all
  cursorflow doctor

Documentation:
  https://github.com/eungjin-cigro/cursorflow#readme
  `);
}

function printVersion(): void {
  const pkg = require('../../package.json');
  console.log(`CursorFlow v${pkg.version}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }
  
  if (args.includes('--version') || args.includes('-v')) {
    printVersion();
    return;
  }
  
  const commandName = args[0]!;
  const commandArgs = args.slice(1);
  
  const command = COMMANDS[commandName];
  
  if (!command) {
    logger.error(`Unknown command: ${commandName}`);
    console.log('\nRun "cursorflow --help" for usage information.');
    process.exit(1);
  }
  
  try {
    await command(commandArgs);
  } catch (error: any) {
    logger.error(error.message);
    if (process.env['DEBUG']) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(error => {
    logger.error(`Fatal error: ${error.message}`);
    if (process.env['DEBUG']) {
      console.error(error.stack);
    }
    process.exit(1);
  });
}

export default main;
export { main };

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
\x1b[1m\x1b[36mCursorFlow\x1b[0m - Git worktree-based parallel AI agent orchestration

\x1b[1mUSAGE\x1b[0m
  $ \x1b[32mcursorflow\x1b[0m <command> [options]

\x1b[1mCOMMANDS\x1b[0m
  \x1b[33minit\x1b[0m [options]              Initialize CursorFlow in project
  \x1b[33mrun\x1b[0m <tasks-dir> [options]   Run orchestration (DAG-based)
  \x1b[33mmonitor\x1b[0m [run-dir] [options] \x1b[36mInteractive\x1b[0m lane dashboard
  \x1b[33mclean\x1b[0m <type> [options]      Clean branches/worktrees/logs
  \x1b[33mresume\x1b[0m <lane> [options]     Resume interrupted lane
  \x1b[33mdoctor\x1b[0m [options]            Check environment and preflight
  \x1b[33msignal\x1b[0m <lane> <msg>         Directly intervene in a running lane

\x1b[1mGLOBAL OPTIONS\x1b[0m
  --config <path>             Config file path
  --help, -h                  Show help
  --version, -v               Show version

\x1b[1mEXAMPLES\x1b[0m
  $ \x1b[32mcursorflow init --example\x1b[0m
  $ \x1b[32mcursorflow run _cursorflow/tasks/MyFeature/\x1b[0m
  $ \x1b[32mcursorflow monitor latest\x1b[0m
  $ \x1b[32mcursorflow signal lane-1 "Please use pnpm instead of npm"\x1b[0m

\x1b[1mDOCUMENTATION\x1b[0m
  https://github.com/eungjin-cigro/cursorflow#readme
  `);
}

function printVersion(): void {
  const pkg = require('../../package.json');
  console.log(`\x1b[1m\x1b[36mCursorFlow\x1b[0m v${pkg.version}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args.includes('--help') || args.includes('-h') || args[0] === 'help') {
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

/**
 * CursorFlow CLI - Main entry point
 */

import * as logger from '../utils/logger';

// Command functions signature
type CommandFn = (args: string[]) => Promise<void>;

/**
 * Command Registry
 */
const COMMANDS: Record<string, CommandFn> = {
  init: require('./init'),
  prepare: require('./prepare'),
  run: require('./run'),
  monitor: require('./monitor'),
  clean: require('./clean'),
  resume: require('./resume'),
  doctor: require('./doctor'),
  signal: require('./signal'),
  models: require('./models'),
  logs: require('./logs'),
  runs: require('./runs'),
  tasks: require('./tasks'),
  stop: require('./stop'),
  setup: require('./setup-commands').main,
  'setup-commands': require('./setup-commands').main,
};

function printHelp(): void {
  console.log(`
\x1b[1m\x1b[36mCursorFlow\x1b[0m - Git worktree-based parallel AI agent orchestration

\x1b[1mUSAGE\x1b[0m
  $ \x1b[32mcursorflow\x1b[0m <command> [options]

\x1b[1mCOMMANDS\x1b[0m
  \x1b[33minit\x1b[0m [options]              Initialize CursorFlow in project
  \x1b[33msetup\x1b[0m [options]             Install Cursor IDE commands
  \x1b[33mprepare\x1b[0m <feature> [opts]    Prepare task directory and JSON files
  \x1b[33mrun\x1b[0m <tasks-dir> [options]   Run orchestration (DAG-based)
  \x1b[33mmonitor\x1b[0m [run-dir] [options] \x1b[36mInteractive\x1b[0m lane dashboard
  \x1b[33mtasks\x1b[0m [name] [options]      Browse and validate prepared tasks
  \x1b[33mruns\x1b[0m [run-id] [options]     List and view run details
  \x1b[33mstop\x1b[0m [run-id] [options]     Stop running workflows
  \x1b[33mclean\x1b[0m <type> [options]      Clean branches/worktrees/logs/tasks
  \x1b[33mresume\x1b[0m [lane] [options]     Resume lane(s) - use --all for batch resume
  \x1b[33mdoctor\x1b[0m [options]            Check environment and preflight
  \x1b[33msignal\x1b[0m <lane> <msg>         Directly intervene in a running lane
  \x1b[33mmodels\x1b[0m [options]            List available AI models
  \x1b[33mlogs\x1b[0m [run-dir] [options]    View, export, and follow logs

\x1b[1mGLOBAL OPTIONS\x1b[0m
  --config <path>             Config file path
  --help, -h                  Show help
  --version, -v               Show version

\x1b[1mEXAMPLES\x1b[0m
  $ \x1b[32mcursorflow init --example\x1b[0m
  $ \x1b[32mcursorflow prepare NewFeature --lanes 3\x1b[0m
  $ \x1b[32mcursorflow run _cursorflow/tasks/MyFeature/\x1b[0m
  $ \x1b[32mcursorflow monitor latest\x1b[0m
  $ \x1b[32mcursorflow logs --all --follow\x1b[0m
  $ \x1b[32mcursorflow runs --running\x1b[0m
  $ \x1b[32mcursorflow resume --all\x1b[0m
  $ \x1b[32mcursorflow doctor\x1b[0m
  $ \x1b[32mcursorflow models\x1b[0m

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
  
  // Only show global help if no arguments provided or if first argument is help-related
  const isGlobalHelp = args.length === 0 || args[0] === 'help' || (args.length === 1 && (args[0] === '--help' || args[0] === '-h'));
  
  if (isGlobalHelp) {
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
export { events } from '../utils/events';

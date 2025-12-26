/**
 * CursorFlow CLI - Main entry point
 */

// Suppress MaxListenersExceededWarning for child processes
process.setMaxListeners(0);

import * as logger from '../utils/logger';

// Command functions signature
type CommandFn = (args: string[]) => Promise<void>;

/**
 * Command Registry
 */
const COMMANDS: Record<string, CommandFn> = {
  init: require('./init'),
  // New Flow architecture commands
  new: require('./new'),
  add: require('./add'),
  config: require('./config'),
  // Legacy prepare command (deprecated)
  prepare: require('./prepare'),
  run: require('./run'),
  monitor: require('./monitor'),
  clean: require('./clean'),
  resume: require('./resume'),
  doctor: require('./doctor'),
  signal: require('./signal'),
  models: require('./models'),
  logs: require('./logs'),
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

\x1b[1mFLOW COMMANDS (New)\x1b[0m
  \x1b[33mnew\x1b[0m <flow> --lanes "..."     Create a new Flow with Lanes
  \x1b[33madd\x1b[0m <flow> <lane> --task    Add Tasks to a Lane
  \x1b[33mconfig\x1b[0m [key] [value]        View or set config (e.g., defaultModel)

\x1b[1mEXECUTION\x1b[0m
  \x1b[33mrun\x1b[0m <flow> [options]         Run orchestration (DAG-based)
  \x1b[33mmonitor\x1b[0m [run-dir] [options]  \x1b[36mInteractive\x1b[0m lane dashboard
  \x1b[33mstop\x1b[0m [run-id] [options]      Stop running workflows
  \x1b[33mresume\x1b[0m [lane] [options]      Resume lane(s)

\x1b[1mINSPECTION\x1b[0m
  \x1b[33mtasks\x1b[0m [name] [options]       Browse and validate prepared tasks
  \x1b[33mlogs\x1b[0m [run-dir] [options]     View, export, and follow logs
  \x1b[33mdoctor\x1b[0m [options]             Check environment and preflight

\x1b[1mUTILITY\x1b[0m
  \x1b[33minit\x1b[0m [options]               Initialize CursorFlow in project
  \x1b[33msetup\x1b[0m [options]              Install Cursor IDE commands
  \x1b[33mclean\x1b[0m <type> [options]       Clean branches/worktrees/logs/tasks
  \x1b[33msignal\x1b[0m <lane> <msg>          Directly intervene in a running lane
  \x1b[33mmodels\x1b[0m [options]             List available AI models

\x1b[1mLEGACY\x1b[0m
  \x1b[33mprepare\x1b[0m <feature> [opts]     (deprecated) Use 'new' + 'add' instead

\x1b[1mQUICK START\x1b[0m
  $ \x1b[32mcursorflow new MyFeature --lanes "backend,frontend"\x1b[0m
  $ \x1b[32mcursorflow add MyFeature backend --task "name=impl|model=sonnet-4.5|prompt=API 구현"\x1b[0m
  $ \x1b[32mcursorflow add MyFeature frontend --task "name=ui|model=sonnet-4.5|prompt=UI 구현" --after "backend"\x1b[0m
  $ \x1b[32mcursorflow run MyFeature\x1b[0m

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

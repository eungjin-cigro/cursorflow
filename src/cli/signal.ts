/**
 * CursorFlow signal command
 * 
 * Send a direct message to a running lane
 */

import * as path from 'path';
import * as fs from 'fs';
import * as logger from '../utils/logger';
import { loadConfig, getLogsDir } from '../utils/config';
import { appendLog, createConversationEntry } from '../utils/state';

interface SignalOptions {
  lane: string | null;
  message: string | null;
  runDir: string | null;
  help: boolean;
}

function printHelp(): void {
  console.log(`
Usage: cursorflow signal <lane> "<message>" [options]

Directly intervene in a running lane by sending a message to the agent.

Options:
  <lane>                 Lane name to signal
  "<message>"            Message text to send
  --run-dir <path>       Use a specific run directory (default: latest)
  --help, -h             Show help
  `);
}

function parseArgs(args: string[]): SignalOptions {
  const runDirIdx = args.indexOf('--run-dir');
  
  // First non-option is lane, second (or rest joined) is message
  const nonOptions = args.filter(a => !a.startsWith('--'));
  
  return {
    lane: nonOptions[0] || null,
    message: nonOptions.slice(1).join(' ') || null,
    runDir: runDirIdx >= 0 ? args[runDirIdx + 1] || null : null,
    help: args.includes('--help') || args.includes('-h'),
  };
}

function findLatestRunDir(logsDir: string): string | null {
  const runsDir = path.join(logsDir, 'runs');
  if (!fs.existsSync(runsDir)) return null;
  
  const runs = fs.readdirSync(runsDir)
    .filter(d => d.startsWith('run-'))
    .sort()
    .reverse();
    
  return runs.length > 0 ? path.join(runsDir, runs[0]!) : null;
}

async function signal(args: string[]): Promise<void> {
  const options = parseArgs(args);
  
  if (options.help) {
    printHelp();
    return;
  }

  const config = loadConfig();
  const logsDir = getLogsDir(config);
  
  if (!options.lane) {
    throw new Error('Lane name required: cursorflow signal <lane> "<message>"');
  }
  
  if (!options.message) {
    throw new Error('Message required: cursorflow signal <lane> "<message>"');
  }
  
  let runDir = options.runDir;
  if (!runDir) {
    runDir = findLatestRunDir(logsDir);
  }
  
  if (!runDir || !fs.existsSync(runDir)) {
    throw new Error(`Run directory not found: ${runDir || 'latest'}`);
  }
  
  const convoPath = path.join(runDir, 'lanes', options.lane, 'conversation.jsonl');
  
  if (!fs.existsSync(convoPath)) {
    throw new Error(`Conversation log not found at ${convoPath}. Is the lane running?`);
  }
  
  logger.info(`Sending signal to lane: ${options.lane}`);
  logger.info(`Message: "${options.message}"`);
  
  // Append as a "commander" role message
  // Note: We cast to 'system' or similar if 'commander' isn't in the enum, 
  // but let's use 'reviewer' or 'system' which agents usually respect, 
  // or update the type definition.
  const entry = createConversationEntry('system', `[COMMANDER INTERVENTION]\n${options.message}`, {
    task: 'DIRECT_SIGNAL'
  });
  
  appendLog(convoPath, entry);
  
  logger.success('Signal sent successfully. The agent will see this message in its next turn or via file monitoring.');
}

export = signal;


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
import { safeJoin } from '../utils/path';

interface SignalOptions {
  lane: string | null;
  message: string | null;
  timeout: number | null; // New timeout in milliseconds
  runDir: string | null;
  help: boolean;
}

function printHelp(): void {
  console.log(`
Usage: cursorflow signal <lane> "<message>" [options]
       cursorflow signal <lane> --timeout <ms>

Directly intervene in a running lane.

Options:
  <lane>                 Lane name to signal
  "<message>"            Message text to send to the agent
  --timeout <ms>         Update execution timeout (in milliseconds)
  --run-dir <path>       Use a specific run directory (default: latest)
  --help, -h             Show help
  `);
}

function parseArgs(args: string[]): SignalOptions {
  const runDirIdx = args.indexOf('--run-dir');
  const timeoutIdx = args.indexOf('--timeout');
  
  // First non-option is lane, second (or rest joined) is message
  const nonOptions = args.filter(a => !a.startsWith('--'));
  
  return {
    lane: nonOptions[0] || null,
    message: nonOptions.slice(1).join(' ') || null,
    timeout: timeoutIdx >= 0 ? parseInt(args[timeoutIdx + 1] || '0') || null : null,
    runDir: runDirIdx >= 0 ? args[runDirIdx + 1] || null : null,
    help: args.includes('--help') || args.includes('-h'),
  };
}

function findLatestRunDir(logsDir: string): string | null {
  const runsDir = safeJoin(logsDir, 'runs');
  if (!fs.existsSync(runsDir)) return null;
  
  const runs = fs.readdirSync(runsDir)
    .filter(d => d.startsWith('run-'))
    .sort()
    .reverse();
    
  return runs.length > 0 ? safeJoin(runsDir, runs[0]!) : null;
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
    throw new Error('Lane name required: cursorflow signal <lane> ...');
  }
  
  let runDir = options.runDir;
  if (!runDir) {
    runDir = findLatestRunDir(logsDir);
  }
  
  if (!runDir || !fs.existsSync(runDir)) {
    throw new Error(`Run directory not found: ${runDir || 'latest'}`);
  }

  const laneDir = safeJoin(runDir, 'lanes', options.lane);
  if (!fs.existsSync(laneDir)) {
    throw new Error(`Lane directory not found: ${laneDir}`);
  }

  // Case 1: Timeout update
  if (options.timeout !== null) {
    const timeoutPath = safeJoin(laneDir, 'timeout.txt');
    fs.writeFileSync(timeoutPath, String(options.timeout));
    logger.success(`Timeout update signal sent to ${options.lane}: ${options.timeout}ms`);
    return;
  }

  // Case 2: Intervention message
  if (options.message) {
    const interventionPath = safeJoin(laneDir, 'intervention.txt');
    const convoPath = safeJoin(laneDir, 'conversation.jsonl');
    
    logger.info(`Sending signal to lane: ${options.lane}`);
    logger.info(`Message: "${options.message}"`);
    
    // 1. Write to intervention.txt for live agents to pick up immediately via stdin
    fs.writeFileSync(interventionPath, options.message);
    
    // 2. Also append to conversation log for visibility and history
    const entry = createConversationEntry('intervention', `[HUMAN INTERVENTION]: ${options.message}`, {
      task: 'DIRECT_SIGNAL'
    });
    appendLog(convoPath, entry);
    
    logger.success('Signal sent successfully. The agent will see this message in its current turn or next step.');
    return;
  }

  throw new Error('Either a message or --timeout is required.');
}

export = signal;


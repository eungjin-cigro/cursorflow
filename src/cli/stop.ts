/**
 * CursorFlow stop command - Stop running workflows or specific lanes
 */

import * as readline from 'readline';
import * as logger from '../utils/logger';
import { loadConfig, getLogsDir } from '../utils/config';
import { RunService } from '../utils/run-service';
import { ProcessManager } from '../utils/process-manager';
import { safeJoin } from '../utils/path';

interface StopOptions {
  runId?: string;
  lane?: string;
  force: boolean;
  yes: boolean;
  help: boolean;
}

function printHelp(): void {
  console.log(`
Usage: cursorflow stop [run-id] [options]

Stop running workflows or specific lanes.

Options:
  [run-id]               Stop a specific run
  --lane <name>          Stop only a specific lane
  --force                Use SIGKILL instead of SIGTERM
  --yes, -y              Skip confirmation prompt
  --help, -h             Show help

Examples:
  cursorflow stop              # Stop all running workflows
  cursorflow stop run-123      # Stop run-123
  cursorflow stop --lane api   # Stop only the 'api' lane in the latest run
  cursorflow stop --force      # Force stop all workflows
  `);
}

function parseArgs(args: string[]): StopOptions {
  const laneIdx = args.indexOf('--lane');
  
  // Find run ID (first non-option argument)
  const runId = args.find((arg, i) => {
    if (arg.startsWith('--') || arg.startsWith('-')) return false;
    // Skip values for options
    const prevArg = args[i - 1];
    if (prevArg && ['--lane'].includes(prevArg)) {
      return false;
    }
    return true;
  });

  return {
    runId,
    lane: laneIdx >= 0 ? args[laneIdx + 1] : undefined,
    force: args.includes('--force'),
    yes: args.includes('--yes') || args.includes('-y'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

/**
 * Prompt user for confirmation
 */
async function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} [y/N]: `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

async function stop(args: string[]): Promise<void> {
  const options = parseArgs(args);
  
  if (options.help) {
    printHelp();
    return;
  }
  
  const config = loadConfig();
  const logsDir = getLogsDir(config);
  const runsDir = safeJoin(logsDir, 'runs');
  const runService = new RunService(runsDir);
  
  const signal = options.force ? 'SIGKILL' : 'SIGTERM';
  
  // Case 1: Stop specific lane in specific run (or latest if runId not provided)
  if (options.lane) {
    let runId = options.runId;
    if (!runId) {
      const activeRuns = runService.getActiveRuns();
      if (activeRuns.length === 0) {
        logger.info('No active runs found.');
        return;
      }
      runId = activeRuns[0]!.id;
    }
    
    const run = runService.getRunInfo(runId);
    if (!run) {
      throw new Error(`Run not found: ${runId}`);
    }
    
    const lane = run.lanes.find(l => l.name === options.lane);
    if (!lane) {
      throw new Error(`Lane '${options.lane}' not found in run '${runId}'`);
    }
    
    if (!lane.pid) {
      logger.info(`Lane '${options.lane}' is not currently running (no PID).`);
      return;
    }
    
    if (!options.yes) {
      const ok = await confirm(`⚠️  Stop lane '${options.lane}' in run '${runId}'?`);
      if (!ok) return;
    }
    
    logger.info(`🛑 Stopping lane '${options.lane}' (PID ${lane.pid})...`);
    if (ProcessManager.killProcess(lane.pid, signal)) {
      logger.success(`✓ lane '${options.lane}' stopped.`);
    } else {
      logger.error(`Failed to stop lane '${options.lane}'.`);
    }
    return;
  }
  
  // Case 2: Stop specific run
  if (options.runId) {
    const run = runService.getRunInfo(options.runId);
    if (!run) {
      throw new Error(`Run not found: ${options.runId}`);
    }
    
    if (run.status !== 'running') {
      logger.info(`Run '${options.runId}' is not currently running (Status: ${run.status}).`);
      return;
    }
    
    if (!options.yes) {
      const ok = await confirm(`⚠️  Stop run '${options.runId}' (${run.taskName})?`);
      if (!ok) return;
    }
    
    logger.info(`🛑 Stopping run '${options.runId}'...`);
    let stoppedCount = 0;
    for (const lane of run.lanes) {
      if (lane.pid && ProcessManager.killProcess(lane.pid, signal)) {
        logger.info(`  ✓ lane '${lane.name}' (PID ${lane.pid}) stopped`);
        stoppedCount++;
      }
    }
    
    if (stoppedCount > 0) {
      logger.success(`✅ Run '${options.runId}' stopped.`);
    } else {
      logger.info('No active lanes were stopped.');
    }
    return;
  }
  
  // Case 3: Stop all running workflows
  const activeRuns = runService.getActiveRuns();
  if (activeRuns.length === 0) {
    logger.info('No active runs found.');
    return;
  }
  
  if (!options.yes) {
    console.log('\n⚠️  Stop all running workflows?\n');
    console.log('Currently running:');
    for (const run of activeRuns) {
      const activeLanes = run.lanes.filter(l => l.pid).length;
      console.log(`  - ${run.id} (${run.taskName}): ${activeLanes} lanes active`);
    }
    console.log('');
    
    const ok = await confirm('Continue?');
    if (!ok) return;
  }
  
  logger.info('🛑 Stopping all workflows...');
  let totalStopped = 0;
  for (const run of activeRuns) {
    for (const lane of run.lanes) {
      if (lane.pid && ProcessManager.killProcess(lane.pid, signal)) {
        logger.info(`  ✓ lane '${lane.name}' (PID ${lane.pid}) stopped`);
        totalStopped++;
      }
    }
  }
  
  if (totalStopped > 0) {
    logger.success(`\n✅ All workflows stopped (${totalStopped} lanes).`);
  } else {
    logger.info('\nNo active lanes were stopped.');
  }
}

export = stop;

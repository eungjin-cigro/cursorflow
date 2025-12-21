/**
 * CursorFlow resume command
 */

import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import * as logger from '../utils/logger';
import { loadConfig, getLogsDir } from '../utils/config';
import { loadState } from '../utils/state';
import { LaneState } from '../utils/types';
import { runDoctor } from '../utils/doctor';

interface ResumeOptions {
  lane: string | null;
  runDir: string | null;
  clean: boolean;
  restart: boolean;
  skipDoctor: boolean;
  help: boolean;
}

function printHelp(): void {
  console.log(`
Usage: cursorflow resume <lane> [options]

Resume an interrupted or failed lane.

Options:
  <lane>                 Lane name to resume
  --run-dir <path>       Use a specific run directory (default: latest)
  --clean                Clean up existing worktree before resuming
  --restart              Restart from the first task (index 0)
  --skip-doctor          Skip environment/branch checks (not recommended)
  --help, -h             Show help
  `);
}

function parseArgs(args: string[]): ResumeOptions {
  const runDirIdx = args.indexOf('--run-dir');
  
  return {
    lane: args.find(a => !a.startsWith('--')) || null,
    runDir: runDirIdx >= 0 ? args[runDirIdx + 1] || null : null,
    clean: args.includes('--clean'),
    restart: args.includes('--restart'),
    skipDoctor: args.includes('--skip-doctor') || args.includes('--no-doctor'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

/**
 * Find the latest run directory
 */
function findLatestRunDir(logsDir: string): string | null {
  const runsDir = path.join(logsDir, 'runs');
  if (!fs.existsSync(runsDir)) return null;
  
  const runs = fs.readdirSync(runsDir)
    .filter(d => d.startsWith('run-'))
    .sort()
    .reverse();
    
  return runs.length > 0 ? path.join(runsDir, runs[0]!) : null;
}

async function resume(args: string[]): Promise<void> {
  const options = parseArgs(args);
  
  if (options.help) {
    printHelp();
    return;
  }

  const config = loadConfig();
  const logsDir = getLogsDir(config);
  
  if (!options.lane) {
    throw new Error('Lane name required (e.g., cursorflow resume lane-1)');
  }
  
  let runDir = options.runDir;
  if (!runDir) {
    runDir = findLatestRunDir(logsDir);
  }
  
  if (!runDir || !fs.existsSync(runDir)) {
    throw new Error(`Run directory not found: ${runDir || 'latest'}`);
  }
  
  const laneDir = path.join(runDir, 'lanes', options.lane);
  const statePath = path.join(laneDir, 'state.json');
  
  if (!fs.existsSync(statePath)) {
    throw new Error(`Lane state not found at ${statePath}. Is the lane name correct?`);
  }
  
  const state = loadState<LaneState>(statePath);
  if (!state) {
    throw new Error(`Failed to load state from ${statePath}`);
  }
  
  if (!state.tasksFile || !fs.existsSync(state.tasksFile)) {
    throw new Error(`Original tasks file not found: ${state.tasksFile}. Resume impossible without task definition.`);
  }
  
  // Run doctor check before resuming (check branches, etc.)
  if (!options.skipDoctor) {
    const tasksDir = path.dirname(state.tasksFile);
    logger.info('Running pre-flight checks...');
    
    const report = runDoctor({
      cwd: process.cwd(),
      tasksDir,
      includeCursorAgentChecks: false, // Skip agent checks for resume
    });
    
    // Only show blocking errors for resume
    const blockingIssues = report.issues.filter(i => 
      i.severity === 'error' && 
      (i.id.startsWith('branch.') || i.id.startsWith('git.'))
    );
    
    if (blockingIssues.length > 0) {
      logger.section('🛑 Pre-resume check found issues');
      for (const issue of blockingIssues) {
        logger.error(`${issue.title} (${issue.id})`, '❌');
        console.log(`   ${issue.message}`);
        if (issue.details) console.log(`   Details: ${issue.details}`);
        if (issue.fixes?.length) {
          console.log('   Fix:');
          for (const fix of issue.fixes) console.log(`     - ${fix}`);
        }
        console.log('');
      }
      throw new Error('Pre-resume checks failed. Use --skip-doctor to bypass (not recommended).');
    }
    
    // Show warnings but don't block
    const warnings = report.issues.filter(i => i.severity === 'warn' && i.id.startsWith('branch.'));
    if (warnings.length > 0) {
      logger.warn(`${warnings.length} warning(s) found. Run 'cursorflow doctor' for details.`);
    }
  }
  
  logger.section(`🔁 Resuming Lane: ${options.lane}`);
  logger.info(`Run: ${path.basename(runDir)}`);
  logger.info(`Tasks: ${state.tasksFile}`);
  logger.info(`Starting from task index: ${options.restart ? 0 : state.currentTaskIndex}`);
  
  const runnerPath = require.resolve('../core/runner');
  const runnerArgs = [
    runnerPath,
    state.tasksFile,
    '--run-dir', laneDir,
    '--start-index', options.restart ? '0' : String(state.currentTaskIndex),
  ];
  
  logger.info(`Spawning runner process...`);
  
  const child = spawn('node', runnerArgs, {
    stdio: 'inherit',
    env: process.env,
  });
  
  return new Promise((resolve, reject) => {
    child.on('exit', (code) => {
      if (code === 0) {
        logger.success(`Lane ${options.lane} completed successfully`);
        resolve();
      } else if (code === 2) {
        logger.warn(`Lane ${options.lane} blocked on dependency change`);
        resolve();
      } else {
        reject(new Error(`Lane ${options.lane} failed with exit code ${code}`));
      }
    });
    
    child.on('error', (error) => {
      reject(new Error(`Failed to start runner: ${error.message}`));
    });
  });
}

export = resume;

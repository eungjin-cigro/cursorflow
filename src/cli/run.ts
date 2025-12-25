/**
 * CursorFlow run command
 */

import * as path from 'path';
import * as fs from 'fs';
import * as logger from '../utils/logger';
import { orchestrate } from '../core/orchestrator';
import { getLogsDir, loadConfig } from '../utils/config';
import { runDoctor, getDoctorStatus } from '../utils/doctor';
import { areCommandsInstalled, setupCommands } from './setup-commands';
import { safeJoin } from '../utils/path';
import { findFlowDir } from '../utils/flow';
import { loadState } from '../utils/state';
import { LaneState } from '../types';

interface IncompleteLaneInfo {
  name: string;
  status: string;
  taskIndex: number;
  totalTasks: number;
  error?: string;
}

interface ExistingRunInfo {
  runDir: string;
  runId: string;
  incompleteLanes: IncompleteLaneInfo[];
  completedLanes: string[];
  totalLanes: number;
}

/**
 * Find existing run for a tasks directory
 */
function findExistingRunForTasks(logsDir: string, tasksDir: string): ExistingRunInfo | null {
  const runsDir = safeJoin(logsDir, 'runs');
  if (!fs.existsSync(runsDir)) return null;
  
  const runs = fs.readdirSync(runsDir)
    .filter(d => d.startsWith('run-'))
    .sort()
    .reverse(); // Latest first
  
  for (const runId of runs) {
    const runDir = safeJoin(runsDir, runId);
    const lanesDir = safeJoin(runDir, 'lanes');
    
    if (!fs.existsSync(lanesDir)) continue;
    
    const laneDirs = fs.readdirSync(lanesDir)
      .filter(f => fs.statSync(safeJoin(lanesDir, f)).isDirectory());
    
    if (laneDirs.length === 0) continue;
    
    // Check if any lane belongs to this tasks directory
    let matchesTasksDir = false;
    const incompleteLanes: IncompleteLaneInfo[] = [];
    const completedLanes: string[] = [];
    
    for (const laneName of laneDirs) {
      const statePath = safeJoin(lanesDir, laneName, 'state.json');
      if (!fs.existsSync(statePath)) continue;
      
      const state = loadState<LaneState>(statePath);
      if (!state) continue;
      
      // Check if this lane's tasks file is in the target tasks directory
      if (state.tasksFile) {
        const taskFileDir = path.dirname(state.tasksFile);
        if (path.resolve(taskFileDir) === path.resolve(tasksDir)) {
          matchesTasksDir = true;
        }
      }
      
      // Check completion status
      if (state.status === 'completed') {
        completedLanes.push(laneName);
      } else {
        // Check if process is alive (zombie detection)
        let isZombie = false;
        if (state.status === 'running' && state.pid) {
          try {
            process.kill(state.pid, 0);
          } catch {
            isZombie = true;
          }
        }
        
        incompleteLanes.push({
          name: laneName,
          status: isZombie ? 'zombie' : state.status,
          taskIndex: state.currentTaskIndex,
          totalTasks: state.totalTasks,
          error: state.error || undefined,
        });
      }
    }
    
    if (matchesTasksDir && incompleteLanes.length > 0) {
      return {
        runDir,
        runId,
        incompleteLanes,
        completedLanes,
        totalLanes: laneDirs.length,
      };
    }
  }
  
  return null;
}

interface RunOptions {
  tasksDir?: string;
  dryRun: boolean;
  executor: string | null;
  maxConcurrent: number | null;
  skipDoctor: boolean;
  skipPreflight: boolean;
  noGit: boolean;
  raw: boolean;
  help: boolean;
}

function printHelp(): void {
  console.log(`
Usage: cursorflow run <tasks-dir> [options]

Run task orchestration based on dependency graph.

If an existing run with incomplete lanes is found for the same tasks directory,
it will automatically resume instead of starting a new run.

Options:
  <tasks-dir>            Directory containing task JSON files
  --max-concurrent <num> Limit parallel agents (overrides config)
  --executor <type>      cursor-agent | cloud
  --skip-doctor          Skip environment checks (not recommended)
  --skip-preflight       Skip preflight checks (Git remote, etc.)
  --no-git               Disable Git operations (worktree, push, commit)
  --raw                  Save raw logs (absolute raw, no processing)
  --dry-run              Show execution plan without starting agents
  --help, -h             Show help

Examples:
  cursorflow run _cursorflow/tasks
  cursorflow run _cursorflow/tasks --no-git --skip-doctor
  `);
}

function parseArgs(args: string[]): RunOptions {
  const tasksDir = args.find(a => !a.startsWith('--'));
  const executorIdx = args.indexOf('--executor');
  const maxConcurrentIdx = args.indexOf('--max-concurrent');
  
  return {
    tasksDir,
    dryRun: args.includes('--dry-run'),
    executor: executorIdx >= 0 ? args[executorIdx + 1] || null : null,
    maxConcurrent: maxConcurrentIdx >= 0 ? parseInt(args[maxConcurrentIdx + 1] || '0') || null : null,
    skipDoctor: args.includes('--skip-doctor') || args.includes('--no-doctor'),
    skipPreflight: args.includes('--skip-preflight'),
    noGit: args.includes('--no-git'),
    raw: args.includes('--raw'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

async function run(args: string[]): Promise<void> {
  const options = parseArgs(args);
  
  if (options.help) {
    printHelp();
    return;
  }

  // Auto-setup Cursor commands if missing or outdated
  if (!areCommandsInstalled()) {
    logger.info('Installing missing or outdated Cursor IDE commands...');
    try {
      setupCommands({ silent: true });
    } catch (e) {
      // Non-blocking
    }
  }

  if (!options.tasksDir) {
    console.log('\nUsage: cursorflow run <tasks-dir> [options]');
    throw new Error('Tasks directory required');
  }
  
  const config = loadConfig();
  const logsDir = getLogsDir(config);
  const originalCwd = process.cwd();

  // Change current directory to project root for consistent path handling
  if (config.projectRoot !== originalCwd) {
    logger.debug(`Changing directory to project root: ${config.projectRoot}`);
    process.chdir(config.projectRoot);
  }

  // Resolve tasks dir:
  // 1. Prefer the exact path if it exists relative to original cwd
  // 2. Search in flowsDir by name
  // 3. Fall back to projectRoot-relative tasksDir for backward compatibility
  let tasksDir = '';
  if (path.isAbsolute(options.tasksDir)) {
    tasksDir = options.tasksDir;
  } else {
    const relPath = path.resolve(originalCwd, options.tasksDir);
    if (fs.existsSync(relPath)) {
      tasksDir = relPath;
    } else {
      // Try finding in flowsDir
      const flowsDir = safeJoin(config.projectRoot, config.flowsDir);
      const foundFlow = findFlowDir(flowsDir, options.tasksDir);
      if (foundFlow) {
        tasksDir = foundFlow;
      } else {
        // Fallback to legacy tasksDir
        tasksDir = safeJoin(config.projectRoot, options.tasksDir);
      }
    }
  }

  if (!fs.existsSync(tasksDir)) {
    throw new Error(`Tasks or Flow directory not found: ${options.tasksDir} (resolved to: ${tasksDir})`);
  }

  // Check for existing incomplete run and auto-resume
  const existingRun = findExistingRunForTasks(logsDir, tasksDir);
  if (existingRun && existingRun.incompleteLanes.length > 0) {
    logger.section('📋 Existing Run Detected');
    logger.info(`Run: ${existingRun.runId}`);
    logger.info(`Completed: ${existingRun.completedLanes.length}/${existingRun.totalLanes} lanes`);
    
    console.log('');
    logger.info('Incomplete lanes:');
    for (const lane of existingRun.incompleteLanes) {
      const statusEmoji = lane.status === 'failed' ? '❌' : 
                          lane.status === 'zombie' ? '🧟' :
                          lane.status === 'running' ? '🔄' : '⏸';
      logger.info(`  ${statusEmoji} ${lane.name}: ${lane.status} (${lane.taskIndex}/${lane.totalTasks})`);
      if (lane.error) {
        logger.warn(`     └─ ${lane.error.substring(0, 60)}${lane.error.length > 60 ? '...' : ''}`);
      }
    }
    
    console.log('');
    logger.info('🔄 Auto-resuming from existing run...');
    console.log('');
    
    // Call the resume command with --all flag
    const resumeCmd = require('./resume');
    const resumeArgs = [
      '--all',
      '--run-dir', existingRun.runDir,
    ];
    
    if (options.skipDoctor) resumeArgs.push('--skip-doctor');
    if (options.skipPreflight) resumeArgs.push('--skip-preflight');
    if (options.noGit) resumeArgs.push('--no-git');
    if (options.executor) {
      resumeArgs.push('--executor', options.executor);
    }
    if (options.maxConcurrent) {
      resumeArgs.push('--max-concurrent', String(options.maxConcurrent));
    }
    
    await resumeCmd(resumeArgs);
    return;
  }

  // Check if doctor has been run at least once
  const doctorStatus = getDoctorStatus(config.projectRoot);
  if (!doctorStatus) {
    logger.warn('It looks like you haven\'t run `cursorflow doctor` yet.');
    logger.warn('Running doctor is highly recommended to catch environment issues early.');
    console.log('   Run: cursorflow doctor\n');
  }

  // Preflight checks (doctor)
  if (!options.skipDoctor && !options.skipPreflight) {
    const report = runDoctor({
      cwd: process.cwd(),
      tasksDir,
      executor: options.executor || config.executor,
      includeCursorAgentChecks: true,
    });

    if (!report.ok) {
      logger.section('🛑 Pre-flight check failed');
      for (const issue of report.issues) {
        const header = `${issue.title} (${issue.id})`;
        if (issue.severity === 'error') {
          logger.error(header, { emoji: '❌' });
        } else {
          logger.warn(header, { emoji: '⚠️' });
        }
        console.log(`   ${issue.message}`);
        if (issue.details) console.log(`   Details: ${issue.details}`);
        if (issue.fixes?.length) {
          console.log('   Fix:');
          for (const fix of issue.fixes) console.log(`     - ${fix}`);
        }
        console.log('');
      }
      throw new Error('Pre-flight checks failed. Run `cursorflow doctor` for details.');
    }
  }
  
  try {
    await orchestrate(tasksDir, {
      executor: options.executor || config.executor,
      pollInterval: config.pollInterval * 1000,
      runDir: path.join(logsDir, 'runs', `run-${Date.now()}`),
      maxConcurrentLanes: options.maxConcurrent || config.maxConcurrentLanes,
      webhooks: config.webhooks || [],
      enhancedLogging: {
        ...config.enhancedLogging,
        ...(options.raw ? { raw: true } : {}),
      },
      noGit: options.noGit,
      skipPreflight: options.skipPreflight,
    });
  } catch (error: any) {
    // Re-throw to be handled by the main entry point
    throw new Error(`Orchestration failed: ${error.message}`);
  }
}

export = run;

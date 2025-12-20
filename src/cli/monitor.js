#!/usr/bin/env node
/**
 * CursorFlow monitor command
 */

const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { loadState } = require('../utils/state');
const { loadConfig } = require('../utils/config');

function parseArgs(args) {
  const watch = args.includes('--watch');
  const intervalIdx = args.indexOf('--interval');
  const interval = intervalIdx >= 0 ? parseInt(args[intervalIdx + 1]) || 2 : 2;
  
  // Find run directory (first non-option argument)
  const runDir = args.find(arg => !arg.startsWith('--') && args.indexOf(arg) !== intervalIdx + 1);
  
  return {
    runDir,
    watch,
    interval,
  };
}

/**
 * Find the latest run directory
 */
function findLatestRunDir(logsDir) {
  const runsDir = path.join(logsDir, 'runs');
  
  if (!fs.existsSync(runsDir)) {
    return null;
  }
  
  const runs = fs.readdirSync(runsDir)
    .filter(d => d.startsWith('run-'))
    .map(d => ({
      name: d,
      path: path.join(runsDir, d),
      mtime: fs.statSync(path.join(runsDir, d)).mtime.getTime(),
    }))
    .sort((a, b) => b.mtime - a.mtime);
  
  return runs.length > 0 ? runs[0].path : null;
}

/**
 * List all lanes in a run directory
 */
function listLanes(runDir) {
  const lanesDir = path.join(runDir, 'lanes');
  
  if (!fs.existsSync(lanesDir)) {
    return [];
  }
  
  return fs.readdirSync(lanesDir)
    .filter(d => {
      const stat = fs.statSync(path.join(lanesDir, d));
      return stat.isDirectory();
    })
    .map(name => ({
      name,
      path: path.join(lanesDir, name),
    }));
}

/**
 * Get lane status
 */
function getLaneStatus(lanePath) {
  const statePath = path.join(lanePath, 'state.json');
  const state = loadState(statePath);
  
  if (!state) {
    return {
      status: 'no state',
      currentTask: '-',
      totalTasks: '?',
      progress: '0%',
    };
  }
  
  const progress = state.totalTasks > 0 
    ? Math.round((state.currentTaskIndex / state.totalTasks) * 100)
    : 0;
  
  return {
    status: state.status || 'unknown',
    currentTask: state.currentTaskIndex + 1,
    totalTasks: state.totalTasks || '?',
    progress: `${progress}%`,
    pipelineBranch: state.pipelineBranch || '-',
    chatId: state.chatId || '-',
  };
}

/**
 * Display lane status table
 */
function displayStatus(runDir, lanes) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📊 Run: ${path.basename(runDir)}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  if (lanes.length === 0) {
    console.log('  No lanes found\n');
    return;
  }
  
  // Calculate column widths
  const maxNameLen = Math.max(...lanes.map(l => l.name.length), 10);
  
  // Header
  console.log(`  ${'Lane'.padEnd(maxNameLen)}  Status              Progress  Tasks`);
  console.log(`  ${'─'.repeat(maxNameLen)}  ${'─'.repeat(18)}  ${'─'.repeat(8)}  ${'─'.repeat(10)}`);
  
  // Lanes
  for (const lane of lanes) {
    const status = getLaneStatus(lane.path);
    const statusIcon = getStatusIcon(status.status);
    const statusText = `${statusIcon} ${status.status}`.padEnd(18);
    const progressText = status.progress.padEnd(8);
    const tasksText = `${status.currentTask}/${status.totalTasks}`;
    
    console.log(`  ${lane.name.padEnd(maxNameLen)}  ${statusText}  ${progressText}  ${tasksText}`);
  }
  
  console.log();
}

/**
 * Get status icon
 */
function getStatusIcon(status) {
  const icons = {
    'running': '🔄',
    'completed': '✅',
    'failed': '❌',
    'blocked_dependency': '🚫',
    'no state': '⚪',
  };
  
  return icons[status] || '❓';
}

/**
 * Monitor lanes
 */
async function monitor(args) {
  logger.section('📡 Monitoring Lane Execution');
  
  const options = parseArgs(args);
  const config = loadConfig();
  
  // Determine run directory
  let runDir = options.runDir;
  
  if (!runDir || runDir === 'latest') {
    runDir = findLatestRunDir(config.logsDir);
    
    if (!runDir) {
      logger.error('No run directories found');
      logger.info(`Runs directory: ${path.join(config.logsDir, 'runs')}`);
      process.exit(1);
    }
    
    logger.info(`Using latest run: ${path.basename(runDir)}`);
  }
  
  if (!fs.existsSync(runDir)) {
    logger.error(`Run directory not found: ${runDir}`);
    process.exit(1);
  }
  
  // Watch mode
  if (options.watch) {
    logger.info(`Watch mode: every ${options.interval}s (Ctrl+C to stop)\n`);
    
    let iteration = 0;
    
    const refresh = () => {
      if (iteration > 0) {
        // Clear screen
        process.stdout.write('\x1Bc');
      }
      
      const lanes = listLanes(runDir);
      displayStatus(runDir, lanes);
      
      iteration++;
    };
    
    // Initial display
    refresh();
    
    // Set up interval
    const intervalId = setInterval(refresh, options.interval * 1000);
    
    // Handle Ctrl+C
    process.on('SIGINT', () => {
      clearInterval(intervalId);
      console.log('\n👋 Monitoring stopped\n');
      process.exit(0);
    });
    
  } else {
    // Single shot
    const lanes = listLanes(runDir);
    displayStatus(runDir, lanes);
  }
}

module.exports = monitor;

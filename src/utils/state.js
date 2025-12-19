#!/usr/bin/env node
/**
 * State management utilities for CursorFlow
 */

const fs = require('fs');
const path = require('path');

/**
 * Save state to JSON file
 */
function saveState(statePath, state) {
  const stateDir = path.dirname(statePath);
  
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }
  
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * Load state from JSON file
 */
function loadState(statePath) {
  if (!fs.existsSync(statePath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(statePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.warn(`Warning: Failed to parse state file ${statePath}: ${error.message}`);
    return null;
  }
}

/**
 * Append to JSONL log file
 */
function appendLog(logPath, entry) {
  const logDir = path.dirname(logPath);
  
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(logPath, line, 'utf8');
}

/**
 * Read JSONL log file
 */
function readLog(logPath) {
  if (!fs.existsSync(logPath)) {
    return [];
  }
  
  try {
    const content = fs.readFileSync(logPath, 'utf8');
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
  } catch (error) {
    console.warn(`Warning: Failed to parse log file ${logPath}: ${error.message}`);
    return [];
  }
}

/**
 * Create initial lane state
 */
function createLaneState(laneName, config) {
  return {
    label: laneName,
    status: 'pending',
    currentTaskIndex: 0,
    totalTasks: config.tasks ? config.tasks.length : 0,
    worktreeDir: null,
    pipelineBranch: null,
    startTime: Date.now(),
    endTime: null,
    error: null,
    dependencyRequest: null,
  };
}

/**
 * Update lane state
 */
function updateLaneState(state, updates) {
  return {
    ...state,
    ...updates,
    updatedAt: Date.now(),
  };
}

/**
 * Create conversation log entry
 */
function createConversationEntry(role, text, options = {}) {
  return {
    timestamp: new Date().toISOString(),
    role,  // 'user' | 'assistant' | 'reviewer' | 'system'
    task: options.task || null,
    fullText: text,
    textLength: text.length,
    model: options.model || null,
  };
}

/**
 * Create git operation log entry
 */
function createGitLogEntry(operation, details = {}) {
  return {
    timestamp: new Date().toISOString(),
    operation,  // 'commit' | 'push' | 'merge' | 'worktree-add' | etc.
    ...details,
  };
}

/**
 * Create event log entry
 */
function createEventEntry(event, data = {}) {
  return {
    timestamp: new Date().toISOString(),
    event,
    ...data,
  };
}

/**
 * Get latest run directory
 */
function getLatestRunDir(logsDir) {
  if (!fs.existsSync(logsDir)) {
    return null;
  }
  
  const runs = fs.readdirSync(logsDir)
    .filter(f => fs.statSync(path.join(logsDir, f)).isDirectory())
    .sort()
    .reverse();
  
  if (runs.length === 0) {
    return null;
  }
  
  return path.join(logsDir, runs[0]);
}

/**
 * List all lanes in a run directory
 */
function listLanesInRun(runDir) {
  if (!fs.existsSync(runDir)) {
    return [];
  }
  
  return fs.readdirSync(runDir)
    .filter(f => fs.statSync(path.join(runDir, f)).isDirectory())
    .map(laneName => ({
      name: laneName,
      dir: path.join(runDir, laneName),
      statePath: path.join(runDir, laneName, 'state.json'),
    }));
}

/**
 * Get lane state summary
 */
function getLaneStateSummary(statePath) {
  const state = loadState(statePath);
  if (!state) {
    return { status: 'unknown', progress: '-' };
  }
  
  const progress = `${(state.currentTaskIndex || 0) + 1}/${state.totalTasks || '?'}`;
  
  return {
    status: state.status || 'unknown',
    progress,
    label: state.label,
    error: state.error,
  };
}

module.exports = {
  saveState,
  loadState,
  appendLog,
  readLog,
  createLaneState,
  updateLaneState,
  createConversationEntry,
  createGitLogEntry,
  createEventEntry,
  getLatestRunDir,
  listLanesInRun,
  getLaneStateSummary,
};

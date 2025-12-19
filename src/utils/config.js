#!/usr/bin/env node
/**
 * Configuration loader for CursorFlow
 * 
 * Finds project root and loads user configuration with defaults
 */

const path = require('path');
const fs = require('fs');

/**
 * Find project root by looking for package.json
 */
function findProjectRoot(cwd = process.cwd()) {
  let current = cwd;
  
  while (current !== path.parse(current).root) {
    const packagePath = path.join(current, 'package.json');
    if (fs.existsSync(packagePath)) {
      return current;
    }
    current = path.dirname(current);
  }
  
  throw new Error('Cannot find project root with package.json');
}

/**
 * Load configuration with defaults
 */
function loadConfig(projectRoot = null) {
  if (!projectRoot) {
    projectRoot = findProjectRoot();
  }
  
  const configPath = path.join(projectRoot, 'cursorflow.config.js');
  
  // Default configuration
  const defaults = {
    // Directories
    tasksDir: '_cursorflow/tasks',
    logsDir: '_cursorflow/logs',
    
    // Git
    baseBranch: 'main',
    branchPrefix: 'feature/',
    
    // Execution
    executor: 'cursor-agent',  // 'cursor-agent' | 'cloud'
    pollInterval: 60,          // seconds
    
    // Dependencies
    allowDependencyChange: false,
    lockfileReadOnly: true,
    
    // Review
    enableReview: false,
    reviewModel: 'sonnet-4.5-thinking',
    maxReviewIterations: 3,
    
    // Lane defaults
    defaultLaneConfig: {
      devPort: 3001,           // 3000 + laneNumber
      autoCreatePr: false,
    },
    
    // Logging
    logLevel: 'info',          // 'error' | 'warn' | 'info' | 'debug'
    verboseGit: false,
    
    // Advanced
    worktreePrefix: 'cursorflow-',
    maxConcurrentLanes: 10,
    
    // Internal
    projectRoot,
  };
  
  // Try to load user config
  if (fs.existsSync(configPath)) {
    try {
      const userConfig = require(configPath);
      return { ...defaults, ...userConfig, projectRoot };
    } catch (error) {
      console.warn(`Warning: Failed to load config from ${configPath}: ${error.message}`);
      console.warn('Using default configuration...');
    }
  }
  
  return defaults;
}

/**
 * Get absolute path for tasks directory
 */
function getTasksDir(config) {
  return path.join(config.projectRoot, config.tasksDir);
}

/**
 * Get absolute path for logs directory
 */
function getLogsDir(config) {
  return path.join(config.projectRoot, config.logsDir);
}

/**
 * Validate configuration
 */
function validateConfig(config) {
  const errors = [];
  
  if (!config.tasksDir) {
    errors.push('tasksDir is required');
  }
  
  if (!config.logsDir) {
    errors.push('logsDir is required');
  }
  
  if (!['cursor-agent', 'cloud'].includes(config.executor)) {
    errors.push('executor must be "cursor-agent" or "cloud"');
  }
  
  if (config.pollInterval < 1) {
    errors.push('pollInterval must be >= 1');
  }
  
  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
  
  return true;
}

/**
 * Create default config file
 */
function createDefaultConfig(projectRoot) {
  const configPath = path.join(projectRoot, 'cursorflow.config.js');
  
  if (fs.existsSync(configPath)) {
    throw new Error(`Config file already exists: ${configPath}`);
  }
  
  const template = `module.exports = {
  // Directory configuration
  tasksDir: '_cursorflow/tasks',
  logsDir: '_cursorflow/logs',
  
  // Git configuration
  baseBranch: 'main',
  branchPrefix: 'feature/',
  
  // Execution configuration
  executor: 'cursor-agent',  // 'cursor-agent' | 'cloud'
  pollInterval: 60,          // seconds
  
  // Dependency management
  allowDependencyChange: false,
  lockfileReadOnly: true,
  
  // Review configuration
  enableReview: false,
  reviewModel: 'sonnet-4.5-thinking',
  maxReviewIterations: 3,
  
  // Lane configuration
  defaultLaneConfig: {
    devPort: 3001,           // 3000 + laneNumber
    autoCreatePr: false,
  },
  
  // Logging
  logLevel: 'info',          // 'error' | 'warn' | 'info' | 'debug'
  verboseGit: false,
  
  // Advanced
  worktreePrefix: 'cursorflow-',
  maxConcurrentLanes: 10,
};
`;
  
  fs.writeFileSync(configPath, template, 'utf8');
  return configPath;
}

module.exports = {
  findProjectRoot,
  loadConfig,
  getTasksDir,
  getLogsDir,
  validateConfig,
  createDefaultConfig,
};

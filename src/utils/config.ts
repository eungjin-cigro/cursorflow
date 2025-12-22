/**
 * Configuration loader for CursorFlow
 * 
 * Finds project root and loads user configuration with defaults
 */

import * as path from 'path';
import * as fs from 'fs';
import { CursorFlowConfig } from './types';
import { safeJoin } from './path';
export { CursorFlowConfig };

/**
 * Find project root by looking for package.json
 */
export function findProjectRoot(cwd = process.cwd()): string {
  let current = cwd;
  
  while (current !== path.parse(current).root) {
    const packagePath = safeJoin(current, 'package.json');
    const configPath = safeJoin(current, 'cursorflow.config.js');
    
    if (fs.existsSync(packagePath) || fs.existsSync(configPath)) {
      return current;
    }
    current = path.dirname(current);
  }
  
  throw new Error('Cannot find project root with package.json');
}

/**
 * Load configuration with defaults
 */
export function loadConfig(projectRoot: string | null = null): CursorFlowConfig {
  if (!projectRoot) {
    projectRoot = findProjectRoot();
  }
  
  const configPath = safeJoin(projectRoot, 'cursorflow.config.js');
  
  // Default configuration
  const defaults: CursorFlowConfig = {
    // Directories
    tasksDir: '_cursorflow/tasks',
    logsDir: '_cursorflow/logs',
    pofDir: '_cursorflow/pof',
    
    // Git
    baseBranch: 'main',
    branchPrefix: 'feature/',
    
    // Execution
    executor: 'cursor-agent',
    pollInterval: 60,
    
    // Dependencies
    allowDependencyChange: false,
    lockfileReadOnly: true,
    
    // Review
    enableReview: false,
    reviewModel: 'sonnet-4.5-thinking',
    reviewAllTasks: false,
    maxReviewIterations: 3,
    
    // Lane defaults
    defaultLaneConfig: {
      devPort: 3001,
      autoCreatePr: false,
    },
    
    // Logging
    logLevel: 'info',
    verboseGit: false,
    
    // Advanced
    worktreePrefix: 'cursorflow-',
    maxConcurrentLanes: 10,
    agentOutputFormat: 'stream-json',
    
    // Webhooks
    webhooks: [],
    
    // Enhanced logging
    enhancedLogging: {
      enabled: true,
      stripAnsi: true,
      addTimestamps: true,
      maxFileSize: 50 * 1024 * 1024, // 50MB
      maxFiles: 5,
      keepRawLogs: true,
      writeJsonLog: true,
      timestampFormat: 'iso',
    },
    
    // Internal
    projectRoot,
  };
  
  // Try to load user config
  if (fs.existsSync(configPath)) {
    try {
      const userConfig = require(configPath);
      return { ...defaults, ...userConfig, projectRoot };
    } catch (error: any) {
      console.warn(`Warning: Failed to load config from ${configPath}: ${error.message}`);
      console.warn('Using default configuration...');
    }
  }
  
  return defaults;
}

/**
 * Get absolute path for tasks directory
 */
export function getTasksDir(config: CursorFlowConfig): string {
  return safeJoin(config.projectRoot, config.tasksDir);
}

/**
 * Get absolute path for logs directory
 */
export function getLogsDir(config: CursorFlowConfig): string {
  return safeJoin(config.projectRoot, config.logsDir);
}

/**
 * Get absolute path for POF directory
 */
export function getPofDir(config: CursorFlowConfig): string {
  return safeJoin(config.projectRoot, config.pofDir);
}

/**
 * Validate configuration
 */
export function validateConfig(config: CursorFlowConfig): boolean {
  const errors: string[] = [];
  
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
export function createDefaultConfig(projectRoot: string, force = false): string {
  const configPath = safeJoin(projectRoot, 'cursorflow.config.js');
  
  const template = `module.exports = {
  // Directory configuration
  tasksDir: '_cursorflow/tasks',
  logsDir: '_cursorflow/logs',
  pofDir: '_cursorflow/pof',
  
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
  reviewAllTasks: false,
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
  agentOutputFormat: 'stream-json', // 'stream-json' | 'json' | 'plain'

  // Webhook configuration
  // webhooks: [
  //   {
  //     enabled: true,
  //     url: 'https://api.example.com/events',
  //     events: ['*'],
  //   }
  // ],

  // Enhanced logging configuration
  enhancedLogging: {
    enabled: true,           // Enable enhanced logging features
    stripAnsi: true,         // Strip ANSI codes for clean logs
    addTimestamps: true,     // Add timestamps to each line
    maxFileSize: 52428800,   // 50MB max file size before rotation
    maxFiles: 5,             // Number of rotated files to keep
    keepRawLogs: true,       // Keep raw logs with ANSI codes
    writeJsonLog: true,      // Write structured JSON logs
    timestampFormat: 'iso',  // 'iso' | 'relative' | 'short'
  },
};
`;
  
  // Use atomic write with wx flag to avoid TOCTOU race condition (unless force is set)
  try {
    const writeFlag = force ? 'w' : 'wx';
    fs.writeFileSync(configPath, template, { encoding: 'utf8', flag: writeFlag });
  } catch (err: any) {
    if (err.code === 'EEXIST') {
      throw new Error(`Config file already exists: ${configPath}`);
    }
    throw err;
  }
  return configPath;
}

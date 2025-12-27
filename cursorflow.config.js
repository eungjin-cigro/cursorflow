module.exports = {
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
  
  // Intervention - allows sending messages to running agents
  enableIntervention: true,
  
  // Lane configuration
  defaultLaneConfig: {
    devPort: 3001,           // 3000 + laneNumber
    autoCreatePr: false,
  },
  
  // Logging
  logLevel: 'info',          // 'error' | 'warn' | 'info' | 'debug'
  verboseGit: true,
  
  // Advanced
  worktreePrefix: 'cursorflow-',
  maxConcurrentLanes: 10,
  agentOutputFormat: 'stream-json', // 'stream-json' | 'json' | 'text'

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

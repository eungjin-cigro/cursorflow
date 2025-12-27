#!/usr/bin/env node
/**
 * Mock cursor-agent CLI for testing
 * 
 * Simulates cursor-agent behavior:
 * - create-chat: Returns a mock chat ID
 * - --resume: Reads prompt from stdin, outputs scenario-based response
 * 
 * Controlled via environment variables:
 * - MOCK_AGENT_SCENARIO: Scenario name (default: 'success')
 * - MOCK_AGENT_SCENARIO_DIR: Custom scenario directory
 * - MOCK_AGENT_CONTROL_FILE: File for dynamic control during test
 * - MOCK_AGENT_DELAY: Override delay in ms
 */

const fs = require('fs');
const path = require('path');

// Parse command line arguments
const args = process.argv.slice(2);

// Scenario configuration
const scenarioName = process.env.MOCK_AGENT_SCENARIO || 'success';
const scenarioDir = process.env.MOCK_AGENT_SCENARIO_DIR || path.join(__dirname, 'scenarios');
const controlFile = process.env.MOCK_AGENT_CONTROL_FILE;
const delayOverride = process.env.MOCK_AGENT_DELAY ? parseInt(process.env.MOCK_AGENT_DELAY) : null;

/**
 * Load scenario configuration
 */
function loadScenario(name) {
  const scenarioPath = path.join(scenarioDir, `${name}.json`);
  
  if (fs.existsSync(scenarioPath)) {
    return JSON.parse(fs.readFileSync(scenarioPath, 'utf8'));
  }
  
  // Default scenarios (built-in)
  const defaultScenarios = {
    'success': {
      delay: 100,
      chunks: ['Working on the task...', 'Task completed successfully.'],
      result: 'Task completed: All changes have been made.',
      exitCode: 0,
      isError: false
    },
    'timeout': {
      delay: 300000,  // 5 minutes - will trigger idle detection
      chunks: [],
      result: '',
      exitCode: 0,
      isError: false
    },
    'failure': {
      delay: 100,
      chunks: ['Starting task...', 'Error encountered.'],
      result: '',
      exitCode: 1,
      isError: true,
      error: 'Task failed due to an error'
    },
    'dependency-request': {
      delay: 100,
      chunks: ['Analyzing dependencies...'],
      result: 'DEPENDENCY_CHANGE_REQUIRED {"reason": "Need to install lodash", "packages": ["lodash"], "commands": ["npm install lodash"]}',
      exitCode: 0,
      isError: false
    },
    'hang-then-respond': {
      initialHang: 5000,  // Hang for 5 seconds first
      delay: 100,
      chunks: ['Resumed after hang.'],
      result: 'Task completed after delay.',
      exitCode: 0,
      isError: false
    },
    'crash': {
      delay: 50,
      chunks: ['Starting...'],
      result: '',
      exitCode: 137,  // SIGKILL
      isError: true
    },
    'partial-progress': {
      delay: 100,
      chunks: ['Step 1 complete.', 'Step 2 complete.'],
      progressCheckpoint: 2,  // Save progress at this point
      result: 'Partial work done.',
      exitCode: 0,
      isError: false
    }
  };
  
  return defaultScenarios[name] || defaultScenarios['success'];
}

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check control file for dynamic commands
 */
async function checkControlFile() {
  if (!controlFile || !fs.existsSync(controlFile)) {
    return null;
  }
  
  try {
    const cmd = fs.readFileSync(controlFile, 'utf8').trim();
    fs.unlinkSync(controlFile);  // Consume the command
    return cmd;
  } catch {
    return null;
  }
}

/**
 * Wait for control signal
 */
async function waitForSignal(expectedSignal, timeoutMs = 60000) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    const cmd = await checkControlFile();
    if (cmd === expectedSignal) {
      return true;
    }
    if (cmd === 'ABORT') {
      return false;
    }
    await sleep(100);
  }
  
  return false;  // Timeout
}

/**
 * Output JSON line (stream-json format)
 */
function outputJson(obj) {
  console.log(JSON.stringify(obj));
}

/**
 * Handle create-chat command
 */
function handleCreateChat() {
  const chatId = `mock-chat-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  console.log(chatId);
  process.exit(0);
}

/**
 * Handle --version command
 */
function handleVersion() {
  console.log('mock-cursor-agent 1.0.0 (test)');
  process.exit(0);
}

/**
 * Handle --help command
 * Mirrors real cursor-agent help output format (2025.12 version)
 * Reference: docs/CURSOR_AGENT_GUIDE.md
 */
function handleHelp() {
  console.log(`Usage: cursor-agent [options] [command] [prompt...]

Mock cursor-agent CLI for testing

Arguments:
  prompt                       Initial prompt for the agent

Options:
  -v, --version                Output the version number
  --api-key <key>              API key for authentication
  -H, --header <header>        Add custom header (format: 'Name: Value')
  -p, --print                  Print responses to console (non-interactive)
  --output-format <format>     Output format: text | json | stream-json
  --stream-partial-output      Stream partial output as deltas
  -c, --cloud                  Start in cloud mode
  --resume [chatId]            Resume a chat session
  --model <model>              Model to use (e.g., gpt-5, sonnet-4)
  -f, --force                  Force allow commands
  --approve-mcps               Auto-approve MCP servers (headless only)
  --browser                    Enable browser automation
  --workspace <path>           Workspace directory
  -h, --help                   Display help

Commands:
  install-shell-integration    Install shell integration
  uninstall-shell-integration  Remove shell integration
  login                        Authenticate with Cursor
  logout                       Sign out
  mcp                          Manage MCP servers
  status|whoami                View authentication status
  update|upgrade               Update Cursor Agent
  create-chat                  Create new chat, return ID
  agent [prompt...]            Start the Cursor Agent
  ls                           List/select sessions (Interactive)
  resume                       Resume latest session
  help [command]               Display help

Mock-specific Environment Variables:
  MOCK_AGENT_SCENARIO          Scenario name (success, timeout, failure, etc.)
  MOCK_AGENT_SCENARIO_DIR      Custom scenario directory
  MOCK_AGENT_CONTROL_FILE      File for dynamic test control
  MOCK_AGENT_DELAY             Override delay in milliseconds
`);
  process.exit(0);
}

/**
 * Get model from args
 */
function getModelFromArgs() {
  const modelIndex = args.indexOf('--model');
  if (modelIndex !== -1 && args[modelIndex + 1]) {
    return args[modelIndex + 1];
  }
  return 'Gemini 3 Flash'; // Default mock model
}

/**
 * Handle --resume command (main agent interaction)
 * 
 * Output format follows real cursor-agent stream-json spec:
 * 1. system (init) - session initialization
 * 2. user - user prompt echo
 * 3. thinking (delta/completed) - thinking process (optional)
 * 4. assistant - AI response
 * 5. result (success/error) - final result with metadata
 * 
 * Reference: docs/CURSOR_AGENT_GUIDE.md
 */
async function handleResume(chatId) {
  const scenario = loadScenario(scenarioName);
  const startTime = Date.now();
  const model = getModelFromArgs();
  
  // Read prompt from stdin
  let prompt = '';
  
  await new Promise((resolve) => {
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      prompt += chunk;
    });
    process.stdin.on('end', resolve);
    
    // Handle case where stdin is already closed
    if (process.stdin.readableEnded) {
      resolve();
    }
  });
  
  // Log received prompt (for debugging)
  if (process.env.MOCK_AGENT_DEBUG) {
    console.error(`[MOCK] Received prompt (${prompt.length} chars): ${prompt.substring(0, 100)}...`);
  }
  
  // 1. Output system init message
  outputJson({
    type: 'system',
    subtype: 'init',
    apiKeySource: 'login',
    cwd: process.cwd(),
    session_id: chatId,
    model: model,
    permissionMode: 'default'
  });
  
  // 2. Output user message (echo the prompt)
  outputJson({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text: prompt.trim() }]
    },
    session_id: chatId
  });
  
  // Initial hang (for testing idle detection)
  if (scenario.initialHang) {
    if (process.env.MOCK_AGENT_DEBUG) {
      console.error(`[MOCK] Initial hang for ${scenario.initialHang}ms`);
    }
    
    // Check for control file during hang
    const hangEnd = Date.now() + scenario.initialHang;
    while (Date.now() < hangEnd) {
      const cmd = await checkControlFile();
      if (cmd === 'RESPOND_NOW') {
        if (process.env.MOCK_AGENT_DEBUG) {
          console.error('[MOCK] Received RESPOND_NOW signal');
        }
        break;
      }
      if (cmd === 'ABORT') {
        process.exit(130);
      }
      await sleep(100);
    }
  }
  
  // Apply delay (can be overridden)
  const delay = delayOverride !== null ? delayOverride : (scenario.delay || 0);
  if (delay > 0) {
    await sleep(delay);
  }
  
  // 3. Output thinking messages (simulating streaming thought process)
  if (scenario.chunks && scenario.chunks.length > 0) {
    for (const chunk of scenario.chunks) {
      outputJson({
        type: 'thinking',
        subtype: 'delta',
        text: `**Processing**\n\n${chunk}\n\n`,
        session_id: chatId,
        timestamp_ms: Date.now()
      });
      await sleep(scenario.chunkInterval || 100);
    }
    
    // Output thinking completed
    outputJson({
      type: 'thinking',
      subtype: 'completed',
      session_id: chatId,
      timestamp_ms: Date.now()
    });
  }
  
  // 4. Output assistant message
  const assistantContent = scenario.result || 'Task completed successfully.';
  outputJson({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: assistantContent }]
    },
    session_id: chatId
  });
  
  // 5. Output final result message
  const duration = Date.now() - startTime;
  outputJson({
    type: 'result',
    subtype: scenario.isError ? 'error' : 'success',
    duration_ms: duration,
    duration_api_ms: duration,
    is_error: scenario.isError || false,
    result: assistantContent,
    session_id: chatId,
    request_id: `mock-req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
  });
  
  process.exit(scenario.exitCode || 0);
}

/**
 * Handle status/whoami command
 */
function handleStatus() {
  console.log(' ✓ Logged in as mock-test@cursorflow.test');
  process.exit(0);
}

/**
 * Main entry point
 */
async function main() {
  // Handle commands
  if (args.includes('create-chat')) {
    handleCreateChat();
    return;
  }
  
  // Handle status/whoami
  if (args.includes('status') || args.includes('whoami')) {
    handleStatus();
    return;
  }
  
  // Handle version (-v or --version)
  if (args.includes('--version') || args.includes('-v')) {
    handleVersion();
    return;
  }
  
  // Handle help (-h or --help)
  if (args.includes('--help') || args.includes('-h')) {
    handleHelp();
    return;
  }
  
  // Handle --resume
  const resumeIndex = args.indexOf('--resume');
  if (resumeIndex !== -1) {
    const chatId = args[resumeIndex + 1] || 'unknown';
    await handleResume(chatId);
    return;
  }
  
  // Default: treat as direct prompt (legacy mode)
  // Output in stream-json format for consistency
  const scenario = loadScenario(scenarioName);
  const startTime = Date.now();
  const directSessionId = `direct-${Date.now()}`;
  const model = getModelFromArgs();
  
  // Get prompt from remaining args (if any)
  const promptArgs = args.filter(a => !a.startsWith('-') && a !== 'agent');
  const prompt = promptArgs.join(' ') || 'Direct prompt';
  
  // 1. System init
  outputJson({
    type: 'system',
    subtype: 'init',
    apiKeySource: 'login',
    cwd: process.cwd(),
    session_id: directSessionId,
    model: model,
    permissionMode: 'default'
  });
  
  // 2. User message
  outputJson({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text: prompt }]
    },
    session_id: directSessionId
  });
  
  // Apply delay
  const delay = delayOverride !== null ? delayOverride : (scenario.delay || 0);
  if (delay > 0) {
    await sleep(delay);
  }
  
  // 3. Assistant message
  const assistantContent = scenario.result || 'Done.';
  outputJson({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: assistantContent }]
    },
    session_id: directSessionId
  });
  
  // 4. Result
  const duration = Date.now() - startTime;
  outputJson({
    type: 'result',
    subtype: scenario.isError ? 'error' : 'success',
    duration_ms: duration,
    duration_api_ms: duration,
    is_error: scenario.isError || false,
    result: assistantContent,
    session_id: directSessionId,
    request_id: `mock-req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
  });
  
  process.exit(scenario.exitCode || 0);
}

// Run
main().catch(err => {
  console.error('[MOCK ERROR]', err.message);
  process.exit(1);
});


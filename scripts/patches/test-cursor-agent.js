#!/usr/bin/env node
/**
 * Direct cursor-agent spawn test script
 * 
 * This script tests cursor-agent directly to compare behavior with CursorFlow.
 * It helps identify if the issue is in how CursorFlow spawns the agent.
 * 
 * Usage:
 *   node scripts/patches/test-cursor-agent.js [--stdio-mode <mode>]
 * 
 * Modes:
 *   - pipe: Full pipe mode (default, same as CursorFlow)
 *   - inherit-stdin: Inherit stdin, pipe stdout/stderr
 *   - inherit-all: Inherit all (like running directly in terminal)
 */

const { spawn, spawnSync } = require('child_process');

// Parse args
const args = process.argv.slice(2);
const stdioModeIdx = args.indexOf('--stdio-mode');
const stdioMode = stdioModeIdx >= 0 ? args[stdioModeIdx + 1] : 'pipe';

console.log('='.repeat(60));
console.log('cursor-agent Direct Spawn Test');
console.log('='.repeat(60));
console.log(`stdio mode: ${stdioMode}`);
console.log('');

// Step 1: Check cursor-agent is available
console.log('1. Checking cursor-agent availability...');
const whichResult = spawnSync('which', ['cursor-agent']);
if (whichResult.status !== 0) {
  console.error('   ❌ cursor-agent not found in PATH');
  process.exit(1);
}
console.log(`   ✓ Found at: ${whichResult.stdout.toString().trim()}`);

// Step 2: Create a chat session
console.log('\n2. Creating chat session...');
const createChatResult = spawnSync('cursor-agent', ['create-chat'], {
  encoding: 'utf8',
  stdio: 'pipe',
  timeout: 30000,
});

if (createChatResult.status !== 0) {
  console.error('   ❌ Failed to create chat:');
  console.error(createChatResult.stderr || createChatResult.stdout);
  process.exit(1);
}

const chatIdLines = createChatResult.stdout.trim().split('\n');
const chatId = chatIdLines[chatIdLines.length - 1];
console.log(`   ✓ Chat ID: ${chatId}`);

// Step 3: Configure stdio based on mode
let stdioConfig;
switch (stdioMode) {
  case 'inherit-stdin':
    stdioConfig = ['inherit', 'pipe', 'pipe'];
    break;
  case 'inherit-all':
    stdioConfig = 'inherit';
    break;
  case 'ignore-stdin':
    stdioConfig = ['ignore', 'pipe', 'pipe'];
    break;
  case 'pipe':
  default:
    stdioConfig = ['pipe', 'pipe', 'pipe'];
    break;
}

console.log(`\n3. Testing with stdio: ${JSON.stringify(stdioConfig)}`);

// Step 4: Send a simple prompt
const testPrompt = 'Just respond with: Hello World. Nothing else.';
const workspace = process.cwd();

const agentArgs = [
  '--print',
  '--output-format', 'stream-json',
  '--workspace', workspace,
  '--model', 'gemini-3-flash',
  '--resume', chatId,
  testPrompt,
];

console.log(`   Workspace: ${workspace}`);
console.log(`   Prompt: "${testPrompt}"`);
console.log('');
console.log('4. Spawning cursor-agent...');
console.log(`   Command: cursor-agent ${agentArgs.join(' ').substring(0, 80)}...`);
console.log('');

const startTime = Date.now();

const child = spawn('cursor-agent', agentArgs, {
  stdio: stdioConfig,
  env: {
    ...process.env,
    // Disable Python buffering if cursor-agent uses Python
    PYTHONUNBUFFERED: '1',
    // Disable Node.js experimental warnings
    NODE_OPTIONS: '',
  },
});

let fullStdout = '';
let fullStderr = '';
let gotData = false;

// Track first byte time
let firstByteTime = null;

if (child.stdout) {
  child.stdout.on('data', (data) => {
    if (!firstByteTime) {
      firstByteTime = Date.now();
      console.log(`   [+${((firstByteTime - startTime) / 1000).toFixed(2)}s] First stdout byte received`);
    }
    gotData = true;
    const str = data.toString();
    fullStdout += str;
    process.stdout.write(`   [stdout] ${str}`);
  });
}

if (child.stderr) {
  child.stderr.on('data', (data) => {
    const str = data.toString();
    fullStderr += str;
    process.stderr.write(`   [stderr] ${str}`);
  });
}

// Set timeout
const timeout = setTimeout(() => {
  console.log('\n   ⏰ TIMEOUT after 60 seconds');
  console.log(`   Got any data: ${gotData}`);
  console.log(`   Stdout length: ${fullStdout.length}`);
  console.log(`   Stderr length: ${fullStderr.length}`);
  child.kill('SIGTERM');
}, 60000);

child.on('close', (code) => {
  clearTimeout(timeout);
  const elapsed = (Date.now() - startTime) / 1000;
  
  console.log('\n' + '-'.repeat(60));
  console.log('RESULT');
  console.log('-'.repeat(60));
  console.log(`Exit code: ${code}`);
  console.log(`Duration: ${elapsed.toFixed(2)}s`);
  console.log(`First byte: ${firstByteTime ? ((firstByteTime - startTime) / 1000).toFixed(2) + 's' : 'never'}`);
  console.log(`Stdout bytes: ${fullStdout.length}`);
  console.log(`Stderr bytes: ${fullStderr.length}`);
  
  if (fullStdout.length > 0) {
    console.log('\nStdout content:');
    console.log(fullStdout);
  }
  
  if (fullStderr.length > 0) {
    console.log('\nStderr content:');
    console.log(fullStderr);
  }
  
  // Try to parse JSON
  const lines = fullStdout.split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith('{') && line.endsWith('}')) {
      try {
        const json = JSON.parse(line);
        console.log('\nParsed JSON response:');
        console.log(JSON.stringify(json, null, 2));
        break;
      } catch {
        continue;
      }
    }
  }
  
  console.log('\n' + '='.repeat(60));
  if (code === 0 && fullStdout.includes('result')) {
    console.log('✓ SUCCESS - cursor-agent responded correctly');
  } else if (gotData) {
    console.log('⚠ PARTIAL - Got data but may not have completed');
  } else {
    console.log('❌ FAILURE - No data received');
  }
  console.log('='.repeat(60));
});

child.on('error', (err) => {
  clearTimeout(timeout);
  console.error(`\n❌ Spawn error: ${err.message}`);
  process.exit(1);
});


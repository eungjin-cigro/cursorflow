#!/usr/bin/env node
/**
 * Core Runner - Execute tasks sequentially in a lane
 * 
 * Adapted from sequential-agent-runner.js
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const git = require('../utils/git');
const logger = require('../utils/logger');
const { ensureCursorAgent, checkCursorApiKey } = require('../utils/cursor-agent');
const { saveState, loadState, appendLog, createConversationEntry, createGitLogEntry } = require('../utils/state');

/**
 * Execute cursor-agent command with timeout and better error handling
 */
function cursorAgentCreateChat() {
  const { execSync } = require('child_process');
  
  try {
    const out = execSync('cursor-agent create-chat', {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 30000, // 30 second timeout
    });
    const lines = out.split('\n').filter(Boolean);
    const chatId = lines[lines.length - 1] || null;
    
    if (!chatId) {
      throw new Error('Failed to get chat ID from cursor-agent');
    }
    
    logger.info(`Created chat session: ${chatId}`);
    return chatId;
  } catch (error) {
    // Check for common errors
    if (error.message.includes('ENOENT')) {
      throw new Error('cursor-agent CLI not found. Install with: npm install -g @cursor/agent');
    }
    
    if (error.message.includes('ETIMEDOUT') || error.killed) {
      throw new Error('cursor-agent timed out. Check your internet connection and Cursor authentication.');
    }
    
    if (error.stderr) {
      const stderr = error.stderr.toString();
      
      // Check for authentication errors
      if (stderr.includes('not authenticated') || 
          stderr.includes('login') || 
          stderr.includes('auth')) {
        throw new Error(
          'Cursor authentication failed. Please:\n' +
          '  1. Open Cursor IDE\n' +
          '  2. Sign in to your account\n' +
          '  3. Verify you can use AI features\n' +
          '  4. Try running cursorflow again\n\n' +
          `Original error: ${stderr.trim()}`
        );
      }
      
      // Check for API key errors
      if (stderr.includes('api key') || stderr.includes('API_KEY')) {
        throw new Error(
          'Cursor API key error. Please check your Cursor account and subscription.\n' +
          `Error: ${stderr.trim()}`
        );
      }
      
      throw new Error(`cursor-agent error: ${stderr.trim()}`);
    }
    
    throw new Error(`Failed to create chat: ${error.message}`);
  }
}

function parseJsonFromStdout(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return null;
  const lines = text.split('\n').filter(Boolean);
  
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith('{') && line.endsWith('}')) {
      try {
        return JSON.parse(line);
      } catch {
        continue;
      }
    }
  }
  return null;
}

function cursorAgentSend({ workspaceDir, chatId, prompt, model }) {
  const { spawnSync } = require('child_process');
  
  const args = [
    '--print',
    '--output-format', 'json',
    '--workspace', workspaceDir,
    ...(model ? ['--model', model] : []),
    '--resume', chatId,
    prompt,
  ];
  
  logger.info('Executing cursor-agent...');
  
  const res = spawnSync('cursor-agent', args, {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 300000, // 5 minute timeout for LLM response
  });
  
  // Check for timeout
  if (res.error) {
    if (res.error.code === 'ETIMEDOUT') {
      return {
        ok: false,
        exitCode: -1,
        error: 'cursor-agent timed out after 5 minutes. The LLM request may be taking too long or there may be network issues.',
      };
    }
    
    return {
      ok: false,
      exitCode: -1,
      error: `cursor-agent error: ${res.error.message}`,
    };
  }
  
  const json = parseJsonFromStdout(res.stdout);
  
  if (res.status !== 0 || !json || json.type !== 'result') {
    let errorMsg = res.stderr?.trim() || res.stdout?.trim() || `exit=${res.status}`;
    
    // Check for authentication errors
    if (errorMsg.includes('not authenticated') || 
        errorMsg.includes('login') || 
        errorMsg.includes('auth')) {
      errorMsg = 'Authentication error. Please:\n' +
        '  1. Open Cursor IDE\n' +
        '  2. Sign in to your account\n' +
        '  3. Verify AI features are working\n' +
        '  4. Try again\n\n' +
        `Details: ${errorMsg}`;
    }
    
    // Check for rate limit errors
    if (errorMsg.includes('rate limit') || errorMsg.includes('quota')) {
      errorMsg = 'API rate limit or quota exceeded. Please:\n' +
        '  1. Check your Cursor subscription\n' +
        '  2. Wait a few minutes and try again\n\n' +
        `Details: ${errorMsg}`;
    }
    
    // Check for model errors
    if (errorMsg.includes('model')) {
      errorMsg = `Model error (requested: ${model || 'default'}). ` +
        'Please check if the model is available in your Cursor subscription.\n\n' +
        `Details: ${errorMsg}`;
    }
    
    return {
      ok: false,
      exitCode: res.status,
      error: errorMsg,
    };
  }
  
  return {
    ok: !json.is_error,
    exitCode: res.status,
    sessionId: json.session_id || chatId,
    resultText: json.result || '',
  };
}

/**
 * Extract dependency change request from agent response
 */
function extractDependencyRequest(text) {
  const t = String(text || '');
  const marker = 'DEPENDENCY_CHANGE_REQUIRED';
  
  if (!t.includes(marker)) {
    return { required: false };
  }
  
  const after = t.split(marker).slice(1).join(marker);
  const match = after.match(/\{[\s\S]*?\}/);
  
  if (match) {
    try {
      return {
        required: true,
        plan: JSON.parse(match[0]),
        raw: t,
      };
    } catch {
      return { required: true, raw: t };
    }
  }
  
  return { required: true, raw: t };
}

/**
 * Wrap prompt with dependency policy
 */
function wrapPromptForDependencyPolicy(prompt, policy) {
  if (policy.allowDependencyChange && !policy.lockfileReadOnly) {
    return prompt;
  }
  
  return `# Dependency Policy (MUST FOLLOW)

You are running in a restricted lane.

- allowDependencyChange: ${policy.allowDependencyChange}
- lockfileReadOnly: ${policy.lockfileReadOnly}

Rules:
- BEFORE making any code changes, decide whether dependency changes are required.
- If dependency changes are required, DO NOT change any files. Instead reply with:

DEPENDENCY_CHANGE_REQUIRED
\`\`\`json
{ "reason": "...", "changes": [...], "commands": ["pnpm add ..."], "notes": "..." }
\`\`\`

Then STOP.
- If dependency changes are NOT required, proceed normally.

---

${prompt}`;
}

/**
 * Apply file permissions based on dependency policy
 */
function applyDependencyFilePermissions(worktreeDir, policy) {
  const targets = [];
  
  if (!policy.allowDependencyChange) {
    targets.push('package.json');
  }
  
  if (policy.lockfileReadOnly) {
    targets.push('pnpm-lock.yaml', 'package-lock.json', 'yarn.lock');
  }
  
  for (const file of targets) {
    const filePath = path.join(worktreeDir, file);
    if (!fs.existsSync(filePath)) continue;
    
    try {
      const stats = fs.statSync(filePath);
      const mode = stats.mode & 0o777;
      fs.chmodSync(filePath, mode & ~0o222); // Remove write bits
    } catch {
      // Best effort
    }
  }
}

/**
 * Run a single task
 */
async function runTask({
  task,
  config,
  index,
  worktreeDir,
  pipelineBranch,
  taskBranch,
  chatId,
  runDir,
}) {
  const model = task.model || config.model || 'sonnet-4.5';
  const convoPath = path.join(runDir, 'conversation.jsonl');
  
  logger.section(`[${index + 1}/${config.tasks.length}] ${task.name}`);
  logger.info(`Model: ${model}`);
  logger.info(`Branch: ${taskBranch}`);
  
  // Checkout task branch
  git.runGit(['checkout', '-B', taskBranch], { cwd: worktreeDir });
  
  // Apply dependency permissions
  applyDependencyFilePermissions(worktreeDir, config.dependencyPolicy);
  
  // Run prompt
  const prompt1 = wrapPromptForDependencyPolicy(task.prompt, config.dependencyPolicy);
  
  appendLog(convoPath, createConversationEntry('user', prompt1, {
    task: task.name,
    model,
  }));
  
  logger.info('Sending prompt to agent...');
  const r1 = cursorAgentSend({
    workspaceDir: worktreeDir,
    chatId,
    prompt: prompt1,
    model,
  });
  
  appendLog(convoPath, createConversationEntry('assistant', r1.resultText || r1.error, {
    task: task.name,
    model,
  }));
  
  if (!r1.ok) {
    return {
      taskName: task.name,
      taskBranch,
      status: 'ERROR',
      error: r1.error,
    };
  }
  
  // Check for dependency request
  const depReq = extractDependencyRequest(r1.resultText);
  if (depReq.required && !config.dependencyPolicy.allowDependencyChange) {
    return {
      taskName: task.name,
      taskBranch,
      status: 'BLOCKED_DEPENDENCY',
      dependencyRequest: depReq.plan || null,
    };
  }
  
  // Push task branch
  git.push(taskBranch, { cwd: worktreeDir, setUpstream: true });
  
  return {
    taskName: task.name,
    taskBranch,
    status: 'FINISHED',
  };
}

/**
 * Run all tasks in sequence
 */
async function runTasks(config, runDir) {
  const { checkCursorAuth, printAuthHelp } = require('../utils/cursor-agent');
  
  // Ensure cursor-agent is installed
  ensureCursorAgent();
  
  // Check authentication before starting
  logger.info('Checking Cursor authentication...');
  const authStatus = checkCursorAuth();
  
  if (!authStatus.authenticated) {
    logger.error('❌ Cursor authentication failed');
    logger.error(`   ${authStatus.message}`);
    
    if (authStatus.details) {
      logger.error(`   Details: ${authStatus.details}`);
    }
    
    if (authStatus.help) {
      logger.error(`   ${authStatus.help}`);
    }
    
    console.log('');
    printAuthHelp();
    
    throw new Error('Cursor authentication required. Please authenticate and try again.');
  }
  
  logger.success('✓ Cursor authentication OK');
  
  const repoRoot = git.getRepoRoot();
  const pipelineBranch = config.pipelineBranch || `${config.branchPrefix}${Date.now().toString(36)}`;
  const worktreeDir = path.join(repoRoot, config.worktreeRoot || '_cursorflow/worktrees', pipelineBranch);
  
  logger.section('🚀 Starting Pipeline');
  logger.info(`Pipeline Branch: ${pipelineBranch}`);
  logger.info(`Worktree: ${worktreeDir}`);
  logger.info(`Tasks: ${config.tasks.length}`);
  
  // Create worktree
  git.createWorktree(worktreeDir, pipelineBranch, {
    baseBranch: config.baseBranch || 'main',
    cwd: repoRoot,
  });
  
  // Create chat
  logger.info('Creating chat session...');
  const chatId = cursorAgentCreateChat();
  
  // Save initial state
  const state = {
    status: 'running',
    pipelineBranch,
    worktreeDir,
    chatId,
    totalTasks: config.tasks.length,
    currentTaskIndex: 0,
  };
  
  saveState(path.join(runDir, 'state.json'), state);
  
  // Run tasks
  const results = [];
  
  for (let i = 0; i < config.tasks.length; i++) {
    const task = config.tasks[i];
    const taskBranch = `${pipelineBranch}--${String(i + 1).padStart(2, '0')}-${task.name}`;
    
    const result = await runTask({
      task,
      config,
      index: i,
      worktreeDir,
      pipelineBranch,
      taskBranch,
      chatId,
      runDir,
    });
    
    results.push(result);
    
    // Update state
    state.currentTaskIndex = i + 1;
    saveState(path.join(runDir, 'state.json'), state);
    
    // Handle blocked or error
    if (result.status === 'BLOCKED_DEPENDENCY') {
      state.status = 'blocked_dependency';
      state.dependencyRequest = result.dependencyRequest;
      saveState(path.join(runDir, 'state.json'), state);
      logger.warn('Task blocked on dependency change');
      process.exit(2);
    }
    
    if (result.status !== 'FINISHED') {
      state.status = 'failed';
      saveState(path.join(runDir, 'state.json'), state);
      logger.error(`Task failed: ${result.error}`);
      process.exit(1);
    }
    
    // Merge into pipeline
    logger.info(`Merging ${taskBranch} → ${pipelineBranch}`);
    git.merge(taskBranch, { cwd: worktreeDir, noFf: true });
    git.push(pipelineBranch, { cwd: worktreeDir });
  }
  
  // Complete
  state.status = 'completed';
  saveState(path.join(runDir, 'state.json'), state);
  
  logger.success('All tasks completed!');
  return results;
}

module.exports = {
  runTasks,
  runTask,
};

/**
 * CLI entry point
 */
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.error('Usage: node runner.js <tasks-file> --run-dir <dir> --executor <executor>');
    process.exit(1);
  }
  
  const tasksFile = args[0];
  const runDirIdx = args.indexOf('--run-dir');
  const executorIdx = args.indexOf('--executor');
  
  const runDir = runDirIdx >= 0 ? args[runDirIdx + 1] : '.';
  const executor = executorIdx >= 0 ? args[executorIdx + 1] : 'cursor-agent';
  
  if (!fs.existsSync(tasksFile)) {
    console.error(`Tasks file not found: ${tasksFile}`);
    process.exit(1);
  }
  
  // Load tasks configuration
  let config;
  try {
    config = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
  } catch (error) {
    console.error(`Failed to load tasks file: ${error.message}`);
    process.exit(1);
  }
  
  // Add dependency policy defaults
  config.dependencyPolicy = config.dependencyPolicy || {
    allowDependencyChange: false,
    lockfileReadOnly: true,
  };
  
  // Run tasks
  runTasks(config, runDir)
    .then(() => {
      process.exit(0);
    })
    .catch(error => {
      console.error(`Runner failed: ${error.message}`);
      if (process.env.DEBUG) {
        console.error(error.stack);
      }
      process.exit(1);
    });
}

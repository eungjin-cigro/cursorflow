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
 * Execute cursor-agent command
 */
function cursorAgentCreateChat() {
  const { execSync } = require('child_process');
  const out = execSync('cursor-agent create-chat', {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  const lines = out.split('\n').filter(Boolean);
  return lines[lines.length - 1] || null;
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
  
  const res = spawnSync('cursor-agent', args, {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  
  const json = parseJsonFromStdout(res.stdout);
  
  if (res.status !== 0 || !json || json.type !== 'result') {
    const msg = res.stderr?.trim() || res.stdout?.trim() || `exit=${res.status}`;
    return {
      ok: false,
      exitCode: res.status,
      error: msg,
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
  ensureCursorAgent();
  
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

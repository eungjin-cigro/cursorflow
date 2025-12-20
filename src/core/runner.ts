/**
 * Core Runner - Execute tasks sequentially in a lane
 * 
 * Adapted from sequential-agent-runner.js
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawnSync } from 'child_process';

import * as git from '../utils/git';
import * as logger from '../utils/logger';
import { ensureCursorAgent, checkCursorAuth, printAuthHelp } from '../utils/cursor-agent';
import { saveState, appendLog, createConversationEntry } from '../utils/state';
import { 
  RunnerConfig, 
  Task, 
  TaskExecutionResult, 
  AgentSendResult, 
  DependencyPolicy, 
  DependencyRequestPlan,
  LaneState
} from '../utils/types';

/**
 * Execute cursor-agent command with timeout and better error handling
 */
export function cursorAgentCreateChat(): string {
  try {
    const res = spawnSync('cursor-agent', ['create-chat'], {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 30000, // 30 second timeout
    });
    
    if (res.error || res.status !== 0) {
      throw res.error || new Error(res.stderr || 'Failed to create chat');
    }

    const out = res.stdout;
    const lines = out.split('\n').filter(Boolean);
    const chatId = lines[lines.length - 1] || null;
    
    if (!chatId) {
      throw new Error('Failed to get chat ID from cursor-agent');
    }
    
    logger.info(`Created chat session: ${chatId}`);
    return chatId;
  } catch (error: any) {
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

function parseJsonFromStdout(stdout: string): any {
  const text = String(stdout || '').trim();
  if (!text) return null;
  const lines = text.split('\n').filter(Boolean);
  
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (line?.startsWith('{') && line?.endsWith('}')) {
      try {
        return JSON.parse(line);
      } catch {
        continue;
      }
    }
  }
  return null;
}

export function cursorAgentSend({ workspaceDir, chatId, prompt, model }: { 
  workspaceDir: string; 
  chatId: string; 
  prompt: string; 
  model?: string; 
}): AgentSendResult {
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
    if ((res.error as any).code === 'ETIMEDOUT') {
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
      exitCode: res.status ?? -1,
      error: errorMsg,
    };
  }
  
  return {
    ok: !json.is_error,
    exitCode: res.status ?? 0,
    sessionId: json.session_id || chatId,
    resultText: json.result || '',
  };
}

/**
 * Extract dependency change request from agent response
 */
export function extractDependencyRequest(text: string): { required: boolean; plan?: DependencyRequestPlan; raw: string } {
  const t = String(text || '');
  const marker = 'DEPENDENCY_CHANGE_REQUIRED';
  
  if (!t.includes(marker)) {
    return { required: false, raw: t };
  }
  
  const after = t.split(marker).slice(1).join(marker);
  const match = after.match(/\{[\s\S]*?\}/);
  
  if (match) {
    try {
      return {
        required: true,
        plan: JSON.parse(match[0]!) as DependencyRequestPlan,
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
export function wrapPromptForDependencyPolicy(prompt: string, policy: DependencyPolicy): string {
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
export function applyDependencyFilePermissions(worktreeDir: string, policy: DependencyPolicy): void {
  const targets: string[] = [];
  
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
export async function runTask({
  task,
  config,
  index,
  worktreeDir,
  taskBranch,
  chatId,
  runDir,
}: {
  task: Task;
  config: RunnerConfig;
  index: number;
  worktreeDir: string;
  pipelineBranch: string;
  taskBranch: string;
  chatId: string;
  runDir: string;
}): Promise<TaskExecutionResult> {
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
  
  appendLog(convoPath, createConversationEntry('assistant', r1.resultText || r1.error || 'No response', {
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
  const depReq = extractDependencyRequest(r1.resultText || '');
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
export async function runTasks(tasksFile: string, config: RunnerConfig, runDir: string, options: { startIndex?: number } = {}): Promise<TaskExecutionResult[]> {
  const startIndex = options.startIndex || 0;
  
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
  
  // Load existing state if resuming
  const statePath = path.join(runDir, 'state.json');
  let state: LaneState | null = null;
  
  if (startIndex > 0 && fs.existsSync(statePath)) {
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  }
  
  const pipelineBranch = state?.pipelineBranch || config.pipelineBranch || `${config.branchPrefix || 'cursorflow/'}${Date.now().toString(36)}`;
  const worktreeDir = state?.worktreeDir || path.join(repoRoot, config.worktreeRoot || '_cursorflow/worktrees', pipelineBranch);
  
  if (startIndex === 0) {
    logger.section('🚀 Starting Pipeline');
  } else {
    logger.section(`🔁 Resuming Pipeline from task ${startIndex + 1}`);
  }
  
  logger.info(`Pipeline Branch: ${pipelineBranch}`);
  logger.info(`Worktree: ${worktreeDir}`);
  logger.info(`Tasks: ${config.tasks.length}`);
  
  // Create worktree only if starting fresh
  if (startIndex === 0 || !fs.existsSync(worktreeDir)) {
    git.createWorktree(worktreeDir, pipelineBranch, {
      baseBranch: config.baseBranch || 'main',
      cwd: repoRoot,
    });
  }
  
  // Create chat
  logger.info('Creating chat session...');
  const chatId = cursorAgentCreateChat();
  
  // Initialize state if not loaded
  if (!state) {
    state = {
      status: 'running',
      pipelineBranch,
      worktreeDir,
      totalTasks: config.tasks.length,
      currentTaskIndex: 0,
      label: pipelineBranch,
      startTime: Date.now(),
      endTime: null,
      error: null,
      dependencyRequest: null,
      tasksFile, // Store tasks file for resume
    };
  } else {
    state.status = 'running';
    state.error = null;
    state.dependencyRequest = null;
  }
  
  saveState(statePath, state);
  
  // Run tasks
  const results: TaskExecutionResult[] = [];
  
  for (let i = startIndex; i < config.tasks.length; i++) {
    const task = config.tasks[i]!;
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
    saveState(statePath, state);
    
    // Handle blocked or error
    if (result.status === 'BLOCKED_DEPENDENCY') {
      state.status = 'failed';
      state.dependencyRequest = result.dependencyRequest || null;
      saveState(statePath, state);
      logger.warn('Task blocked on dependency change');
      process.exit(2);
    }
    
    if (result.status !== 'FINISHED') {
      state.status = 'failed';
      state.error = result.error || 'Unknown error';
      saveState(statePath, state);
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
  state.endTime = Date.now();
  saveState(statePath, state);
  
  logger.success('All tasks completed!');
  return results;
}

/**
 * CLI entry point
 */
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.error('Usage: node runner.js <tasks-file> --run-dir <dir> --executor <executor>');
    process.exit(1);
  }
  
  const tasksFile = args[0]!;
  const runDirIdx = args.indexOf('--run-dir');
  const startIdxIdx = args.indexOf('--start-index');
  // const executorIdx = args.indexOf('--executor');
  
  const runDir = runDirIdx >= 0 ? args[runDirIdx + 1]! : '.';
  const startIndex = startIdxIdx >= 0 ? parseInt(args[startIdxIdx + 1] || '0') : 0;
  // const executor = executorIdx >= 0 ? args[executorIdx + 1] : 'cursor-agent';
  
  if (!fs.existsSync(tasksFile)) {
    console.error(`Tasks file not found: ${tasksFile}`);
    process.exit(1);
  }
  
  // Load tasks configuration
  let config: RunnerConfig;
  try {
    config = JSON.parse(fs.readFileSync(tasksFile, 'utf8')) as RunnerConfig;
  } catch (error: any) {
    console.error(`Failed to load tasks file: ${error.message}`);
    process.exit(1);
  }
  
  // Add dependency policy defaults
  config.dependencyPolicy = config.dependencyPolicy || {
    allowDependencyChange: false,
    lockfileReadOnly: true,
  };
  
  // Run tasks
  runTasks(tasksFile, config, runDir, { startIndex })
    .then(() => {
      process.exit(0);
    })
    .catch(error => {
      console.error(`Runner failed: ${error.message}`);
      if (process.env['DEBUG']) {
        console.error(error.stack);
      }
      process.exit(1);
    });
}

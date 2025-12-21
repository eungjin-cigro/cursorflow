/**
 * Core Runner - Execute tasks sequentially in a lane
 * 
 * Adapted from sequential-agent-runner.js
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawn, spawnSync } from 'child_process';

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

/** Default timeout: 5 minutes */
const DEFAULT_TIMEOUT_MS = 300000;

/** Heartbeat interval: 30 seconds */
const HEARTBEAT_INTERVAL_MS = 30000;

/**
 * Validate task configuration
 * @throws Error if validation fails
 */
export function validateTaskConfig(config: RunnerConfig): void {
  if (!config.tasks || !Array.isArray(config.tasks)) {
    throw new Error('Invalid config: "tasks" must be an array');
  }
  
  if (config.tasks.length === 0) {
    throw new Error('Invalid config: "tasks" array is empty');
  }
  
  for (let i = 0; i < config.tasks.length; i++) {
    const task = config.tasks[i];
    const taskNum = i + 1;
    
    if (!task) {
      throw new Error(`Invalid config: Task ${taskNum} is null or undefined`);
    }
    
    if (!task.name || typeof task.name !== 'string') {
      throw new Error(
        `Invalid config: Task ${taskNum} missing required "name" field.\n` +
        `  Found: ${JSON.stringify(task, null, 2).substring(0, 200)}...\n` +
        `  Expected: { "name": "task-name", "prompt": "..." }`
      );
    }
    
    if (!task.prompt || typeof task.prompt !== 'string') {
      throw new Error(
        `Invalid config: Task "${task.name}" (${taskNum}) missing required "prompt" field`
      );
    }
    
    // Validate task name format (no spaces, special chars that could break branch names)
    if (!/^[a-zA-Z0-9_-]+$/.test(task.name)) {
      throw new Error(
        `Invalid config: Task name "${task.name}" contains invalid characters.\n` +
        `  Task names must only contain: letters, numbers, underscore (_), hyphen (-)`
      );
    }
  }
  
  // Validate timeout if provided
  if (config.timeout !== undefined) {
    if (typeof config.timeout !== 'number' || config.timeout <= 0) {
      throw new Error(
        `Invalid config: "timeout" must be a positive number (milliseconds).\n` +
        `  Found: ${config.timeout}`
      );
    }
  }
}

/**
 * Execute cursor-agent command with streaming and better error handling
 */
export async function cursorAgentSend({ workspaceDir, chatId, prompt, model, signalDir, timeout, enableIntervention }: { 
  workspaceDir: string; 
  chatId: string; 
  prompt: string; 
  model?: string; 
  signalDir?: string;
  timeout?: number;
  /** Enable stdin piping for intervention feature (may cause buffering issues on some systems) */
  enableIntervention?: boolean;
}): Promise<AgentSendResult> {
  const args = [
    '--print',
    '--output-format', 'json',
    '--workspace', workspaceDir,
    ...(model ? ['--model', model] : []),
    '--resume', chatId,
    prompt,
  ];
  
  const timeoutMs = timeout || DEFAULT_TIMEOUT_MS;
  logger.info(`Executing cursor-agent... (timeout: ${Math.round(timeoutMs / 1000)}s)`);
  
  // Determine stdio mode based on intervention setting
  // When intervention is enabled, we pipe stdin for message injection
  // When disabled (default), we ignore stdin to avoid buffering issues
  const stdinMode = enableIntervention ? 'pipe' : 'ignore';
  
  if (enableIntervention) {
    logger.info('Intervention mode enabled (stdin piped)');
  }
  
  return new Promise((resolve) => {
    // Build environment, preserving user's NODE_OPTIONS but disabling problematic flags
    const childEnv = { ...process.env };
    
    // Only filter out specific problematic NODE_OPTIONS, don't clear entirely
    if (childEnv.NODE_OPTIONS) {
      // Remove flags that might interfere with cursor-agent
      const filtered = childEnv.NODE_OPTIONS
        .split(' ')
        .filter(opt => !opt.includes('--inspect') && !opt.includes('--debug'))
        .join(' ');
      childEnv.NODE_OPTIONS = filtered;
    }
    
    // Disable Python buffering in case cursor-agent uses Python
    childEnv.PYTHONUNBUFFERED = '1';
    
    const child = spawn('cursor-agent', args, {
      stdio: [stdinMode, 'pipe', 'pipe'],
      env: childEnv,
    });

    // Save PID to state if possible
    if (child.pid && signalDir) {
      try {
        const statePath = path.join(signalDir, 'state.json');
        if (fs.existsSync(statePath)) {
          const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
          state.pid = child.pid;
          fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
        }
      } catch (e) {
        // Best effort
      }
    }

    let fullStdout = '';
    let fullStderr = '';

    // Heartbeat logging to show progress
    let lastHeartbeat = Date.now();
    let bytesReceived = 0;
    const heartbeatInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - lastHeartbeat) / 1000);
      const totalElapsed = Math.round((Date.now() - startTime) / 1000);
      logger.info(`⏱ Heartbeat: ${totalElapsed}s elapsed, ${bytesReceived} bytes received`);
    }, HEARTBEAT_INTERVAL_MS);
    const startTime = Date.now();

    // Watch for "intervention.txt" signal file if any
    const interventionPath = signalDir ? path.join(signalDir, 'intervention.txt') : null;
    let interventionWatcher: fs.FSWatcher | null = null;

    if (interventionPath && fs.existsSync(path.dirname(interventionPath))) {
      interventionWatcher = fs.watch(path.dirname(interventionPath), (event, filename) => {
        if (filename === 'intervention.txt' && fs.existsSync(interventionPath)) {
          try {
            const message = fs.readFileSync(interventionPath, 'utf8').trim();
            if (message) {
              if (enableIntervention && child.stdin) {
                logger.info(`Injecting intervention: ${message}`);
                child.stdin.write(message + '\n');
              } else {
                logger.warn(`Intervention requested but stdin not available: ${message}`);
                logger.warn('To enable intervention, set enableIntervention: true in config');
              }
              fs.unlinkSync(interventionPath); // Clear it
            }
          } catch (e) {
            logger.warn('Failed to read intervention file');
          }
        }
      });
    }

    if (child.stdout) {
      child.stdout.on('data', (data) => {
        const str = data.toString();
        fullStdout += str;
        bytesReceived += data.length;
        // Also pipe to our own stdout so it goes to terminal.log
        process.stdout.write(data);
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (data) => {
        fullStderr += data.toString();
        // Pipe to our own stderr so it goes to terminal.log
        process.stderr.write(data);
      });
    }

    const timeoutHandle = setTimeout(() => {
      clearInterval(heartbeatInterval);
      child.kill();
      const timeoutSec = Math.round(timeoutMs / 1000);
      resolve({
        ok: false,
        exitCode: -1,
        error: `cursor-agent timed out after ${timeoutSec} seconds. The LLM request may be taking too long or there may be network issues.`,
      });
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timeoutHandle);
      clearInterval(heartbeatInterval);
      if (interventionWatcher) interventionWatcher.close();
      
      const json = parseJsonFromStdout(fullStdout);
      
      if (code !== 0 || !json || json.type !== 'result') {
        let errorMsg = fullStderr.trim() || fullStdout.trim() || `exit=${code}`;
        
        // Check for common errors
        if (errorMsg.includes('not authenticated') || errorMsg.includes('login') || errorMsg.includes('auth')) {
          errorMsg = 'Authentication error. Please sign in to Cursor IDE.';
        } else if (errorMsg.includes('rate limit') || errorMsg.includes('quota')) {
          errorMsg = 'API rate limit or quota exceeded.';
        } else if (errorMsg.includes('model')) {
          errorMsg = `Model error (requested: ${model || 'default'}). Check your subscription.`;
        }
        
        resolve({
          ok: false,
          exitCode: code ?? -1,
          error: errorMsg,
        });
      } else {
        resolve({
          ok: !json.is_error,
          exitCode: code ?? 0,
          sessionId: json.session_id || chatId,
          resultText: json.result || '',
        });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeoutHandle);
      clearInterval(heartbeatInterval);
      resolve({
        ok: false,
        exitCode: -1,
        error: `Failed to start cursor-agent: ${err.message}`,
      });
    });
  });
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
  const r1 = await cursorAgentSend({
    workspaceDir: worktreeDir,
    chatId,
    prompt: prompt1,
    model,
    signalDir: runDir,
    timeout: config.timeout,
    enableIntervention: config.enableIntervention,
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
  
  // Validate configuration before starting
  logger.info('Validating task configuration...');
  try {
    validateTaskConfig(config);
    logger.success('✓ Configuration valid');
  } catch (validationError: any) {
    logger.error('❌ Configuration validation failed');
    logger.error(`   ${validationError.message}`);
    throw validationError;
  }
  
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
      dependsOn: config.dependsOn || [],
    };
  } else {
    state.status = 'running';
    state.error = null;
    state.dependencyRequest = null;
    state.dependsOn = config.dependsOn || [];
  }
  
  saveState(statePath, state);
  
  // Merge dependencies if any
  if (startIndex === 0 && config.dependsOn && config.dependsOn.length > 0) {
    logger.section('🔗 Merging Dependencies');
    
    // The runDir for the lane is passed in. Dependencies are in ../<depName> relative to this runDir
    const lanesRoot = path.dirname(runDir);
    
    for (const depName of config.dependsOn) {
      const depRunDir = path.join(lanesRoot, depName);
      const depStatePath = path.join(depRunDir, 'state.json');
      
      if (!fs.existsSync(depStatePath)) {
        logger.warn(`Dependency state not found for ${depName} at ${depStatePath}`);
        continue;
      }
      
      try {
        const depState = JSON.parse(fs.readFileSync(depStatePath, 'utf8')) as LaneState;
        if (depState.status !== 'completed') {
          logger.warn(`Dependency ${depName} is in status ${depState.status}, merge might be incomplete`);
        }
        
        if (depState.pipelineBranch) {
          logger.info(`Merging dependency branch: ${depState.pipelineBranch} (${depName})`);
          
          // Fetch first to ensure we have the branch
          git.runGit(['fetch', 'origin', depState.pipelineBranch], { cwd: worktreeDir, silent: true });
          
          // Merge
          git.merge(depState.pipelineBranch, { 
            cwd: worktreeDir, 
            noFf: true, 
            message: `chore: merge dependency ${depName} (${depState.pipelineBranch})` 
          });
        }
      } catch (e) {
        logger.error(`Failed to merge dependency ${depName}: ${e}`);
      }
    }
    
    // Push the merged state
    git.push(pipelineBranch, { cwd: worktreeDir });
  }
  
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

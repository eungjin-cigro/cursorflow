/**
 * Core Runner - Execute tasks sequentially in a lane
 * 
 * Features:
 * - Enhanced retry with circuit breaker
 * - Checkpoint system for recovery
 * - State validation and repair
 * - Improved dependency management
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawn, spawnSync } from 'child_process';

import * as git from '../utils/git';
import * as logger from '../utils/logger';
import { ensureCursorAgent, checkCursorAuth, printAuthHelp } from '../utils/cursor-agent';
import { saveState, appendLog, createConversationEntry, loadState, validateLaneState, repairLaneState, stateNeedsRecovery } from '../utils/state';
import { events } from '../utils/events';
import { loadConfig } from '../utils/config';
import { registerWebhooks } from '../utils/webhook';
import { runReviewLoop } from './reviewer';
import { safeJoin } from '../utils/path';
import { analyzeFailure, RecoveryAction, logFailure, withRetry } from './failure-policy';
import { withEnhancedRetry, getCircuitBreaker, isTransientError } from '../utils/retry';
import { createCheckpoint, getLatestCheckpoint, restoreFromCheckpoint } from '../utils/checkpoint';
import { waitForTaskDependencies as waitForDeps, DependencyWaitOptions } from '../utils/dependency';
import { preflightCheck, printPreflightReport } from '../utils/health';
import { 
  RunnerConfig, 
  Task, 
  TaskExecutionResult, 
  AgentSendResult, 
  DependencyPolicy, 
  DependencyRequestPlan,
  LaneState
} from '../types';

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

/** Default timeout: 10 minutes */
const DEFAULT_TIMEOUT_MS = 600000;

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
 * Internal: Execute cursor-agent command with streaming
 */
async function cursorAgentSendRaw({ workspaceDir, chatId, prompt, model, signalDir, timeout, enableIntervention, outputFormat, taskName }: { 
  workspaceDir: string; 
  chatId: string; 
  prompt: string; 
  model?: string; 
  signalDir?: string;
  timeout?: number;
  enableIntervention?: boolean;
  outputFormat?: 'stream-json' | 'json' | 'plain';
  taskName?: string;
}): Promise<AgentSendResult> {
  // Use stream-json format for structured output with tool calls and results
  const format = outputFormat || 'stream-json';
  const args = [
    '--print',
    '--force',
    '--approve-mcps',
    '--output-format', format,
    '--workspace', workspaceDir,
    ...(model ? ['--model', model] : []),
    '--resume', chatId,
    prompt,
  ];
  
  const timeoutMs = timeout || DEFAULT_TIMEOUT_MS;
  
  // Determine stdio mode based on intervention setting
  const stdinMode = enableIntervention ? 'pipe' : 'ignore';
  
  return new Promise((resolve) => {
    // Build environment, preserving user's NODE_OPTIONS but disabling problematic flags
    const childEnv = { ...process.env };
    
    if (childEnv.NODE_OPTIONS) {
      const filtered = childEnv.NODE_OPTIONS
        .split(' ')
        .filter(opt => !opt.includes('--inspect') && !opt.includes('--debug'))
        .join(' ');
      childEnv.NODE_OPTIONS = filtered;
    }
    
    childEnv.PYTHONUNBUFFERED = '1';
    
    const child = spawn('cursor-agent', args, {
      stdio: [stdinMode, 'pipe', 'pipe'],
      env: childEnv,
    });

    // Save PID to state if possible
    if (child.pid && signalDir) {
      try {
        const statePath = safeJoin(signalDir, 'state.json');
        const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        state.pid = child.pid;
        fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
      } catch {
        // Best effort
      }
    }

    let fullStdout = '';
    let fullStderr = '';
    let timeoutHandle: NodeJS.Timeout;

    // Heartbeat logging
    let lastHeartbeat = Date.now();
    let bytesReceived = 0;
    const startTime = Date.now();
    const heartbeatInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - lastHeartbeat) / 1000);
      const totalElapsed = Math.round((Date.now() - startTime) / 1000);
      // Output without timestamp - orchestrator will add it
      console.log(`⏱ Heartbeat: ${totalElapsed}s elapsed, ${bytesReceived} bytes received`);
    }, HEARTBEAT_INTERVAL_MS);

    // Signal watchers (intervention, timeout)
    const interventionPath = signalDir ? path.join(signalDir, 'intervention.txt') : null;
    const timeoutPath = signalDir ? path.join(signalDir, 'timeout.txt') : null;
    let signalWatcher: fs.FSWatcher | null = null;

    if (signalDir && fs.existsSync(signalDir)) {
      signalWatcher = fs.watch(signalDir, (event, filename) => {
        if (filename === 'intervention.txt' && interventionPath && fs.existsSync(interventionPath)) {
          try {
            const message = fs.readFileSync(interventionPath, 'utf8').trim();
            if (message) {
              if (enableIntervention && child.stdin) {
                logger.info(`Injecting intervention: ${message}`);
                child.stdin.write(message + '\n');
                
                // Log to conversation history for visibility in monitor/logs
                if (signalDir) {
                  const convoPath = path.join(signalDir, 'conversation.jsonl');
                  appendLog(convoPath, createConversationEntry('intervention', `[HUMAN INTERVENTION]: ${message}`, {
                    task: taskName || 'AGENT_TURN',
                    model: 'manual'
                  }));
                }
              } else {
                logger.warn(`Intervention requested but stdin not available: ${message}`);
              }
              fs.unlinkSync(interventionPath);
            }
          } catch {}
        }
        
        if (filename === 'timeout.txt' && timeoutPath && fs.existsSync(timeoutPath)) {
          try {
            const newTimeoutStr = fs.readFileSync(timeoutPath, 'utf8').trim();
            const newTimeoutMs = parseInt(newTimeoutStr);
            if (!isNaN(newTimeoutMs) && newTimeoutMs > 0) {
              logger.info(`⏱ Dynamic timeout update: ${Math.round(newTimeoutMs / 1000)}s`);
              if (timeoutHandle) clearTimeout(timeoutHandle);
              const elapsed = Date.now() - startTime;
              const remaining = Math.max(1000, newTimeoutMs - elapsed);
              timeoutHandle = setTimeout(() => {
                clearInterval(heartbeatInterval);
                child.kill();
                resolve({ ok: false, exitCode: -1, error: `cursor-agent timed out after updated limit.` });
              }, remaining);
              fs.unlinkSync(timeoutPath);
            }
          } catch {}
        }
      });
    }

    if (child.stdout) {
      child.stdout.on('data', (data) => {
        fullStdout += data.toString();
        bytesReceived += data.length;
        process.stdout.write(data);
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (data) => {
        fullStderr += data.toString();
        process.stderr.write(data);
      });
    }

    timeoutHandle = setTimeout(() => {
      clearInterval(heartbeatInterval);
      child.kill();
      resolve({
        ok: false,
        exitCode: -1,
        error: `cursor-agent timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
      });
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timeoutHandle);
      clearInterval(heartbeatInterval);
      if (signalWatcher) signalWatcher.close();
      
      const json = parseJsonFromStdout(fullStdout);
      
      if (code !== 0 || !json || json.type !== 'result') {
        let errorMsg = fullStderr.trim() || fullStdout.trim() || `exit=${code}`;
        resolve({ ok: false, exitCode: code ?? -1, error: errorMsg });
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
      resolve({ ok: false, exitCode: -1, error: `Failed to start cursor-agent: ${err.message}` });
    });
  });
}

/**
 * Execute cursor-agent command with retries for transient errors
 */
export async function cursorAgentSend(options: { 
  workspaceDir: string; 
  chatId: string; 
  prompt: string; 
  model?: string; 
  signalDir?: string;
  timeout?: number;
  enableIntervention?: boolean;
  outputFormat?: 'stream-json' | 'json' | 'plain';
  taskName?: string;
}): Promise<AgentSendResult> {
  const laneName = options.signalDir ? path.basename(path.dirname(options.signalDir)) : 'agent';
  
  return withRetry(
    laneName,
    () => cursorAgentSendRaw(options),
    (res) => ({ ok: res.ok, error: res.error }),
    { maxRetries: 3 }
  );
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
 * Inter-task state file name
 */
const LANE_STATE_FILE = '_cursorflow/lane-state.json';

/**
 * Dependency request file name - agent writes here when dependency changes are needed
 */
const DEPENDENCY_REQUEST_FILE = '_cursorflow/dependency-request.json';

/**
 * Read dependency request from file if it exists
 */
export function readDependencyRequestFile(worktreeDir: string): { required: boolean; plan?: DependencyRequestPlan } {
  const filePath = safeJoin(worktreeDir, DEPENDENCY_REQUEST_FILE);
  
  if (!fs.existsSync(filePath)) {
    return { required: false };
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const plan = JSON.parse(content) as DependencyRequestPlan;
    
    // Validate required fields
    if (plan.reason && Array.isArray(plan.commands) && plan.commands.length > 0) {
      logger.info(`📦 Dependency request file detected: ${filePath}`);
      return { required: true, plan };
    }
    
    logger.warn(`Invalid dependency request file format: ${filePath}`);
    return { required: false };
  } catch (e) {
    logger.warn(`Failed to parse dependency request file: ${e}`);
    return { required: false };
  }
}

/**
 * Clear dependency request file after processing
 */
export function clearDependencyRequestFile(worktreeDir: string): void {
  const filePath = safeJoin(worktreeDir, DEPENDENCY_REQUEST_FILE);
  
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      logger.info(`🗑️ Cleared dependency request file: ${filePath}`);
    } catch (e) {
      logger.warn(`Failed to clear dependency request file: ${e}`);
    }
  }
}

/**
 * Wrap prompt with dependency policy instructions (legacy, used by tests)
 */
export function wrapPromptForDependencyPolicy(prompt: string, policy: DependencyPolicy): string {
  if (policy.allowDependencyChange && !policy.lockfileReadOnly) {
    return prompt;
  }
  
  let wrapped = `### 📦 Dependency Policy\n`;
  wrapped += `- allowDependencyChange: ${policy.allowDependencyChange}\n`;
  wrapped += `- lockfileReadOnly: ${policy.lockfileReadOnly}\n\n`;
  wrapped += prompt;
  
  return wrapped;
}

/**
 * Wrap prompt with global context, dependency policy, and worktree instructions
 */
export function wrapPrompt(
  prompt: string, 
  config: RunnerConfig, 
  options: { 
    noGit?: boolean; 
    isWorktree?: boolean;
    previousState?: string | null;
  } = {}
): string {
  const { noGit = false, isWorktree = true, previousState = null } = options;
  
  // 1. PREFIX: Environment & Worktree context
  let wrapped = `### 🛠 Environment & Context\n`;
  wrapped += `- **Workspace**: 당신은 독립된 **Git 워크트리** (프로젝트 루트)에서 작업 중입니다.\n`;
  wrapped += `- **Path Rule**: 모든 파일 참조 및 터미널 명령어는 **현재 디렉토리(./)**를 기준으로 하세요.\n`;
  
  if (isWorktree) {
    wrapped += `- **File Availability**: Git 추적 파일만 존재합니다. (node_modules, .env 등은 기본적으로 없음)\n`;
  }

  // 2. Previous Task State (if available)
  if (previousState) {
    wrapped += `\n### 💡 Previous Task State\n`;
    wrapped += `이전 태스크에서 전달된 상태 정보입니다:\n`;
    wrapped += `\`\`\`json\n${previousState}\n\`\`\`\n`;
  }
  
  // 3. Dependency Policy (Integrated)
  const policy = config.dependencyPolicy;
  wrapped += `\n### 📦 Dependency Policy\n`;
  wrapped += `- allowDependencyChange: ${policy.allowDependencyChange}\n`;
  wrapped += `- lockfileReadOnly: ${policy.lockfileReadOnly}\n`;
  
  if (noGit) {
    wrapped += `- NO_GIT_MODE: Git 명령어를 사용하지 마세요. 파일 수정만 가능합니다.\n`;
  }

  wrapped += `\n**📦 Dependency Change Rules:**\n`;
  wrapped += `1. 코드를 수정하기 전, 의존성 변경이 필요한지 **먼저** 판단하세요.\n`;
  wrapped += `2. 의존성 변경이 필요하다면:\n`;
  wrapped += `   - **다른 파일을 절대 수정하지 마세요.**\n`;
  wrapped += `   - 아래 JSON을 \`./${DEPENDENCY_REQUEST_FILE}\` 파일에 저장하세요:\n`;
  wrapped += `     \`\`\`json\n`;
  wrapped += `     {\n`;
  wrapped += `       "reason": "왜 이 의존성이 필요한지 설명",\n`;
  wrapped += `       "changes": ["add lodash@^4.17.21", "remove unused-pkg"],\n`;
  wrapped += `       "commands": ["pnpm add lodash@^4.17.21", "pnpm remove unused-pkg"],\n`;
  wrapped += `       "notes": "추가 참고사항 (선택)"  \n`;
  wrapped += `     }\n`;
  wrapped += `     \`\`\`\n`;
  wrapped += `   - 파일 저장 후 **즉시 작업을 종료**하세요. 오케스트레이터가 처리합니다.\n`;
  wrapped += `3. 의존성 변경이 불필요하면 바로 본 작업을 진행하세요.\n`;

  wrapped += `\n---\n\n${prompt}\n\n---\n`;

  // 4. SUFFIX: Task Completion & Git Requirements
  wrapped += `\n### 📝 Task Completion Requirements\n`;
  wrapped += `**반드시 다음 순서로 작업을 마무리하세요:**\n\n`;
  
  if (!noGit) {
    wrapped += `1. **Git Commit & Push** (필수!):\n`;
    wrapped += `   \`\`\`bash\n`;
    wrapped += `   git add -A\n`;
    wrapped += `   git commit -m "feat: <작업 내용 요약>"\n`;
    wrapped += `   git push origin HEAD\n`;
    wrapped += `   \`\`\`\n`;
    wrapped += `   ⚠️ 커밋과 푸시 없이 작업을 종료하면 변경사항이 손실됩니다!\n\n`;
  }
  
  wrapped += `2. **State Passing**: 다음 태스크로 전달할 정보가 있다면 \`./${LANE_STATE_FILE}\`에 JSON으로 저장하세요.\n\n`;
  wrapped += `3. **Summary**: 작업 완료 후 다음을 요약해 주세요:\n`;
  wrapped += `   - 생성/수정된 파일 목록\n`;
  wrapped += `   - 주요 변경 사항\n`;
  wrapped += `   - 커밋 해시 (git log --oneline -1)\n\n`;
  wrapped += `4. 지시된 문서(docs/...)를 찾을 수 없다면 즉시 보고하세요.\n`;

  return wrapped;
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
    const filePath = safeJoin(worktreeDir, file);
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
 * Wait for task-level dependencies to be completed by other lanes
 * Now uses the enhanced dependency module with timeout support
 */
export async function waitForTaskDependencies(
  deps: string[], 
  runDir: string,
  options: DependencyWaitOptions = {}
): Promise<void> {
  if (!deps || deps.length === 0) return;

  const lanesRoot = path.dirname(runDir);
  
  const result = await waitForDeps(deps, lanesRoot, {
    timeoutMs: options.timeoutMs || 30 * 60 * 1000, // 30 minutes default
    pollIntervalMs: options.pollIntervalMs || 5000,
    onTimeout: options.onTimeout || 'fail',
    onProgress: (pending, completed) => {
      if (completed.length > 0) {
        logger.info(`Dependencies progress: ${completed.length}/${deps.length} completed`);
      }
    },
  });
  
  if (!result.success) {
    if (result.timedOut) {
      throw new Error(`Dependency wait timed out after ${Math.round(result.elapsedMs / 1000)}s. Pending: ${result.failedDependencies.join(', ')}`);
    }
    throw new Error(`Dependencies failed: ${result.failedDependencies.join(', ')}`);
  }
}

/**
 * Merge branches from dependency lanes with safe merge
 */
export async function mergeDependencyBranches(deps: string[], runDir: string, worktreeDir: string): Promise<void> {
  if (!deps || deps.length === 0) return;

  const lanesRoot = path.dirname(runDir);
  const lanesToMerge = new Set(deps.map(d => d.split(':')[0]!));

  for (const laneName of lanesToMerge) {
    const depStatePath = safeJoin(lanesRoot, laneName, 'state.json');
    if (!fs.existsSync(depStatePath)) continue;

    try {
      const state = loadState<LaneState>(depStatePath);
      if (!state?.pipelineBranch) continue;
      
      logger.info(`Merging branch from ${laneName}: ${state.pipelineBranch}`);
      
      // Ensure we have the latest
      git.runGit(['fetch', 'origin', state.pipelineBranch], { cwd: worktreeDir, silent: true });
      
      // Use safe merge with conflict detection
      const mergeResult = git.safeMerge(state.pipelineBranch, {
        cwd: worktreeDir,
        noFf: true,
        message: `chore: merge task dependency from ${laneName}`,
        abortOnConflict: true,
      });
      
      if (!mergeResult.success) {
        if (mergeResult.conflict) {
          logger.error(`Merge conflict with ${laneName}: ${mergeResult.conflictingFiles.join(', ')}`);
          throw new Error(`Merge conflict: ${mergeResult.conflictingFiles.join(', ')}`);
        }
        throw new Error(mergeResult.error || 'Merge failed');
      }
      
      logger.success(`✓ Merged ${laneName}`);
    } catch (e) {
      logger.error(`Failed to merge branch from ${laneName}: ${e}`);
      throw e;
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
  pipelineBranch,
  taskBranch,
  chatId,
  runDir,
  noGit = false,
}: {
  task: Task;
  config: RunnerConfig;
  index: number;
  worktreeDir: string;
  pipelineBranch: string;
  taskBranch: string;
  chatId: string;
  runDir: string;
  noGit?: boolean;
}): Promise<TaskExecutionResult> {
  const model = task.model || config.model || 'sonnet-4.5';
  const timeout = task.timeout || config.timeout;
  const convoPath = safeJoin(runDir, 'conversation.jsonl');
  
  logger.section(`[${index + 1}/${config.tasks.length}] ${task.name}`);
  logger.info(`Model: ${model}`);
  if (noGit) {
    logger.info('🚫 noGit mode: skipping branch operations');
  } else {
    logger.info(`Branch: ${taskBranch}`);
  }
  
  events.emit('task.started', {
    taskName: task.name,
    taskBranch,
    index,
  });

  // Checkout task branch (skip in noGit mode)
  if (!noGit) {
    git.runGit(['checkout', '-B', taskBranch], { cwd: worktreeDir });
  }
  
  // Apply dependency permissions
  applyDependencyFilePermissions(worktreeDir, config.dependencyPolicy);
  
  // Read previous task state if available
  let previousState: string | null = null;
  const stateFilePath = safeJoin(worktreeDir, LANE_STATE_FILE);
  if (fs.existsSync(stateFilePath)) {
    try {
      previousState = fs.readFileSync(stateFilePath, 'utf8');
      logger.info('Loaded previous task state from _cursorflow/lane-state.json');
    } catch (e) {
      logger.warn(`Failed to read inter-task state: ${e}`);
    }
  }

  // Wrap prompt with context, previous state, and completion instructions
  const wrappedPrompt = wrapPrompt(task.prompt, config, { 
    noGit, 
    isWorktree: !noGit,
    previousState
  });
  
  // Log ONLY the original prompt to keep logs clean
  appendLog(convoPath, createConversationEntry('user', task.prompt, {
    task: task.name,
    model,
  }));
  
  logger.info('Sending prompt to agent...');
  const startTime = Date.now();
  events.emit('agent.prompt_sent', {
    taskName: task.name,
    model,
    promptLength: wrappedPrompt.length,
  });

  const r1 = await cursorAgentSend({
    workspaceDir: worktreeDir,
    chatId,
    prompt: wrappedPrompt,
    model,
    signalDir: runDir,
    timeout,
    enableIntervention: config.enableIntervention,
    outputFormat: config.agentOutputFormat,
    taskName: task.name,
  });
  
  const duration = Date.now() - startTime;
  events.emit('agent.response_received', {
    taskName: task.name,
    ok: r1.ok,
    duration,
    responseLength: r1.resultText?.length || 0,
    error: r1.error,
  });

  appendLog(convoPath, createConversationEntry('assistant', r1.resultText || r1.error || 'No response', {
    task: task.name,
    model,
  }));
  
  if (!r1.ok) {
    events.emit('task.failed', {
      taskName: task.name,
      taskBranch,
      error: r1.error,
    });
    return {
      taskName: task.name,
      taskBranch,
      status: 'ERROR',
      error: r1.error,
    };
  }
  
  // Check for dependency request (file-based takes priority, then text-based)
  const fileDepReq = readDependencyRequestFile(worktreeDir);
  const textDepReq = extractDependencyRequest(r1.resultText || '');
  
  // Determine which request to use (file-based is preferred as it's more structured)
  const depReq = fileDepReq.required ? fileDepReq : textDepReq;
  
  if (depReq.required) {
    logger.info(`📦 Dependency change requested: ${depReq.plan?.reason || 'No reason provided'}`);
    
    if (depReq.plan) {
      logger.info(`   Commands: ${depReq.plan.commands.join(', ')}`);
    }
    
    if (!config.dependencyPolicy.allowDependencyChange) {
      // Clear the file so it doesn't persist after resolution
      clearDependencyRequestFile(worktreeDir);
      
      return {
        taskName: task.name,
        taskBranch,
        status: 'BLOCKED_DEPENDENCY',
        dependencyRequest: depReq.plan || null,
      };
    }
  }
  
  // Push task branch (skip in noGit mode)
  if (!noGit) {
    git.push(taskBranch, { cwd: worktreeDir, setUpstream: true });
  }

  // Automatic Review
  const reviewEnabled = config.reviewAllTasks || task.acceptanceCriteria?.length || config.enableReview;
  
  if (reviewEnabled) {
    logger.section(`🔍 Reviewing Task: ${task.name}`);
    const reviewResult = await runReviewLoop({
      taskResult: {
        taskName: task.name,
        taskBranch: taskBranch,
        acceptanceCriteria: task.acceptanceCriteria,
      },
      worktreeDir,
      runDir,
      config,
      workChatId: chatId,
      model, // Use the same model as requested
      cursorAgentSend,
      cursorAgentCreateChat,
    });

    if (!reviewResult.approved) {
      logger.error(`❌ Task review failed after ${reviewResult.iterations} iterations`);
      return {
        taskName: task.name,
        taskBranch,
        status: 'ERROR',
        error: reviewResult.error || 'Task failed to pass review criteria',
      };
    }
  }
  
  events.emit('task.completed', {
    taskName: task.name,
    taskBranch,
    status: 'FINISHED',
  });

  return {
    taskName: task.name,
    taskBranch,
    status: 'FINISHED',
  };
}

/**
 * Run all tasks in sequence
 */
export async function runTasks(tasksFile: string, config: RunnerConfig, runDir: string, options: { startIndex?: number; noGit?: boolean; skipPreflight?: boolean } = {}): Promise<TaskExecutionResult[]> {
  const startIndex = options.startIndex || 0;
  const noGit = options.noGit || config.noGit || false;
  
  if (noGit) {
    logger.info('🚫 Running in noGit mode - Git operations will be skipped');
  }
  
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
  
  // Run preflight checks (can be skipped for resume)
  if (!options.skipPreflight && startIndex === 0) {
    logger.info('Running preflight checks...');
    const preflight = await preflightCheck({
      requireRemote: !noGit,
      requireAuth: true,
    });
    
    if (!preflight.canProceed) {
      printPreflightReport(preflight);
      throw new Error('Preflight check failed. Please fix the blockers above.');
    }
    
    if (preflight.warnings.length > 0) {
      for (const warning of preflight.warnings) {
        logger.warn(`⚠️  ${warning}`);
      }
    }
    
    logger.success('✓ Preflight checks passed');
  }
  
  // Warn if baseBranch is set in config (it will be ignored)
  if (config.baseBranch) {
    logger.warn(`⚠️  config.baseBranch="${config.baseBranch}" will be ignored. Using current branch instead.`);
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
  
  // In noGit mode, we don't need repoRoot - use current directory
  const repoRoot = noGit ? process.cwd() : git.getMainRepoRoot();
  
  // ALWAYS use current branch as base - ignore config.baseBranch
  // This ensures dependency structure is maintained in the worktree
  const currentBranch = noGit ? 'main' : git.getCurrentBranch(repoRoot);
  logger.info(`📍 Base branch: ${currentBranch} (current branch)`);
  
  // Load existing state if resuming
  const statePath = safeJoin(runDir, 'state.json');
  let state: LaneState | null = null;
  
  if (fs.existsSync(statePath)) {
    // Check if state needs recovery
    if (stateNeedsRecovery(statePath)) {
      logger.warn('State file indicates incomplete previous run. Attempting recovery...');
      const repairedState = repairLaneState(statePath);
      if (repairedState) {
        state = repairedState;
        logger.success('✓ State recovered');
      } else {
        logger.warn('Could not recover state. Starting fresh.');
      }
    } else {
      state = loadState<LaneState>(statePath);
      
      // Validate loaded state
      if (state) {
        const validation = validateLaneState(statePath, {
          checkWorktree: !noGit,
          checkBranch: !noGit,
          autoRepair: true,
        });
        
        if (!validation.valid) {
          logger.warn(`State validation issues: ${validation.issues.join(', ')}`);
          if (validation.repaired) {
            logger.info('State was auto-repaired');
            state = validation.repairedState || state;
          }
        }
      }
    }
  }
  
  const randomSuffix = Math.random().toString(36).substring(2, 7);
  const pipelineBranch = state?.pipelineBranch || config.pipelineBranch || `${config.branchPrefix || 'cursorflow/'}${Date.now().toString(36)}-${randomSuffix}`;
  
  // In noGit mode, use a simple local directory instead of worktree
  // Flatten the path by replacing slashes with hyphens to avoid race conditions in parent directory creation
  const worktreeDir = state?.worktreeDir || config.worktreeDir || (noGit 
    ? safeJoin(repoRoot, config.worktreeRoot || '_cursorflow/workdir', pipelineBranch.replace(/\//g, '-'))
    : safeJoin(repoRoot, config.worktreeRoot || '_cursorflow/worktrees', pipelineBranch.replace(/\//g, '-')));
  
  if (startIndex === 0) {
    logger.section('🚀 Starting Pipeline');
  } else {
    logger.section(`🔁 Resuming Pipeline from task ${startIndex + 1}`);
  }
  
  logger.info(`Pipeline Branch: ${pipelineBranch}`);
  logger.info(`Worktree: ${worktreeDir}`);
  logger.info(`Tasks: ${config.tasks.length}`);
  
  // Create worktree only if starting fresh and worktree doesn't exist
  if (!fs.existsSync(worktreeDir)) {
    if (noGit) {
      // In noGit mode, just create the directory
      logger.info(`Creating work directory: ${worktreeDir}`);
      fs.mkdirSync(worktreeDir, { recursive: true });
    } else {
      // Use a simple retry mechanism for Git worktree creation to handle potential race conditions
      let retries = 3;
      let lastError: Error | null = null;
      
      while (retries > 0) {
        try {
          // Ensure parent directory exists before calling git worktree
          const worktreeParent = path.dirname(worktreeDir);
          if (!fs.existsSync(worktreeParent)) {
            fs.mkdirSync(worktreeParent, { recursive: true });
          }

          // Always use the current branch (already captured at start) as the base branch
          git.createWorktree(worktreeDir, pipelineBranch, { 
            baseBranch: currentBranch,
            cwd: repoRoot,
          });
          break; // Success
        } catch (e: any) {
          lastError = e;
          retries--;
          if (retries > 0) {
            const delay = Math.floor(Math.random() * 1000) + 500;
            logger.warn(`Worktree creation failed, retrying in ${delay}ms... (${retries} retries left)`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
      
      if (retries === 0 && lastError) {
        throw new Error(`Failed to create Git worktree after retries: ${lastError.message}`);
      }
    }
  } else if (!noGit) {
    // If it exists but we are in Git mode, ensure it's actually a worktree and on the right branch
    logger.info(`Reusing existing worktree: ${worktreeDir}`);
    try {
      git.runGit(['checkout', pipelineBranch], { cwd: worktreeDir });
    } catch (e) {
      // If checkout fails, maybe the worktree is in a weird state. 
      // For now, just log it. In a more robust impl, we might want to repair it.
      logger.warn(`Failed to checkout branch ${pipelineBranch} in existing worktree: ${e}`);
    }
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
      completedTasks: [],
    };
  } else {
    state.status = 'running';
    state.error = null;
    state.dependencyRequest = null;
    state.pipelineBranch = pipelineBranch;
    state.worktreeDir = worktreeDir;
    state.label = state.label || pipelineBranch;
    state.dependsOn = config.dependsOn || [];
    state.completedTasks = state.completedTasks || [];
  }
  
  saveState(statePath, state);
  
  // Merge dependencies if any (skip in noGit mode)
  if (!noGit && startIndex === 0 && config.dependsOn && config.dependsOn.length > 0) {
    logger.section('🔗 Merging Dependencies');
    
    // The runDir for the lane is passed in. Dependencies are in ../<depName> relative to this runDir
    const lanesRoot = path.dirname(runDir);
    
    for (const depName of config.dependsOn) {
      const depRunDir = path.join(lanesRoot, depName); // nosemgrep
      const depStatePath = path.join(depRunDir, 'state.json'); // nosemgrep
      
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

          // Log changed files
          const stats = git.getLastOperationStats(worktreeDir);
          if (stats) {
            logger.info('Changed files:\n' + stats);
          }
        }
      } catch (e) {
        logger.error(`Failed to merge dependency ${depName}: ${e}`);
      }
    }
    
    // Push the merged state
    git.push(pipelineBranch, { cwd: worktreeDir });
  } else if (noGit && startIndex === 0 && config.dependsOn && config.dependsOn.length > 0) {
    logger.info('⚠️ Dependencies specified but Git is disabled - copying files instead of merging');
    
    // The runDir for the lane is passed in. Dependencies are in ../<depName> relative to this runDir
    const lanesRoot = path.dirname(runDir);
    
    for (const depName of config.dependsOn) {
      const depRunDir = safeJoin(lanesRoot, depName);
      const depStatePath = safeJoin(depRunDir, 'state.json');
      
      if (!fs.existsSync(depStatePath)) {
        continue;
      }
      
      try {
        const depState = JSON.parse(fs.readFileSync(depStatePath, 'utf8')) as LaneState;
        if (depState.worktreeDir && fs.existsSync(depState.worktreeDir)) {
          logger.info(`Copying files from dependency ${depName}: ${depState.worktreeDir} → ${worktreeDir}`);
          
          // Use a simple recursive copy (excluding Git and internal dirs)
          const copyFiles = (src: string, dest: string) => {
            if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
            const entries = fs.readdirSync(src, { withFileTypes: true });
            
            for (const entry of entries) {
              if (entry.name === '.git' || entry.name === '_cursorflow' || entry.name === 'node_modules') continue;
              
              const srcPath = safeJoin(src, entry.name);
              const destPath = safeJoin(dest, entry.name);
              
              if (entry.isDirectory()) {
                copyFiles(srcPath, destPath);
              } else {
                fs.copyFileSync(srcPath, destPath);
              }
            }
          };
          
          copyFiles(depState.worktreeDir, worktreeDir);
        }
      } catch (e) {
        logger.error(`Failed to copy dependency ${depName}: ${e}`);
      }
    }
  }
  
  // Run tasks
  const results: TaskExecutionResult[] = [];
  const laneName = state.label || path.basename(runDir);
  
  for (let i = startIndex; i < config.tasks.length; i++) {
    const task = config.tasks[i]!;
    const taskBranch = `${pipelineBranch}--${String(i + 1).padStart(2, '0')}-${task.name}`;

    // Create checkpoint before each task
    try {
      await createCheckpoint(laneName, runDir, noGit ? null : worktreeDir, {
        description: `Before task ${i + 1}: ${task.name}`,
        maxCheckpoints: 5,
      });
    } catch (e: any) {
      logger.warn(`Failed to create checkpoint: ${e.message}`);
    }

    // Handle task-level dependencies
    if (task.dependsOn && task.dependsOn.length > 0) {
      state.status = 'waiting';
      state.waitingFor = task.dependsOn;
      saveState(statePath, state);

      try {
        // Use enhanced dependency wait with timeout
        await waitForTaskDependencies(task.dependsOn, runDir, {
          timeoutMs: config.timeout || 30 * 60 * 1000,
          onTimeout: 'fail',
        });
        
        if (!noGit) {
          await mergeDependencyBranches(task.dependsOn, runDir, worktreeDir);
        }
        
        state.status = 'running';
        state.waitingFor = [];
        saveState(statePath, state);
      } catch (e: any) {
        state.status = 'failed';
        state.waitingFor = [];
        state.error = e.message;
        saveState(statePath, state);
        logger.error(`Task dependency wait/merge failed: ${e.message}`);
        
        // Try to restore from checkpoint
        const latestCheckpoint = getLatestCheckpoint(runDir);
        if (latestCheckpoint) {
          logger.info(`💾 Checkpoint available: ${latestCheckpoint.id}`);
          logger.info(`   Resume with: cursorflow resume --checkpoint ${latestCheckpoint.id}`);
        }
        
        process.exit(1);
      }
    }
    
    const result = await runTask({
      task,
      config,
      index: i,
      worktreeDir,
      pipelineBranch,
      taskBranch,
      chatId,
      runDir,
      noGit,
    });
    
    results.push(result);
    
    // Update state
    state.currentTaskIndex = i + 1;
    state.completedTasks = state.completedTasks || [];
    if (!state.completedTasks.includes(task.name)) {
      state.completedTasks.push(task.name);
    }
    saveState(statePath, state);
    
    // Handle blocked or error
    if (result.status === 'BLOCKED_DEPENDENCY') {
      state.status = 'failed';
      state.dependencyRequest = result.dependencyRequest || null;
      saveState(statePath, state);
      
      if (result.dependencyRequest) {
        events.emit('lane.dependency_requested', {
          laneName: state.label,
          dependencyRequest: result.dependencyRequest,
        });
      }
      
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
    
    // Merge into pipeline (skip in noGit mode)
    if (!noGit) {
      logger.info(`Merging ${taskBranch} → ${pipelineBranch}`);
      git.merge(taskBranch, { cwd: worktreeDir, noFf: true });

      // Log changed files
      const stats = git.getLastOperationStats(worktreeDir);
      if (stats) {
        logger.info('Changed files:\n' + stats);
      }

      git.push(pipelineBranch, { cwd: worktreeDir });
    } else {
      logger.info(`✓ Task ${task.name} completed (noGit mode - no branch operations)`);
    }
  }
  
  // Complete
  state.status = 'completed';
  state.endTime = Date.now();
  saveState(statePath, state);
  
  // Log final file summary
  if (noGit) {
    const getFileSummary = (dir: string): { files: number; dirs: number } => {
      let stats = { files: 0, dirs: 0 };
      if (!fs.existsSync(dir)) return stats;
      
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === '.git' || entry.name === '_cursorflow' || entry.name === 'node_modules') continue;
        
        if (entry.isDirectory()) {
          stats.dirs++;
          const sub = getFileSummary(safeJoin(dir, entry.name));
          stats.files += sub.files;
          stats.dirs += sub.dirs;
        } else {
          stats.files++;
        }
      }
      return stats;
    };
    
    const summary = getFileSummary(worktreeDir);
    logger.info(`Final Workspace Summary (noGit): ${summary.files} files, ${summary.dirs} directories created/modified`);
  } else {
    try {
      // Always use current branch for comparison (already captured at start)
      const stats = git.runGit(['diff', '--stat', currentBranch, pipelineBranch], { cwd: repoRoot, silent: true });
      if (stats) {
        logger.info('Final Workspace Summary (Git):\n' + stats);
      }
    } catch (e) {
      // Ignore
    }
  }
  
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
  const pipelineBranchIdx = args.indexOf('--pipeline-branch');
  const worktreeDirIdx = args.indexOf('--worktree-dir');
  const noGit = args.includes('--no-git');
  
  const runDir = runDirIdx >= 0 ? args[runDirIdx + 1]! : '.';
  const startIndex = startIdxIdx >= 0 ? parseInt(args[startIdxIdx + 1] || '0') : 0;
  const forcedPipelineBranch = pipelineBranchIdx >= 0 ? args[pipelineBranchIdx + 1] : null;
  const forcedWorktreeDir = worktreeDirIdx >= 0 ? args[worktreeDirIdx + 1] : null;

  // Extract runId from runDir (format: .../runs/run-123/lanes/lane-name)
  const parts = runDir.split(path.sep);
  const runsIdx = parts.lastIndexOf('runs');
  const runId = runsIdx >= 0 && parts[runsIdx + 1] ? parts[runsIdx + 1]! : `run-${Date.now()}`;
  
  events.setRunId(runId);

  // Load global config for defaults and webhooks
  let globalConfig;
  try {
    globalConfig = loadConfig();
    if (globalConfig.webhooks) {
      registerWebhooks(globalConfig.webhooks);
    }
  } catch (e) {
    // Non-blocking
  }
  
  if (!fs.existsSync(tasksFile)) {
    console.error(`Tasks file not found: ${tasksFile}`);
    process.exit(1);
  }
  
  // Load tasks configuration
  let config: RunnerConfig;
  try {
    config = JSON.parse(fs.readFileSync(tasksFile, 'utf8')) as RunnerConfig;
    if (forcedPipelineBranch) {
      config.pipelineBranch = forcedPipelineBranch;
    }
    if (forcedWorktreeDir) {
      config.worktreeDir = forcedWorktreeDir;
    }
  } catch (error: any) {
    console.error(`Failed to load tasks file: ${error.message}`);
    process.exit(1);
  }
  
  // Add defaults from global config or hardcoded
  config.dependencyPolicy = config.dependencyPolicy || {
    allowDependencyChange: globalConfig?.allowDependencyChange ?? false,
    lockfileReadOnly: globalConfig?.lockfileReadOnly ?? true,
  };
  
  // Add agent output format default
  config.agentOutputFormat = config.agentOutputFormat || globalConfig?.agentOutputFormat || 'stream-json';
  
  // Run tasks
  runTasks(tasksFile, config, runDir, { startIndex, noGit })
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

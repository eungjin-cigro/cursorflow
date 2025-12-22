# Phase 5: Runner 리팩토링

## 목표

1,197줄의 `core/runner.ts`를 책임별로 분리하여 유지보수성을 향상시킵니다.

## 현재 상태

### 파일 분석: `core/runner.ts` (1,197줄)

```
core/runner.ts
├── 설정 및 상수 (약 50줄)
│   ├── DEFAULT_TIMEOUT
│   ├── DEPENDENCY_POLL_INTERVAL
│   └── import 문
│
├── 에이전트 통신 (약 300줄)
│   ├── sendPromptToAgent()
│   ├── handleAgentResponse()
│   ├── parseAgentOutput()
│   └── extractDependencyRequest()
│
├── 태스크 실행 (약 350줄)
│   ├── executeTask()
│   ├── runTaskWithRetry()
│   ├── handleTaskResult()
│   └── applyReviewFeedback()
│
├── 상태 관리 (약 150줄)
│   ├── updateTaskState()
│   ├── saveTaskResult()
│   └── loadPreviousState()
│
├── 의존성 대기 (약 150줄)
│   ├── waitForTaskDependencies()
│   ├── checkDependencyStatus()
│   └── mergeDependencyBranches()
│
├── Git 연산 (약 100줄)
│   ├── createTaskBranch()
│   ├── mergeTaskBranch()
│   └── pushTaskBranch()
│
└── 메인 실행 (약 100줄)
    └── run() - 진입점
```

### 문제점
1. 에이전트 통신, 상태 관리, Git 연산이 혼재
2. 단일 함수가 너무 많은 책임
3. 테스트하기 어려운 구조

## 목표 구조

```
src/core/runner/
├── index.ts              # 외부 API (run 함수)
├── types.ts              # Runner 전용 타입
├── task-executor.ts      # 단일 태스크 실행
├── agent-client.ts       # cursor-agent 통신
├── state-manager.ts      # 상태 저장/로드
├── dependency-waiter.ts  # 의존성 대기 로직
└── branch-manager.ts     # Git 브랜치 연산
```

### 예상 파일 크기

| 파일 | 예상 라인 | 책임 |
|------|----------|------|
| `types.ts` | ~50 | TaskContext, ExecutionResult 등 |
| `agent-client.ts` | ~250 | 에이전트 통신, 응답 파싱 |
| `task-executor.ts` | ~200 | 태스크 실행 로직 |
| `state-manager.ts` | ~100 | 상태 저장/로드 |
| `dependency-waiter.ts` | ~150 | 의존성 대기/병합 |
| `branch-manager.ts` | ~100 | Git 브랜치 연산 |
| `index.ts` | ~150 | 메인 run() 함수 |
| **총계** | **~1,000** | 기존 1,197줄 대비 16% 감소 |

## 상세 작업

### 1. `core/runner/types.ts`

```typescript
// src/core/runner/types.ts

import type { Task, RunnerConfig, DependencyRequestPlan, AgentSendResult } from '../../types';

export interface TaskContext {
  task: Task;
  taskIndex: number;
  taskBranch: string;
  worktreeDir: string;
  pipelineBranch: string;
  config: RunnerConfig;
}

export interface ExecutionResult {
  status: 'success' | 'error' | 'blocked';
  taskName: string;
  taskBranch: string;
  error?: string;
  dependencyRequest?: DependencyRequestPlan | null;
  duration?: number;
}

export interface AgentContext {
  sessionId?: string;
  model: string;
  prompt: string;
  timeout: number;
  worktreeDir: string;
  signalDir?: string;
}

export interface DependencyState {
  lane: string;
  task: string;
  status: 'pending' | 'completed' | 'failed';
  branch?: string;
}

export const DEFAULT_TIMEOUT = 600000; // 10 minutes
export const DEPENDENCY_POLL_INTERVAL = 5000; // 5 seconds
export const HEARTBEAT_INTERVAL = 30000; // 30 seconds
```

### 2. `core/runner/agent-client.ts`

```typescript
// src/core/runner/agent-client.ts

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as logger from '../../services/logging';
import type { AgentContext, DependencyRequestPlan } from './types';
import type { AgentSendResult } from '../../types';
import { safeJoin } from '../../utils/path';
import { HEARTBEAT_INTERVAL } from './types';

/**
 * Send prompt to cursor-agent and get response
 */
export async function sendPromptToAgent(context: AgentContext): Promise<AgentSendResult> {
  const { model, prompt, timeout, worktreeDir, signalDir, sessionId } = context;

  return new Promise((resolve) => {
    const args = buildAgentArgs(context);
    const child = spawnAgent(args, worktreeDir);

    let output = '';
    let bytesReceived = 0;
    let lastActivityTime = Date.now();

    // Heartbeat timer
    const heartbeatTimer = setInterval(() => {
      const elapsed = Math.round((Date.now() - lastActivityTime) / 1000);
      logger.info(`⏱ Heartbeat: ${elapsed}s since last activity, ${bytesReceived} bytes received`);
    }, HEARTBEAT_INTERVAL);

    // Timeout timer
    const timeoutTimer = setTimeout(() => {
      child.kill();
      resolve({
        ok: false,
        exitCode: -1,
        error: `cursor-agent timed out after ${timeout / 1000} seconds.`,
      });
    }, timeout);

    child.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      output += text;
      bytesReceived += data.length;
      lastActivityTime = Date.now();
    });

    child.stderr?.on('data', (data: Buffer) => {
      bytesReceived += data.length;
      lastActivityTime = Date.now();
    });

    child.on('exit', (code) => {
      clearInterval(heartbeatTimer);
      clearTimeout(timeoutTimer);

      if (code === 0) {
        resolve({ ok: true, exitCode: 0, resultText: output, sessionId });
      } else {
        resolve({
          ok: false,
          exitCode: code ?? -1,
          error: `cursor-agent exited with code ${code}`,
          resultText: output,
        });
      }
    });

    child.on('error', (err) => {
      clearInterval(heartbeatTimer);
      clearTimeout(timeoutTimer);
      resolve({ ok: false, exitCode: -1, error: err.message });
    });

    // Send prompt to stdin
    if (child.stdin) {
      child.stdin.write(prompt);
      child.stdin.end();
    }
  });
}

/**
 * Extract dependency request from agent output
 */
export function extractDependencyRequest(output: string): DependencyRequestPlan | null {
  const marker = 'DEPENDENCY_CHANGE_REQUIRED';
  const markerIndex = output.indexOf(marker);

  if (markerIndex === -1) return null;

  const afterMarker = output.substring(markerIndex + marker.length);
  const jsonMatch = afterMarker.match(/```json\s*([\s\S]*?)\s*```/);

  if (!jsonMatch) return null;

  try {
    return JSON.parse(jsonMatch[1]!);
  } catch {
    return null;
  }
}

/**
 * Check for intervention file and inject if present
 */
export function checkIntervention(signalDir: string): string | null {
  const interventionPath = safeJoin(signalDir, 'intervention.txt');

  if (fs.existsSync(interventionPath)) {
    const message = fs.readFileSync(interventionPath, 'utf8');
    fs.unlinkSync(interventionPath);
    return message;
  }

  return null;
}

// Helper functions

function buildAgentArgs(context: AgentContext): string[] {
  const args = [
    'chat',
    '--model', context.model,
    '--output-format', 'stream-json',
    '--print-usage',
  ];

  if (context.sessionId) {
    args.push('--session', context.sessionId);
  }

  return args;
}

function spawnAgent(args: string[], cwd: string): ChildProcess {
  return spawn('cursor-agent', args, {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  });
}
```

### 3. `core/runner/task-executor.ts`

```typescript
// src/core/runner/task-executor.ts

import * as logger from '../../services/logging';
import type { TaskContext, ExecutionResult } from './types';
import { sendPromptToAgent, extractDependencyRequest } from './agent-client';
import { createTaskBranch, mergeTaskBranch } from './branch-manager';
import { updateTaskState, markTaskCompleted, markTaskFailed } from './state-manager';
import { waitForTaskDependencies } from './dependency-waiter';
import { runReviewLoop } from '../reviewer';
import { events } from '../../utils/events';
import { DEFAULT_TIMEOUT } from './types';

/**
 * Execute a single task
 */
export async function executeTask(context: TaskContext): Promise<ExecutionResult> {
  const { task, taskIndex, taskBranch, worktreeDir, pipelineBranch, config } = context;
  const startTime = Date.now();

  logger.section(`[${taskIndex + 1}/${config.tasks.length}] ${task.name}`);

  try {
    // Wait for task-level dependencies
    if (task.dependsOn?.length) {
      await waitForTaskDependencies(task.dependsOn, config);
    }

    // Create task branch (unless noGit)
    if (!config.noGit) {
      await createTaskBranch(taskBranch, pipelineBranch, worktreeDir);
    }

    logger.info(`Model: ${task.model || config.model || 'default'}`);
    logger.info(`Branch: ${taskBranch}`);

    // Build prompt with dependency policy
    const prompt = buildPrompt(task, config);

    // Send to agent
    logger.info('Sending prompt to agent...');
    events.emit('agent.prompt.sent', { taskName: task.name, model: task.model || config.model, promptLength: prompt.length });

    const timeout = task.timeout || config.timeout || DEFAULT_TIMEOUT;
    const result = await sendPromptToAgent({
      model: task.model || config.model || 'claude-sonnet-4-20250514',
      prompt,
      timeout,
      worktreeDir,
      signalDir: config.worktreeDir,
    });

    events.emit('agent.response.received', { taskName: task.name, ok: result.ok, duration: Date.now() - startTime });

    if (!result.ok) {
      // Check for dependency request
      if (result.resultText) {
        const depRequest = extractDependencyRequest(result.resultText);
        if (depRequest) {
          return {
            status: 'blocked',
            taskName: task.name,
            taskBranch,
            dependencyRequest: depRequest,
            duration: Date.now() - startTime,
          };
        }
      }

      throw new Error(result.error || 'Agent execution failed');
    }

    // Run review if enabled
    if (config.enableReview) {
      const reviewResult = await runReviewLoop({
        taskName: task.name,
        taskBranch,
        acceptanceCriteria: task.acceptanceCriteria || config.acceptanceCriteria,
      }, config);

      if (!reviewResult.approved) {
        throw new Error(`Review failed after ${reviewResult.iterations} iterations`);
      }
    }

    // Merge task branch to pipeline branch
    if (!config.noGit) {
      await mergeTaskBranch(taskBranch, pipelineBranch, worktreeDir);
    }

    markTaskCompleted(task.name, config);

    return {
      status: 'success',
      taskName: task.name,
      taskBranch,
      duration: Date.now() - startTime,
    };

  } catch (error: any) {
    markTaskFailed(task.name, error.message, config);

    return {
      status: 'error',
      taskName: task.name,
      taskBranch,
      error: error.message,
      duration: Date.now() - startTime,
    };
  }
}

function buildPrompt(task: any, config: any): string {
  const lines: string[] = [];

  // Add dependency policy header
  lines.push('# Dependency Policy (MUST FOLLOW)');
  lines.push('');
  lines.push('You are running in a restricted lane.');
  lines.push('');
  lines.push(`- allowDependencyChange: ${config.dependencyPolicy.allowDependencyChange}`);
  lines.push(`- lockfileReadOnly: ${config.dependencyPolicy.lockfileReadOnly}`);
  lines.push('');

  if (!config.dependencyPolicy.allowDependencyChange) {
    lines.push('Rules:');
    lines.push('- BEFORE making any code changes, decide whether dependency changes are required.');
    lines.push('- If dependency changes are required, DO NOT change any files. Instead reply with:');
    lines.push('');
    lines.push('DEPENDENCY_CHANGE_REQUIRED');
    lines.push('```json');
    lines.push('{ "reason": "...", "changes": [...], "commands": ["pnpm add ..."], "notes": "..." }');
    lines.push('```');
    lines.push('');
    lines.push('Then STOP.');
    lines.push('- If dependency changes are NOT required, proceed normally.');
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(task.prompt);

  return lines.join('\n');
}
```

### 4. `core/runner/state-manager.ts`

```typescript
// src/core/runner/state-manager.ts

import * as fs from 'fs';
import { safeJoin } from '../../utils/path';
import type { LaneState, RunnerConfig } from '../../types';

/**
 * Load lane state from file
 */
export function loadLaneState(stateDir: string): LaneState | null {
  const statePath = safeJoin(stateDir, 'state.json');

  try {
    if (fs.existsSync(statePath)) {
      return JSON.parse(fs.readFileSync(statePath, 'utf8'));
    }
  } catch {
    // Ignore parse errors
  }

  return null;
}

/**
 * Save lane state to file
 */
export function saveLaneState(stateDir: string, state: LaneState): void {
  const statePath = safeJoin(stateDir, 'state.json');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

/**
 * Update task state (in progress)
 */
export function updateTaskState(taskName: string, taskIndex: number, config: RunnerConfig): void {
  if (!config.worktreeDir) return;

  const state = loadLaneState(config.worktreeDir) || createInitialState(config);
  state.currentTaskIndex = taskIndex;
  state.status = 'running';
  state.updatedAt = Date.now();

  saveLaneState(config.worktreeDir, state);
}

/**
 * Mark task as completed
 */
export function markTaskCompleted(taskName: string, config: RunnerConfig): void {
  if (!config.worktreeDir) return;

  const state = loadLaneState(config.worktreeDir);
  if (!state) return;

  state.completedTasks = state.completedTasks || [];
  if (!state.completedTasks.includes(taskName)) {
    state.completedTasks.push(taskName);
  }
  state.currentTaskIndex++;
  state.updatedAt = Date.now();

  saveLaneState(config.worktreeDir, state);
}

/**
 * Mark task as failed
 */
export function markTaskFailed(taskName: string, error: string, config: RunnerConfig): void {
  if (!config.worktreeDir) return;

  const state = loadLaneState(config.worktreeDir);
  if (!state) return;

  state.status = 'failed';
  state.error = `Task "${taskName}" failed: ${error}`;
  state.endTime = Date.now();
  state.updatedAt = Date.now();

  saveLaneState(config.worktreeDir, state);
}

/**
 * Mark lane as blocked on dependency
 */
export function markBlocked(dependencyRequest: any, config: RunnerConfig): void {
  if (!config.worktreeDir) return;

  const state = loadLaneState(config.worktreeDir);
  if (!state) return;

  state.status = 'paused';
  state.dependencyRequest = dependencyRequest;
  state.updatedAt = Date.now();

  saveLaneState(config.worktreeDir, state);
}

function createInitialState(config: RunnerConfig): LaneState {
  return {
    label: 'lane',
    status: 'running',
    currentTaskIndex: 0,
    totalTasks: config.tasks.length,
    worktreeDir: config.worktreeDir || null,
    pipelineBranch: config.pipelineBranch || null,
    startTime: Date.now(),
    endTime: null,
    error: null,
    dependencyRequest: null,
    completedTasks: [],
  };
}
```

### 5. `core/runner/dependency-waiter.ts`

```typescript
// src/core/runner/dependency-waiter.ts

import * as fs from 'fs';
import * as logger from '../../services/logging';
import { safeJoin } from '../../utils/path';
import type { RunnerConfig, LaneState } from '../../types';
import { DEPENDENCY_POLL_INTERVAL } from './types';
import { mergeBranch } from '../../services/git';

/**
 * Wait for task-level dependencies to complete
 */
export async function waitForTaskDependencies(
  deps: string[],
  config: RunnerConfig
): Promise<void> {
  logger.info(`Waiting for task dependencies: ${deps.join(', ')}`);

  const lanesRoot = config.worktreeRoot;
  if (!lanesRoot) {
    logger.warn('No worktree root configured, skipping dependency wait');
    return;
  }

  const lanesToMerge = new Set<string>();

  for (const dep of deps) {
    const [laneName, taskName] = dep.split(':');

    if (!laneName || !taskName) {
      logger.warn(`Invalid dependency format: ${dep}. Expected "lane:task"`);
      continue;
    }

    // Poll for completion
    await pollForTaskCompletion(laneName, taskName, lanesRoot);
    lanesToMerge.add(laneName);
    logger.info(`✓ Dependency met: ${dep}`);
  }

  // Merge completed dependency branches
  for (const laneName of lanesToMerge) {
    await mergeDepedencyBranch(laneName, lanesRoot, config.worktreeDir!);
  }
}

async function pollForTaskCompletion(
  laneName: string,
  taskName: string,
  lanesRoot: string
): Promise<void> {
  const statePath = safeJoin(lanesRoot, laneName, 'state.json');

  while (true) {
    if (!fs.existsSync(statePath)) {
      await sleep(DEPENDENCY_POLL_INTERVAL);
      continue;
    }

    try {
      const state: LaneState = JSON.parse(fs.readFileSync(statePath, 'utf8'));

      // Check if task is completed
      if (state.completedTasks?.includes(taskName)) {
        return;
      }

      // Check if lane failed
      if (state.status === 'failed') {
        throw new Error(`Dependency failed: Lane ${laneName} failed`);
      }

    } catch (error: any) {
      if (error.message.includes('Dependency failed')) {
        throw error;
      }
      // Parse error, retry
    }

    await sleep(DEPENDENCY_POLL_INTERVAL);
  }
}

async function mergeDepedencyBranch(
  laneName: string,
  lanesRoot: string,
  worktreeDir: string
): Promise<void> {
  const statePath = safeJoin(lanesRoot, laneName, 'state.json');

  try {
    const state: LaneState = JSON.parse(fs.readFileSync(statePath, 'utf8'));

    if (state.pipelineBranch) {
      logger.info(`Merging branch from ${laneName}: ${state.pipelineBranch}`);

      const result = mergeBranch(state.pipelineBranch, {
        message: `chore: merge task dependency from ${laneName}`,
        cwd: worktreeDir,
      });

      if (!result.success && result.conflicts?.length) {
        throw new Error(`Merge conflict with ${laneName}: ${result.conflicts.join(', ')}`);
      }
    }
  } catch (error: any) {
    logger.error(`Failed to merge branch from ${laneName}: ${error.message}`);
    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### 6. `core/runner/branch-manager.ts`

```typescript
// src/core/runner/branch-manager.ts

import * as git from '../../services/git';
import * as logger from '../../services/logging';

/**
 * Create a task branch
 */
export async function createTaskBranch(
  taskBranch: string,
  baseBranch: string,
  worktreeDir: string
): Promise<void> {
  // Check if branch already exists
  if (git.branchExists(taskBranch, { cwd: worktreeDir })) {
    git.switchBranch(taskBranch, worktreeDir);
    return;
  }

  git.createBranch(taskBranch, { baseBranch, cwd: worktreeDir });
}

/**
 * Merge task branch to pipeline branch
 */
export async function mergeTaskBranch(
  taskBranch: string,
  pipelineBranch: string,
  worktreeDir: string
): Promise<void> {
  // Switch to pipeline branch
  git.switchBranch(pipelineBranch, worktreeDir);

  // Merge task branch
  const result = git.mergeBranch(taskBranch, {
    message: `chore: merge ${taskBranch}`,
    cwd: worktreeDir,
  });

  if (!result.success) {
    if (result.conflicts?.length) {
      throw new Error(`Merge conflict: ${result.conflicts.join(', ')}`);
    }
    throw new Error(result.message || 'Merge failed');
  }

  logger.info(`Merged ${taskBranch} → ${pipelineBranch}`);
}

/**
 * Push task branch to remote
 */
export async function pushTaskBranch(
  taskBranch: string,
  worktreeDir: string
): Promise<void> {
  try {
    git.pushBranch(taskBranch, { setUpstream: true, cwd: worktreeDir });
    logger.info(`Pushed ${taskBranch}`);
  } catch (error: any) {
    logger.warn(`Failed to push ${taskBranch}: ${error.message}`);
  }
}
```

### 7. `core/runner/index.ts`

```typescript
// src/core/runner/index.ts

import * as logger from '../../services/logging';
import * as git from '../../services/git';
import type { RunnerConfig, LaneState } from '../../types';
import type { ExecutionResult } from './types';
import { executeTask } from './task-executor';
import { loadLaneState, saveLaneState, markBlocked } from './state-manager';
import { events } from '../../utils/events';
import { checkCursorAuth } from '../../services/validation';

export { executeTask } from './task-executor';
export * from './types';

/**
 * Run all tasks in a lane
 */
export async function run(config: RunnerConfig): Promise<void> {
  // Validate configuration
  logger.info('Validating task configuration...');
  validateConfig(config);
  logger.success('✓ Configuration valid');

  // Check authentication
  if (config.agentOutputFormat !== 'plain') {
    logger.info('Checking Cursor authentication...');
    const authIssues = await checkCursorAuth({ includeCursorAgentChecks: true });
    if (authIssues.length > 0) {
      throw new Error(authIssues[0]!.message);
    }
    logger.success('✓ Cursor authentication OK');
  }

  // Initialize worktree and pipeline branch
  if (!config.noGit) {
    await initializeWorktree(config);
  }

  logger.section('🚀 Starting Pipeline');
  logger.info(`Pipeline Branch: ${config.pipelineBranch}`);
  logger.info(`Worktree: ${config.worktreeDir}`);
  logger.info(`Tasks: ${config.tasks.length}`);

  // Load existing state for resume
  const existingState = config.worktreeDir ? loadLaneState(config.worktreeDir) : null;
  const startIndex = existingState?.currentTaskIndex || 0;

  // Execute tasks
  for (let i = startIndex; i < config.tasks.length; i++) {
    const task = config.tasks[i]!;
    const taskBranch = `${config.pipelineBranch}--${(i + 1).toString().padStart(2, '0')}-${task.name}`;

    const result = await executeTask({
      task,
      taskIndex: i,
      taskBranch,
      worktreeDir: config.worktreeDir!,
      pipelineBranch: config.pipelineBranch!,
      config,
    });

    if (result.status === 'blocked') {
      markBlocked(result.dependencyRequest, config);
      logger.warn('Task blocked on dependency change');
      process.exit(2);
    }

    if (result.status === 'error') {
      logger.error(`Task failed: ${result.error}`);
      process.exit(1);
    }

    events.emit('task.completed', { taskName: task.name, taskBranch, status: 'success' });
  }

  logger.success('All tasks completed!');
}

function validateConfig(config: RunnerConfig): void {
  if (!config.tasks || config.tasks.length === 0) {
    throw new Error('No tasks configured');
  }

  for (const task of config.tasks) {
    if (!task.name) throw new Error('Task missing name');
    if (!task.prompt) throw new Error(`Task "${task.name}" missing prompt`);
  }
}

async function initializeWorktree(config: RunnerConfig): Promise<void> {
  if (!config.worktreeDir || !config.pipelineBranch) {
    throw new Error('Worktree configuration missing');
  }

  await git.createWorktree(config.worktreeDir, config.pipelineBranch, {
    baseBranch: config.baseBranch,
  });
}
```

## 마이그레이션 가이드

### Before
```typescript
import { run } from '../core/runner';
```

### After
```typescript
import { run } from '../core/runner';
// 또는 개별 import
import { executeTask, AgentContext } from '../core/runner';
```

## 테스트 계획

1. **유닛 테스트**
   - `agent-client.ts`: Mock agent 응답 테스트
   - `state-manager.ts`: 상태 저장/로드 테스트
   - `dependency-waiter.ts`: 의존성 대기 로직

2. **통합 테스트**
   - 전체 태스크 실행 파이프라인
   - 에러 복구 시나리오

## 체크리스트

- [ ] `core/runner/` 디렉토리 생성
- [ ] `types.ts` 작성
- [ ] `agent-client.ts` 작성
- [ ] `task-executor.ts` 작성
- [ ] `state-manager.ts` 작성
- [ ] `dependency-waiter.ts` 작성
- [ ] `branch-manager.ts` 작성
- [ ] `index.ts` 작성
- [ ] 기존 `core/runner.ts` 삭제
- [ ] import 경로 업데이트
- [ ] 테스트 실행


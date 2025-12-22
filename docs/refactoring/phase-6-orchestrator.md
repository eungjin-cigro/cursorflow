# Phase 6: Orchestrator 리팩토링

## 목표

790줄의 `core/orchestrator.ts`를 책임별로 분리하여 레인 관리와 스케줄링 로직을 명확히 합니다.

## 현재 상태

### 파일 분석: `core/orchestrator.ts` (790줄)

```
core/orchestrator.ts
├── 타입 및 상수 (약 60줄)
│   ├── LaneInfo interface
│   ├── SpawnLaneResult interface
│   ├── RunningLaneInfo interface
│   └── HEARTBEAT/STALL 상수
│
├── 레인 프로세스 관리 (약 200줄)
│   ├── spawnLane()
│   ├── handleLaneExit()
│   └── killLane()
│
├── 의존성 스케줄링 (약 150줄)
│   ├── buildDependencyGraph()
│   ├── getReadyLanes()
│   └── detectDeadlock()
│
├── 의존성 해결 (약 150줄)
│   ├── resolveDependencies()
│   ├── syncLaneBranches()
│   └── createResolutionWorktree()
│
├── 상태 모니터링 (약 100줄)
│   ├── monitorLanes()
│   ├── checkStalls()
│   └── handleHeartbeat()
│
└── 메인 오케스트레이션 (약 130줄)
    └── orchestrate() - 진입점
```

### 문제점
1. 프로세스 스폰, 스케줄링, 의존성 해결이 혼재
2. 상태 추적과 모니터링이 분리되지 않음
3. 에러 핸들링이 일관적이지 않음

## 목표 구조

```
src/core/orchestrator/
├── index.ts              # 외부 API (orchestrate 함수)
├── types.ts              # Orchestrator 전용 타입
├── scheduler.ts          # 의존성 기반 스케줄링
├── lane-manager.ts       # 레인 프로세스 생명주기
├── dependency-resolver.ts # 의존성 해결 및 병합
└── monitor.ts            # 상태 모니터링
```

### 예상 파일 크기

| 파일 | 예상 라인 | 책임 |
|------|----------|------|
| `types.ts` | ~60 | LaneInfo, SpawnResult 등 |
| `scheduler.ts` | ~150 | 의존성 그래프, 스케줄링 |
| `lane-manager.ts` | ~180 | 프로세스 스폰/종료 |
| `dependency-resolver.ts` | ~130 | 의존성 병합 |
| `monitor.ts` | ~100 | Stall 감지, 하트비트 |
| `index.ts` | ~130 | 메인 오케스트레이션 루프 |
| **총계** | **~750** | 기존 790줄 대비 5% 감소 |

## 상세 작업

### 1. `core/orchestrator/types.ts`

```typescript
// src/core/orchestrator/types.ts

import { ChildProcess } from 'child_process';
import type { EnhancedLogManager } from '../../services/logging';
import type { WebhookConfig, EnhancedLogConfig } from '../../types';

export interface LaneInfo {
  name: string;
  path: string;
  dependsOn: string[];
  startIndex?: number;
  restartCount?: number;
}

export interface SpawnLaneResult {
  child: ChildProcess;
  logPath: string;
  logManager?: EnhancedLogManager;
}

export interface RunningLaneInfo {
  child: ChildProcess;
  logPath: string;
  logManager?: EnhancedLogManager;
  lastActivity: number;
  stallPhase: number; // 0: normal, 1: continued, 2: restarted
}

export interface OrchestratorOptions {
  executor: string;
  pollInterval: number;
  runDir: string;
  maxConcurrentLanes: number;
  webhooks?: WebhookConfig[];
  enhancedLogging?: Partial<EnhancedLogConfig>;
  noGit?: boolean;
}

export interface LaneStatus {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'blocked';
  exitCode?: number;
  dependencyRequest?: any;
}

export interface DependencyGraph {
  nodes: Map<string, LaneInfo>;
  edges: Map<string, string[]>; // lane -> dependencies
}

export const HEARTBEAT_INTERVAL_MS = 30000;
export const STALL_TIMEOUT_CONTINUE = 3 * 60 * 1000;
export const STALL_TIMEOUT_RESTART = 5 * 60 * 1000;
```

### 2. `core/orchestrator/scheduler.ts`

```typescript
// src/core/orchestrator/scheduler.ts

import * as fs from 'fs';
import * as path from 'path';
import * as logger from '../../services/logging';
import type { LaneInfo, DependencyGraph, LaneStatus } from './types';

/**
 * Build dependency graph from lane files
 */
export function buildDependencyGraph(tasksDir: string): DependencyGraph {
  const nodes = new Map<string, LaneInfo>();
  const edges = new Map<string, string[]>();

  const files = fs.readdirSync(tasksDir)
    .filter(f => f.endsWith('.json'))
    .sort();

  for (const file of files) {
    const filePath = path.join(tasksDir, file);
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const name = extractLaneName(file);

    nodes.set(name, {
      name,
      path: filePath,
      dependsOn: content.dependsOn || [],
    });

    edges.set(name, content.dependsOn || []);
  }

  return { nodes, edges };
}

/**
 * Get lanes ready to start (all dependencies completed)
 */
export function getReadyLanes(
  graph: DependencyGraph,
  completed: Set<string>,
  running: Set<string>,
  failed: Set<string>
): LaneInfo[] {
  const ready: LaneInfo[] = [];

  for (const [name, lane] of graph.nodes) {
    // Skip if already running, completed, or failed
    if (running.has(name) || completed.has(name) || failed.has(name)) {
      continue;
    }

    // Check if all dependencies are met
    const deps = graph.edges.get(name) || [];
    const allDepsCompleted = deps.every(dep => {
      // Handle task-level deps (lane:task format)
      const depLane = dep.split(':')[0]!;
      return completed.has(depLane);
    });

    // Check if any dependency failed
    const anyDepFailed = deps.some(dep => {
      const depLane = dep.split(':')[0]!;
      return failed.has(depLane);
    });

    if (anyDepFailed) {
      // Mark this lane as failed due to dependency
      failed.add(name);
      logger.error(`Lane ${name} cannot start: dependency failed`);
      continue;
    }

    if (allDepsCompleted) {
      ready.push(lane);
    }
  }

  return ready;
}

/**
 * Detect deadlock (no lanes can progress)
 */
export function detectDeadlock(
  graph: DependencyGraph,
  completed: Set<string>,
  running: Set<string>,
  failed: Set<string>
): boolean {
  // If anything is running, no deadlock
  if (running.size > 0) return false;

  // If all lanes are completed or failed, no deadlock
  const total = graph.nodes.size;
  if (completed.size + failed.size >= total) return false;

  // Check if any lane can start
  const ready = getReadyLanes(graph, completed, running, failed);
  return ready.length === 0;
}

/**
 * Print dependency graph
 */
export function printDependencyGraph(graph: DependencyGraph): void {
  logger.info('\n📊 Dependency Graph:');

  for (const [name, lane] of graph.nodes) {
    if (lane.dependsOn.length === 0) {
      console.log(`  ${name}`);
    } else {
      console.log(`  ${name} [depends on: ${lane.dependsOn.join(', ')}]`);
      for (const dep of lane.dependsOn) {
        console.log(`    └─ ${dep}`);
      }
    }
  }
  console.log('');
}

function extractLaneName(fileName: string): string {
  // Remove .json extension and leading number prefix (e.g., "01-lane-a.json" -> "lane-a")
  return fileName.replace(/\.json$/, '').replace(/^\d+-/, '');
}
```

### 3. `core/orchestrator/lane-manager.ts`

```typescript
// src/core/orchestrator/lane-manager.ts

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as logger from '../../services/logging';
import { createLogManager, formatMessageForConsole } from '../../services/logging';
import { safeJoin } from '../../utils/path';
import type { LaneInfo, SpawnLaneResult, OrchestratorOptions } from './types';
import type { EnhancedLogConfig } from '../../types';

/**
 * Spawn a lane runner process
 */
export function spawnLane(
  lane: LaneInfo,
  laneRunDir: string,
  options: OrchestratorOptions & {
    pipelineBranch?: string;
    worktreeDir?: string;
    onActivity?: () => void;
  }
): SpawnLaneResult {
  const { executor, enhancedLogging, noGit, onActivity } = options;

  // Build runner arguments
  const args = [
    require.resolve('../runner'),
    '--tasks', lane.path,
    '--lane-dir', laneRunDir,
  ];

  if (options.pipelineBranch) {
    args.push('--pipeline-branch', options.pipelineBranch);
  }

  if (options.worktreeDir) {
    args.push('--worktree', options.worktreeDir);
  }

  if (noGit) {
    args.push('--no-git');
  }

  if (lane.startIndex) {
    args.push('--start-index', lane.startIndex.toString());
  }

  // Create log manager
  const logConfig: EnhancedLogConfig = {
    enabled: true,
    stripAnsi: true,
    addTimestamps: true,
    maxFileSize: 50 * 1024 * 1024,
    maxFiles: 5,
    keepRawLogs: true,
    keepAbsoluteRawLogs: false,
    writeJsonLog: true,
    timestampFormat: 'iso',
    ...enhancedLogging,
  };

  const logManager = createLogManager(laneRunDir, lane.name, logConfig, (msg) => {
    if (onActivity) onActivity();
    const formatted = formatMessageForConsole(msg, {
      laneLabel: `[${lane.name}]`,
      includeTimestamp: true,
    });
    process.stdout.write(formatted + '\n');
  });

  const logPath = logManager.getLogPaths().clean;

  // Spawn child process
  const child = spawn('node', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
    detached: false,
  });

  // Pipe stdout/stderr through log manager
  if (child.stdout) {
    child.stdout.on('data', (data: Buffer) => {
      logManager.writeStdout(data);
      handleStdoutLine(data, lane.name, onActivity);
    });
  }

  if (child.stderr) {
    child.stderr.on('data', (data: Buffer) => {
      logManager.writeStderr(data);
      handleStderrLine(data, lane.name, onActivity);
    });
  }

  child.on('exit', () => {
    logManager.close();
  });

  return { child, logPath, logManager };
}

/**
 * Kill a lane process
 */
export function killLane(child: ChildProcess): void {
  try {
    if (child.pid) {
      process.kill(child.pid, 'SIGTERM');
    }
  } catch {
    // Process may already be dead
  }
}

/**
 * Check if lane exited with dependency block
 */
export function isDependencyBlock(exitCode: number, laneRunDir: string): boolean {
  if (exitCode !== 2) return false;

  // Check for dependency request file
  const requestPath = safeJoin(laneRunDir, 'dependency-request.json');
  return fs.existsSync(requestPath);
}

/**
 * Read dependency request from lane
 */
export function readDependencyRequest(laneRunDir: string): any | null {
  const requestPath = safeJoin(laneRunDir, 'dependency-request.json');

  try {
    if (fs.existsSync(requestPath)) {
      return JSON.parse(fs.readFileSync(requestPath, 'utf8'));
    }
  } catch {
    // Ignore
  }

  return null;
}

// Helper functions

function handleStdoutLine(data: Buffer, laneName: string, onActivity?: () => void): void {
  const str = data.toString();
  const lines = str.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Skip JSON lines (handled by log manager)
    if (trimmed.startsWith('{') || trimmed.includes('{"type"')) continue;

    if (onActivity) onActivity();

    const ts = `${logger.COLORS.gray}[${new Date().toLocaleTimeString('en-US', { hour12: false })}]${logger.COLORS.reset}`;
    const label = `[${laneName}]`;
    const labelPrefix = `${logger.COLORS.magenta}${label.padEnd(12)}${logger.COLORS.reset} `;

    // Strip redundant timestamp
    const cleanLine = line.replace(/^\[\d{2}:\d{2}:\d{2}\]\s+/, '');
    process.stdout.write(`${ts} ${labelPrefix}${cleanLine}\n`);
  }
}

function handleStderrLine(data: Buffer, laneName: string, onActivity?: () => void): void {
  const lines = data.toString().split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check if it's a status message (not an error)
    const isStatus = trimmed.startsWith('Preparing worktree') ||
                     trimmed.startsWith('Switched to') ||
                     trimmed.startsWith('HEAD is now at');

    const ts = `${logger.COLORS.gray}[${new Date().toLocaleTimeString('en-US', { hour12: false })}]${logger.COLORS.reset}`;
    const label = `[${laneName}]`;
    const labelPrefix = `${logger.COLORS.magenta}${label.padEnd(12)}${logger.COLORS.reset} `;

    if (isStatus) {
      process.stdout.write(`${ts} ${labelPrefix}${trimmed}\n`);
    } else {
      if (onActivity) onActivity();
      process.stderr.write(`${ts} ${labelPrefix}${logger.COLORS.red}ERROR: ${trimmed}${logger.COLORS.reset}\n`);
    }
  }
}
```

### 4. `core/orchestrator/dependency-resolver.ts`

```typescript
// src/core/orchestrator/dependency-resolver.ts

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as logger from '../../services/logging';
import * as git from '../../services/git';
import { safeJoin } from '../../utils/path';
import type { LaneInfo, LaneStatus } from './types';

/**
 * Resolve dependencies by creating a resolution worktree
 */
export async function resolveDependencies(
  blockedLanes: LaneStatus[],
  runRoot: string,
  baseBranch: string
): Promise<void> {
  const worktreeDir = safeJoin(runRoot, 'resolution-worktree');
  const resolutionBranch = `cursorflow/resolution-${Date.now().toString(36)}`;

  logger.info(`Creating resolution worktree at ${worktreeDir}`);

  // Create resolution worktree
  await git.createWorktree(worktreeDir, resolutionBranch, { baseBranch });

  // Apply each dependency request
  for (const lane of blockedLanes) {
    if (!lane.dependencyRequest) continue;

    logger.info(`Resolving dependencies for ${lane.name}`);

    const request = lane.dependencyRequest;
    for (const cmd of request.commands || []) {
      logger.info(`Running: ${cmd}`);
      try {
        execSync(cmd, { cwd: worktreeDir, stdio: 'inherit' });
      } catch (error: any) {
        logger.warn(`Command failed: ${cmd}`);
      }
    }
  }

  // Commit changes
  if (git.hasUncommittedChanges(worktreeDir)) {
    git.commitChanges('chore: resolve dependencies', { cwd: worktreeDir });
    logger.info('Dependencies resolved and committed');
  }
}

/**
 * Sync lane branches after dependency resolution
 */
export async function syncLaneBranches(
  lanes: LaneInfo[],
  resolutionBranch: string,
  lanesDir: string
): Promise<void> {
  for (const lane of lanes) {
    const statePath = safeJoin(lanesDir, lane.name, 'state.json');

    if (!fs.existsSync(statePath)) continue;

    try {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

      if (state.pipelineBranch) {
        const laneWorktree = state.worktreeDir;

        if (laneWorktree && fs.existsSync(laneWorktree)) {
          logger.info(`Syncing ${lane.name} with resolution branch`);

          const result = git.mergeBranch(resolutionBranch, {
            message: 'chore: sync with dependency resolution',
            cwd: laneWorktree,
          });

          if (result.success) {
            logger.info(`Synced ${lane.name}`);
          } else {
            logger.warn(`Failed to sync ${lane.name}: ${result.message}`);
          }
        }
      }
    } catch (error: any) {
      logger.warn(`Failed to sync ${lane.name}: ${error.message}`);
    }
  }
}

/**
 * Get merge statistics for display
 */
export function getMergeStats(worktreeDir: string, fromBranch: string, toBranch: string): string {
  try {
    return execSync(`git diff --stat ${fromBranch}...${toBranch}`, {
      cwd: worktreeDir,
      encoding: 'utf8',
    }).trim();
  } catch {
    return '';
  }
}
```

### 5. `core/orchestrator/monitor.ts`

```typescript
// src/core/orchestrator/monitor.ts

import * as fs from 'fs';
import * as logger from '../../services/logging';
import { safeJoin } from '../../utils/path';
import type { RunningLaneInfo, LaneStatus } from './types';
import { STALL_TIMEOUT_CONTINUE, STALL_TIMEOUT_RESTART } from './types';
import { analyzeFailure, logFailure } from '../failure-policy';

/**
 * Check for stalled lanes and take action
 */
export function checkStalls(
  running: Map<string, RunningLaneInfo>,
  lanesDir: string,
  restartLane: (name: string) => void
): void {
  const now = Date.now();

  for (const [name, info] of running) {
    const elapsed = now - info.lastActivity;

    // Phase 0: Normal operation
    if (info.stallPhase === 0 && elapsed > STALL_TIMEOUT_CONTINUE) {
      logger.warn(`Lane ${name} stalled for ${Math.round(elapsed / 1000)}s, sending continue...`);
      sendContinueMessage(name, lanesDir);
      info.stallPhase = 1;
    }

    // Phase 1: Already sent continue, wait for restart threshold
    else if (info.stallPhase === 1 && elapsed > STALL_TIMEOUT_CONTINUE + STALL_TIMEOUT_RESTART) {
      logger.warn(`Lane ${name} still stalled, restarting...`);
      restartLane(name);
      info.stallPhase = 2;
    }
  }
}

/**
 * Send continue message to stalled lane
 */
function sendContinueMessage(laneName: string, lanesDir: string): void {
  const interventionPath = safeJoin(lanesDir, laneName, 'intervention.txt');

  try {
    fs.writeFileSync(interventionPath, 'Please continue with the task.\n');
  } catch (error: any) {
    logger.error(`Failed to send continue to ${laneName}: ${error.message}`);
  }
}

/**
 * Handle lane exit and analyze failure
 */
export function handleLaneExit(
  laneName: string,
  exitCode: number,
  laneRunDir: string,
  onFailure: (analysis: any) => void
): void {
  if (exitCode === 0) {
    return; // Success
  }

  // Read last output for analysis
  const logPath = safeJoin(laneRunDir, 'terminal.log');
  let lastOutput = '';

  try {
    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, 'utf8');
      lastOutput = content.slice(-5000); // Last 5KB
    }
  } catch {
    // Ignore
  }

  // Analyze failure
  const analysis = analyzeFailure(exitCode, lastOutput);
  logFailure(laneName, analysis);
  onFailure(analysis);
}

/**
 * Print lane status table
 */
export function printLaneStatus(statuses: LaneStatus[]): void {
  logger.section('📡 Lane Status');

  for (const status of statuses) {
    let icon: string;
    switch (status.status) {
      case 'completed': icon = '✅'; break;
      case 'running': icon = '🔄'; break;
      case 'failed': icon = '❌'; break;
      case 'blocked': icon = '⏸️'; break;
      default: icon = '⏳';
    }

    const extra = status.exitCode !== undefined ? ` (exit ${status.exitCode})` : '';
    console.log(`- ${status.name}: ${status.status}${extra}`);
  }
}
```

### 6. `core/orchestrator/index.ts`

```typescript
// src/core/orchestrator/index.ts

import * as fs from 'fs';
import * as logger from '../../services/logging';
import { safeJoin } from '../../utils/path';
import { events } from '../../utils/events';
import { registerWebhooks } from '../../utils/webhook';

import type { OrchestratorOptions, LaneInfo, LaneStatus, RunningLaneInfo } from './types';
import { HEARTBEAT_INTERVAL_MS } from './types';
import { buildDependencyGraph, getReadyLanes, detectDeadlock, printDependencyGraph } from './scheduler';
import { spawnLane, killLane, isDependencyBlock, readDependencyRequest } from './lane-manager';
import { checkStalls, handleLaneExit, printLaneStatus } from './monitor';

export * from './types';
export { buildDependencyGraph, getReadyLanes } from './scheduler';

/**
 * Orchestrate lane execution with dependency awareness
 */
export async function orchestrate(
  tasksDir: string,
  options: OrchestratorOptions
): Promise<void> {
  const { runDir, maxConcurrentLanes, webhooks, noGit } = options;

  // Setup
  fs.mkdirSync(runDir, { recursive: true });
  const lanesDir = safeJoin(runDir, 'lanes');
  fs.mkdirSync(lanesDir, { recursive: true });

  if (webhooks?.length) {
    registerWebhooks(webhooks);
  }

  // Build dependency graph
  const graph = buildDependencyGraph(tasksDir);
  const lanes = Array.from(graph.nodes.values());

  logger.section('🧭 Starting Orchestration');
  logger.info(`Tasks directory: ${tasksDir}`);
  logger.info(`Run directory: ${runDir}`);
  logger.info(`Lanes: ${lanes.length}`);

  printDependencyGraph(graph);

  if (noGit) {
    logger.info('🚫 Git operations disabled (--no-git mode)');
  }

  // State tracking
  const completed = new Set<string>();
  const failed = new Set<string>();
  const blocked = new Set<string>();
  const running = new Map<string, RunningLaneInfo>();
  const laneRunDirs = new Map<string, string>();

  events.emit('orchestration.started', {
    runId: runDir,
    tasksDir,
    laneCount: lanes.length,
    runRoot: runDir,
  });

  // Main orchestration loop
  while (completed.size + failed.size + blocked.size < lanes.length) {
    // Check for stalls
    checkStalls(running, lanesDir, (name) => restartLane(name));

    // Get ready lanes
    const ready = getReadyLanes(graph, completed, running.keys() as any, failed);

    // Start new lanes (up to max concurrent)
    for (const lane of ready) {
      if (running.size >= maxConcurrentLanes) break;

      const laneRunDir = safeJoin(lanesDir, lane.name);
      fs.mkdirSync(laneRunDir, { recursive: true });
      laneRunDirs.set(lane.name, laneRunDir);

      const result = spawnLane(lane, laneRunDir, {
        ...options,
        onActivity: () => updateActivity(lane.name),
      });

      running.set(lane.name, {
        child: result.child,
        logPath: result.logPath,
        logManager: result.logManager,
        lastActivity: Date.now(),
        stallPhase: 0,
      });

      logger.info(`Lane started: ${lane.name}`);

      // Handle exit
      result.child.on('exit', (code) => handleExit(lane.name, code ?? -1));
    }

    // Check for deadlock
    if (detectDeadlock(graph, completed, new Set(running.keys()), failed)) {
      const remaining = lanes.filter(l => 
        !completed.has(l.name) && !failed.has(l.name) && !running.has(l.name)
      );
      logger.error(`Deadlock detected! Remaining: ${remaining.map(l => l.name).join(', ')}`);
      break;
    }

    // Wait before next iteration
    await sleep(options.pollInterval);
  }

  // Print final status
  printFinalStatus();

  // Helper functions
  function updateActivity(name: string): void {
    const info = running.get(name);
    if (info) info.lastActivity = Date.now();
  }

  function handleExit(name: string, code: number): void {
    running.delete(name);

    if (code === 0) {
      completed.add(name);
      logger.success(`Lane completed: ${name}`);
    } else if (isDependencyBlock(code, laneRunDirs.get(name)!)) {
      blocked.add(name);
      const request = readDependencyRequest(laneRunDirs.get(name)!);
      logger.warn(`Lane ${name} blocked on dependency`);
    } else {
      failed.add(name);
      handleLaneExit(name, code, laneRunDirs.get(name)!, () => {});
      logger.error(`Lane failed: ${name} (exit ${code})`);
    }

    printLaneStatus(getLaneStatuses());
  }

  function restartLane(name: string): void {
    const info = running.get(name);
    if (!info) return;

    killLane(info.child);
    running.delete(name);

    const lane = graph.nodes.get(name)!;
    lane.restartCount = (lane.restartCount || 0) + 1;

    // Re-spawn
    const laneRunDir = laneRunDirs.get(name)!;
    const result = spawnLane(lane, laneRunDir, {
      ...options,
      onActivity: () => updateActivity(name),
    });

    running.set(name, {
      child: result.child,
      logPath: result.logPath,
      logManager: result.logManager,
      lastActivity: Date.now(),
      stallPhase: 0,
    });

    logger.info(`Lane restarted: ${name} (attempt ${lane.restartCount})`);
    result.child.on('exit', (code) => handleExit(name, code ?? -1));
  }

  function getLaneStatuses(): LaneStatus[] {
    return lanes.map(lane => ({
      name: lane.name,
      status: completed.has(lane.name) ? 'completed' :
              failed.has(lane.name) ? 'failed' :
              blocked.has(lane.name) ? 'blocked' :
              running.has(lane.name) ? 'running' : 'pending',
    }));
  }

  function printFinalStatus(): void {
    const completedList = [...completed];
    const failedList = [...failed];
    const blockedList = [...blocked];

    if (failedList.length > 0) {
      logger.error(`Failed: ${failedList.join(', ')}`);
    }

    if (blockedList.length > 0) {
      logger.warn(`Blocked: ${blockedList.join(', ')}`);
    }

    if (failedList.length === 0 && blockedList.length === 0) {
      logger.success('All lanes completed successfully!');
    }

    events.emit('orchestration.completed', {
      runId: runDir,
      laneCount: lanes.length,
      completedCount: completedList.length,
      failedCount: failedList.length,
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

## 마이그레이션 가이드

### Before
```typescript
import { orchestrate } from '../core/orchestrator';
```

### After
```typescript
import { orchestrate } from '../core/orchestrator';
// 또는 개별 import
import { buildDependencyGraph, getReadyLanes } from '../core/orchestrator';
```

## 테스트 계획

1. **유닛 테스트**
   - `scheduler.ts`: 의존성 그래프 및 스케줄링
   - `monitor.ts`: Stall 감지 로직

2. **통합 테스트**
   - 다중 레인 오케스트레이션
   - 의존성 해결 시나리오

## 체크리스트

- [ ] `core/orchestrator/` 디렉토리 생성
- [ ] `types.ts` 작성
- [ ] `scheduler.ts` 작성
- [ ] `lane-manager.ts` 작성
- [ ] `dependency-resolver.ts` 작성
- [ ] `monitor.ts` 작성
- [ ] `index.ts` 작성
- [ ] 기존 `core/orchestrator.ts` 삭제
- [ ] import 경로 업데이트
- [ ] 테스트 실행


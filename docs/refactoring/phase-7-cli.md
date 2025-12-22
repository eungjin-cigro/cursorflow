# Phase 7: CLI 정리

## 목표

CLI 파일에서 비즈니스 로직을 분리하여 CLI는 순수하게 입력 파싱과 출력 포맷팅만 담당하도록 합니다.

## 현재 상태

### 문제가 있는 파일들

| 파일 | 라인 | 문제점 |
|------|------|--------|
| `cli/resume.ts` | 971 | 오케스트레이션 로직 포함 |
| `cli/monitor.ts` | 932 | 상태 관리 로직 포함 |
| `cli/logs.ts` | 895 | 로그 처리 로직 포함 |
| `cli/prepare.ts` | 884 | 파일 생성 로직 포함 |
| `cli/run.ts` | 461 | 설정 로직 포함 |

### 문제점
1. CLI 파일에 비즈니스 로직이 혼재
2. 파일당 800줄 이상으로 너무 큼
3. 테스트하기 어려운 구조

## 목표 구조

```
src/cli/
├── index.ts              # 메인 진입점
├── commands/             # 명령어별 핸들러 (파싱만)
│   ├── init.ts
│   ├── prepare.ts
│   ├── run.ts
│   ├── monitor.ts
│   ├── resume.ts
│   ├── clean.ts
│   ├── logs.ts
│   └── doctor.ts
│
└── formatters/           # 출력 포맷팅
    ├── table.ts
    ├── progress.ts
    └── status.ts
```

### 예상 파일 크기

각 명령어 핸들러: **150줄 이하**
- 인자 파싱
- 서비스 호출
- 결과 출력

## 상세 작업

### 1. CLI 책임 분리 원칙

```typescript
// Before: cli/resume.ts에 모든 로직
export async function resumeCommand(args: string[]): Promise<void> {
  // 500줄의 비즈니스 로직...
}

// After: cli/commands/resume.ts
export async function resumeCommand(args: string[]): Promise<void> {
  // 1. Parse arguments
  const options = parseResumeArgs(args);
  
  // 2. Call service
  const result = await resumeService.resume(options);
  
  // 3. Format output
  printResumeResult(result);
}
```

### 2. `cli/commands/run.ts` 리팩토링

```typescript
// src/cli/commands/run.ts

import * as logger from '../../services/logging';
import { loadConfig } from '../config-loader';
import { orchestrate } from '../../core/orchestrator';
import { formatRunResult } from '../formatters/status';

interface RunOptions {
  tasksDir: string;
  executor: string | null;
  maxConcurrent: number | null;
  skipDoctor: boolean;
  noGit: boolean;
  raw: boolean;
  dryRun: boolean;
}

export async function runCommand(args: string[]): Promise<void> {
  // Parse options
  const options = parseRunArgs(args);

  if (options.help) {
    printHelp();
    return;
  }

  // Load config
  const config = await loadConfig(options.tasksDir);

  // Dry run: just show plan
  if (options.dryRun) {
    printExecutionPlan(config);
    return;
  }

  // Execute
  const result = await orchestrate(options.tasksDir, {
    executor: options.executor || config.executor,
    pollInterval: config.pollInterval,
    runDir: config.logsDir,
    maxConcurrentLanes: options.maxConcurrent || config.maxConcurrentLanes,
    webhooks: config.webhooks,
    enhancedLogging: {
      ...config.enhancedLogging,
      ...(options.raw ? { raw: true } : {}),
    },
    noGit: options.noGit,
  });

  // Format and print result
  formatRunResult(result);
}

function parseRunArgs(args: string[]): RunOptions {
  return {
    tasksDir: args.find(a => !a.startsWith('-')) || '_cursorflow/tasks',
    executor: parseOption(args, '--executor'),
    maxConcurrent: parseNumberOption(args, '--max-concurrent'),
    skipDoctor: args.includes('--skip-doctor'),
    noGit: args.includes('--no-git'),
    raw: args.includes('--raw'),
    dryRun: args.includes('--dry-run'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

function printHelp(): void {
  console.log(`
Usage: cursorflow run [tasks-dir] [options]

Options:
  --executor <name>     Executor to use (cursor-agent, cloud)
  --max-concurrent <n>  Max concurrent lanes
  --skip-doctor         Skip validation checks
  --no-git              Disable git operations
  --raw                 Save raw logs
  --dry-run             Show plan without executing
  --help, -h            Show this help
`);
}

function parseOption(args: string[], flag: string): string | null {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
}

function parseNumberOption(args: string[], flag: string): number | null {
  const value = parseOption(args, flag);
  return value ? parseInt(value, 10) : null;
}
```

### 3. `cli/commands/monitor.ts` 리팩토링

```typescript
// src/cli/commands/monitor.ts

import * as fs from 'fs';
import * as path from 'path';
import * as logger from '../../services/logging';
import { createLogBuffer } from '../../services/logging';
import { loadConfig } from '../config-loader';
import { MonitorUI } from '../../ui/monitor';

interface MonitorOptions {
  runPath: string | null;
  lane: string | null;
  follow: boolean;
  interval: number;
}

export async function monitorCommand(args: string[]): Promise<void> {
  const options = parseMonitorArgs(args);

  if (options.help) {
    printHelp();
    return;
  }

  // Find run path
  const runPath = await resolveRunPath(options.runPath);

  if (!runPath) {
    logger.error('No active run found');
    process.exit(1);
  }

  // Create monitor UI
  const ui = new MonitorUI(runPath, {
    lane: options.lane,
    follow: options.follow,
    interval: options.interval,
  });

  // Start monitoring
  await ui.start();

  // Handle exit
  process.on('SIGINT', () => {
    ui.stop();
    process.exit(0);
  });
}

function parseMonitorArgs(args: string[]): MonitorOptions & { help: boolean } {
  return {
    runPath: parseOption(args, '--run'),
    lane: parseOption(args, '--lane'),
    follow: args.includes('--follow') || args.includes('-f'),
    interval: parseInt(parseOption(args, '--interval') || '2000', 10),
    help: args.includes('--help') || args.includes('-h'),
  };
}

async function resolveRunPath(specified: string | null): Promise<string | null> {
  if (specified) {
    return fs.existsSync(specified) ? specified : null;
  }

  // Find most recent run
  const config = await loadConfig();
  const runsDir = path.join(config.logsDir, 'runs');

  if (!fs.existsSync(runsDir)) return null;

  const runs = fs.readdirSync(runsDir)
    .filter(f => fs.statSync(path.join(runsDir, f)).isDirectory())
    .sort()
    .reverse();

  return runs.length > 0 ? path.join(runsDir, runs[0]!) : null;
}

function printHelp(): void {
  console.log(`
Usage: cursorflow monitor [options]

Options:
  --run <path>          Path to run directory
  --lane <name>         Filter to specific lane
  --follow, -f          Follow log output
  --interval <ms>       Refresh interval (default: 2000)
  --help, -h            Show this help
`);
}

function parseOption(args: string[], flag: string): string | null {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
}
```

### 4. `cli/commands/resume.ts` 리팩토링

```typescript
// src/cli/commands/resume.ts

import * as logger from '../../services/logging';
import { resumeLane } from '../../core/runner';
import { findResumableLane, listResumableLanes } from '../../services/state';
import { formatLaneStatus } from '../formatters/status';

interface ResumeOptions {
  lane: string | null;
  run: string | null;
  list: boolean;
  force: boolean;
}

export async function resumeCommand(args: string[]): Promise<void> {
  const options = parseResumeArgs(args);

  if (options.help) {
    printHelp();
    return;
  }

  // List mode
  if (options.list) {
    const lanes = await listResumableLanes(options.run);
    printResumableLanes(lanes);
    return;
  }

  // Find lane to resume
  const lane = await findResumableLane({
    name: options.lane,
    runPath: options.run,
    force: options.force,
  });

  if (!lane) {
    logger.error('No resumable lane found');
    process.exit(1);
  }

  logger.section(`Resuming: ${lane.name}`);
  formatLaneStatus(lane);

  // Resume
  await resumeLane(lane);
}

function parseResumeArgs(args: string[]): ResumeOptions & { help: boolean } {
  return {
    lane: parseOption(args, '--lane'),
    run: parseOption(args, '--run'),
    list: args.includes('--list') || args.includes('-l'),
    force: args.includes('--force'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

function printResumableLanes(lanes: any[]): void {
  if (lanes.length === 0) {
    logger.info('No resumable lanes found');
    return;
  }

  logger.section('Resumable Lanes');
  for (const lane of lanes) {
    const status = lane.status === 'paused' ? '⏸️' :
                   lane.status === 'failed' ? '❌' : '⏳';
    console.log(`  ${status} ${lane.name} - Task ${lane.currentTask}/${lane.totalTasks}`);
    if (lane.error) {
      console.log(`     Error: ${lane.error}`);
    }
  }
}

function printHelp(): void {
  console.log(`
Usage: cursorflow resume [options]

Options:
  --lane <name>         Resume specific lane
  --run <path>          Path to run directory
  --list, -l            List resumable lanes
  --force               Force resume even if not paused
  --help, -h            Show this help
`);
}

function parseOption(args: string[], flag: string): string | null {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null;
}
```

### 5. `cli/formatters/status.ts`

```typescript
// src/cli/formatters/status.ts

import * as logger from '../../services/logging';
import type { LaneStatus, RunResult } from '../../types';

/**
 * Format and print run result
 */
export function formatRunResult(result: RunResult): void {
  logger.section('🏁 Run Complete');

  const { completed, failed, blocked } = result;

  if (completed.length > 0) {
    logger.success(`Completed: ${completed.join(', ')}`);
  }

  if (failed.length > 0) {
    logger.error(`Failed: ${failed.join(', ')}`);
  }

  if (blocked.length > 0) {
    logger.warn(`Blocked: ${blocked.join(', ')}`);
  }

  const total = completed.length + failed.length + blocked.length;
  const successRate = Math.round((completed.length / total) * 100);

  console.log('');
  console.log(`📊 Summary: ${completed.length}/${total} lanes completed (${successRate}%)`);
}

/**
 * Format and print lane status
 */
export function formatLaneStatus(lane: LaneStatus): void {
  const statusIcon = getStatusIcon(lane.status);

  console.log(`${statusIcon} ${lane.name}`);
  console.log(`   Status: ${lane.status}`);
  console.log(`   Task: ${lane.currentTask}/${lane.totalTasks}`);

  if (lane.branch) {
    console.log(`   Branch: ${lane.branch}`);
  }

  if (lane.error) {
    console.log(`   Error: ${lane.error}`);
  }
}

/**
 * Print progress table
 */
export function printProgressTable(lanes: LaneStatus[]): void {
  const maxNameLen = Math.max(...lanes.map(l => l.name.length), 10);

  console.log('');
  console.log(`${'Lane'.padEnd(maxNameLen)}  Status       Progress`);
  console.log('-'.repeat(maxNameLen + 30));

  for (const lane of lanes) {
    const name = lane.name.padEnd(maxNameLen);
    const status = lane.status.padEnd(12);
    const progress = `${lane.currentTask}/${lane.totalTasks}`;
    const bar = makeProgressBar(lane.currentTask, lane.totalTasks, 10);

    console.log(`${name}  ${status} ${bar} ${progress}`);
  }
}

function getStatusIcon(status: string): string {
  switch (status) {
    case 'completed': return '✅';
    case 'running': return '🔄';
    case 'failed': return '❌';
    case 'blocked': return '⏸️';
    case 'paused': return '⏸️';
    default: return '⏳';
  }
}

function makeProgressBar(current: number, total: number, width: number): string {
  const filled = Math.round((current / total) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}
```

### 6. `cli/formatters/table.ts`

```typescript
// src/cli/formatters/table.ts

import * as logger from '../../services/logging';

interface TableColumn {
  header: string;
  key: string;
  width?: number;
  align?: 'left' | 'right' | 'center';
  format?: (value: any) => string;
}

interface TableOptions {
  border?: boolean;
  headerColor?: string;
}

/**
 * Print a formatted table
 */
export function printTable<T>(
  data: T[],
  columns: TableColumn[],
  options: TableOptions = {}
): void {
  const { border = false, headerColor = logger.COLORS.cyan } = options;

  // Calculate column widths
  const widths = columns.map(col => {
    const headerWidth = col.header.length;
    const maxDataWidth = Math.max(
      ...data.map(row => {
        const value = (row as any)[col.key];
        const formatted = col.format ? col.format(value) : String(value ?? '');
        return stripAnsi(formatted).length;
      })
    );
    return col.width || Math.max(headerWidth, maxDataWidth);
  });

  // Print header
  const headerLine = columns.map((col, i) => {
    return padString(col.header, widths[i]!, col.align || 'left');
  }).join('  ');

  console.log(`${headerColor}${headerLine}${logger.COLORS.reset}`);

  if (border) {
    console.log('-'.repeat(widths.reduce((a, b) => a + b, 0) + (columns.length - 1) * 2));
  }

  // Print rows
  for (const row of data) {
    const line = columns.map((col, i) => {
      const value = (row as any)[col.key];
      const formatted = col.format ? col.format(value) : String(value ?? '');
      return padString(formatted, widths[i]!, col.align || 'left');
    }).join('  ');

    console.log(line);
  }
}

/**
 * Print a simple key-value list
 */
export function printKeyValue(data: Record<string, any>, indent = 0): void {
  const maxKeyLen = Math.max(...Object.keys(data).map(k => k.length));
  const prefix = ' '.repeat(indent);

  for (const [key, value] of Object.entries(data)) {
    console.log(`${prefix}${key.padEnd(maxKeyLen)}: ${value}`);
  }
}

function padString(str: string, width: number, align: 'left' | 'right' | 'center'): string {
  const stripped = stripAnsi(str);
  const padding = Math.max(0, width - stripped.length);

  if (align === 'right') {
    return ' '.repeat(padding) + str;
  } else if (align === 'center') {
    const left = Math.floor(padding / 2);
    const right = padding - left;
    return ' '.repeat(left) + str + ' '.repeat(right);
  }

  return str + ' '.repeat(padding);
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}
```

## 마이그레이션 가이드

### Before
```typescript
// cli/run.ts
export async function runCommand(args: string[]): Promise<void> {
  // 400줄의 혼합된 로직
}
```

### After
```typescript
// cli/commands/run.ts - 150줄
// core/orchestrator - 비즈니스 로직
// cli/formatters/status.ts - 출력 포맷
```

## 테스트 계획

1. **CLI 통합 테스트**
   - 각 명령어 호출
   - 옵션 파싱 검증

2. **포맷터 유닛 테스트**
   - 테이블 출력 포맷
   - 상태 표시 형식

## 체크리스트

- [ ] `cli/commands/` 디렉토리 생성
- [ ] `cli/formatters/` 디렉토리 생성
- [ ] `cli/commands/run.ts` 리팩토링
- [ ] `cli/commands/monitor.ts` 리팩토링
- [ ] `cli/commands/resume.ts` 리팩토링
- [ ] `cli/commands/logs.ts` 리팩토링
- [ ] `cli/commands/prepare.ts` 리팩토링
- [ ] `cli/formatters/status.ts` 작성
- [ ] `cli/formatters/table.ts` 작성
- [ ] 기존 파일 삭제/이동
- [ ] index.ts 업데이트
- [ ] 테스트 실행


# Phase 4: 검증 서비스 분리

## 목표

거대한 `utils/doctor.ts`를 도메인별로 분리하여 재사용 가능한 검증 서비스를 구축합니다.

## 현재 상태

### 파일 분석: `utils/doctor.ts` (981줄)

```
utils/doctor.ts
├── 타입 정의 (약 80줄)
│   ├── DoctorIssue
│   ├── DoctorReport
│   └── DoctorOptions
│
├── 환경 검증 (약 300줄)
│   ├── checkNodeVersion()
│   ├── checkGitVersion()
│   ├── checkCursorAgent()
│   ├── checkCursorAuth()
│   └── checkNetworkConnectivity()
│
├── 설정 검증 (약 150줄)
│   ├── checkConfigFile()
│   ├── checkProjectStructure()
│   └── checkWorkingDirectory()
│
├── 태스크 검증 (약 300줄)
│   ├── checkTasksDirectory()
│   ├── validateLaneFile()
│   ├── validateTask()
│   ├── checkDependencyCycles()
│   └── checkBranchNaming()
│
├── 보고서 생성 (약 100줄)
│   ├── runDoctor()
│   └── formatReport()
│
└── 유틸리티 (약 50줄)
    ├── getDoctorStatus()
    └── saveDoctorStatus()
```

### 문제점
1. 모든 검증 로직이 단일 파일에 혼재
2. 환경, 설정, 태스크 검증이 분리되지 않음
3. 개별 검증 함수 재사용 어려움

## 목표 구조

```
src/services/validation/
├── index.ts              # 통합 API export
├── types.ts              # 검증 관련 타입
├── environment.ts        # 시스템 환경 검증
├── config.ts             # 설정 파일 검증
├── tasks.ts              # 태스크 정의 검증
├── dependencies.ts       # 의존성 검증 (순환, 누락)
└── reporter.ts           # 보고서 생성
```

### 예상 파일 크기

| 파일 | 예상 라인 | 책임 |
|------|----------|------|
| `types.ts` | ~60 | Issue, Report 타입 |
| `environment.ts` | ~200 | Node, Git, Agent 검증 |
| `config.ts` | ~120 | 설정 파일 검증 |
| `tasks.ts` | ~200 | 태스크/레인 검증 |
| `dependencies.ts` | ~100 | 의존성 그래프 검증 |
| `reporter.ts` | ~100 | 보고서 집계/포맷 |
| **총계** | **~780** | 기존 981줄 대비 20% 감소 |

## 상세 작업

### 1. `services/validation/types.ts`

```typescript
// src/services/validation/types.ts

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface ValidationIssue {
  id: string;
  severity: IssueSeverity;
  title: string;
  message: string;
  details?: string;
  fixes?: string[];
  category: 'environment' | 'config' | 'tasks' | 'dependencies';
}

export interface ValidationReport {
  ok: boolean;
  timestamp: number;
  issues: ValidationIssue[];
  summary: {
    errors: number;
    warnings: number;
    infos: number;
  };
}

export interface ValidationOptions {
  cwd?: string;
  tasksDir?: string;
  executor?: string;
  includeCursorAgentChecks?: boolean;
  skipNetwork?: boolean;
  verbose?: boolean;
}

export interface EnvironmentInfo {
  nodeVersion: string;
  gitVersion: string;
  platform: string;
  cursorAgentPath?: string;
  cursorAgentVersion?: string;
}

export interface DoctorStatus {
  lastRun: number;
  ok: boolean;
  issueCount: number;
}

// Validation function type
export type ValidationCheck = (options: ValidationOptions) => ValidationIssue[];
export type AsyncValidationCheck = (options: ValidationOptions) => Promise<ValidationIssue[]>;
```

### 2. `services/validation/environment.ts`

```typescript
// src/services/validation/environment.ts

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { ValidationIssue, ValidationOptions, EnvironmentInfo } from './types';

const MIN_NODE_VERSION = '18.0.0';
const MIN_GIT_VERSION = '2.20.0';

/**
 * Get current environment info
 */
export function getEnvironmentInfo(): EnvironmentInfo {
  return {
    nodeVersion: process.version.replace('v', ''),
    gitVersion: getGitVersion(),
    platform: process.platform,
    cursorAgentPath: findCursorAgent(),
    cursorAgentVersion: getCursorAgentVersion(),
  };
}

/**
 * Check Node.js version
 */
export function checkNodeVersion(): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const current = process.version.replace('v', '');

  if (compareVersions(current, MIN_NODE_VERSION) < 0) {
    issues.push({
      id: 'env.node.version',
      severity: 'error',
      category: 'environment',
      title: 'Node.js version too old',
      message: `Node.js ${MIN_NODE_VERSION}+ required, found ${current}`,
      fixes: [
        `Install Node.js ${MIN_NODE_VERSION} or later`,
        'Use nvm: nvm install 18 && nvm use 18',
      ],
    });
  }

  return issues;
}

/**
 * Check Git version
 */
export function checkGitVersion(): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  try {
    const version = getGitVersion();
    if (compareVersions(version, MIN_GIT_VERSION) < 0) {
      issues.push({
        id: 'env.git.version',
        severity: 'error',
        category: 'environment',
        title: 'Git version too old',
        message: `Git ${MIN_GIT_VERSION}+ required, found ${version}`,
        fixes: ['Update Git to the latest version'],
      });
    }
  } catch {
    issues.push({
      id: 'env.git.missing',
      severity: 'error',
      category: 'environment',
      title: 'Git not found',
      message: 'Git is not installed or not in PATH',
      fixes: ['Install Git: https://git-scm.com/downloads'],
    });
  }

  return issues;
}

/**
 * Check cursor-agent installation
 */
export function checkCursorAgent(options: ValidationOptions = {}): ValidationIssue[] {
  if (!options.includeCursorAgentChecks) return [];

  const issues: ValidationIssue[] = [];
  const agentPath = findCursorAgent();

  if (!agentPath) {
    issues.push({
      id: 'env.cursor-agent.missing',
      severity: 'error',
      category: 'environment',
      title: 'cursor-agent not found',
      message: 'cursor-agent CLI is not installed',
      fixes: [
        'Install via: npm install -g @anthropic/cursor-agent',
        'Or check if Cursor IDE includes it',
      ],
    });
  }

  return issues;
}

/**
 * Check Cursor authentication
 */
export async function checkCursorAuth(options: ValidationOptions = {}): Promise<ValidationIssue[]> {
  if (!options.includeCursorAgentChecks) return [];

  const issues: ValidationIssue[] = [];

  try {
    execSync('cursor-agent auth status', { encoding: 'utf8', stdio: 'pipe' });
  } catch (error: any) {
    const stderr = error.stderr?.toString() || '';
    if (stderr.includes('not authenticated') || stderr.includes('login')) {
      issues.push({
        id: 'env.cursor.auth',
        severity: 'error',
        category: 'environment',
        title: 'Cursor not authenticated',
        message: 'cursor-agent requires authentication',
        fixes: ['Run: cursor-agent auth login'],
      });
    }
  }

  return issues;
}

/**
 * Check network connectivity (optional)
 */
export async function checkNetworkConnectivity(options: ValidationOptions = {}): Promise<ValidationIssue[]> {
  if (options.skipNetwork) return [];

  const issues: ValidationIssue[] = [];

  try {
    const https = await import('https');
    await new Promise<void>((resolve, reject) => {
      const req = https.get('https://api.anthropic.com', { timeout: 5000 }, () => resolve());
      req.on('error', reject);
      req.on('timeout', () => reject(new Error('timeout')));
    });
  } catch {
    issues.push({
      id: 'env.network',
      severity: 'warning',
      category: 'environment',
      title: 'Network connectivity issue',
      message: 'Unable to reach Anthropic API',
      details: 'This may cause issues with cursor-agent',
    });
  }

  return issues;
}

// Helper functions
function getGitVersion(): string {
  const output = execSync('git --version', { encoding: 'utf8' });
  const match = output.match(/git version (\d+\.\d+\.\d+)/);
  return match ? match[1] : '0.0.0';
}

function findCursorAgent(): string | undefined {
  try {
    return execSync('which cursor-agent', { encoding: 'utf8' }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function getCursorAgentVersion(): string | undefined {
  try {
    const output = execSync('cursor-agent --version', { encoding: 'utf8' });
    return output.trim();
  } catch {
    return undefined;
  }
}

function compareVersions(a: string, b: string): number {
  const [aMajor, aMinor, aPatch] = a.split('.').map(Number);
  const [bMajor, bMinor, bPatch] = b.split('.').map(Number);

  if (aMajor !== bMajor) return aMajor! - bMajor!;
  if (aMinor !== bMinor) return aMinor! - bMinor!;
  return (aPatch || 0) - (bPatch || 0);
}
```

### 3. `services/validation/config.ts`

```typescript
// src/services/validation/config.ts

import * as fs from 'fs';
import * as path from 'path';
import type { ValidationIssue, ValidationOptions } from './types';

const CONFIG_FILE_NAME = 'cursorflow.config.json';
const REQUIRED_DIRS = ['_cursorflow', '_cursorflow/tasks'];

/**
 * Check if config file exists and is valid
 */
export function checkConfigFile(options: ValidationOptions = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const cwd = options.cwd || process.cwd();
  const configPath = path.join(cwd, CONFIG_FILE_NAME);

  if (!fs.existsSync(configPath)) {
    issues.push({
      id: 'config.file.missing',
      severity: 'warning',
      category: 'config',
      title: 'Config file not found',
      message: `${CONFIG_FILE_NAME} not found in project root`,
      details: 'Using default configuration',
      fixes: ['Run: cursorflow init'],
    });
    return issues;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(content);

    // Validate required fields
    if (!config.executor) {
      issues.push({
        id: 'config.executor.missing',
        severity: 'warning',
        category: 'config',
        title: 'Executor not specified',
        message: 'executor field is missing from config',
        details: 'Defaulting to "cursor-agent"',
      });
    }

  } catch (error: any) {
    issues.push({
      id: 'config.file.invalid',
      severity: 'error',
      category: 'config',
      title: 'Invalid config file',
      message: 'Config file contains invalid JSON',
      details: error.message,
      fixes: ['Fix JSON syntax in cursorflow.config.json'],
    });
  }

  return issues;
}

/**
 * Check project directory structure
 */
export function checkProjectStructure(options: ValidationOptions = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const cwd = options.cwd || process.cwd();

  for (const dir of REQUIRED_DIRS) {
    const dirPath = path.join(cwd, dir);
    if (!fs.existsSync(dirPath)) {
      issues.push({
        id: `config.dir.${dir.replace('/', '.')}`,
        severity: 'info',
        category: 'config',
        title: `Directory not found: ${dir}`,
        message: `The ${dir} directory does not exist`,
        fixes: ['Run: cursorflow init', `Or create manually: mkdir -p ${dir}`],
      });
    }
  }

  return issues;
}

/**
 * Check if we're in a git repository
 */
export function checkGitRepository(options: ValidationOptions = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const cwd = options.cwd || process.cwd();

  if (!fs.existsSync(path.join(cwd, '.git'))) {
    issues.push({
      id: 'config.git.missing',
      severity: 'error',
      category: 'config',
      title: 'Not a git repository',
      message: 'CursorFlow requires a git repository',
      fixes: ['Run: git init'],
    });
  }

  return issues;
}

/**
 * Check .gitignore for cursorflow directories
 */
export function checkGitignore(options: ValidationOptions = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const cwd = options.cwd || process.cwd();
  const gitignorePath = path.join(cwd, '.gitignore');

  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf8');
    const patterns = ['_cursorflow/logs', '_cursorflow/worktrees'];

    for (const pattern of patterns) {
      if (!content.includes(pattern)) {
        issues.push({
          id: `config.gitignore.${pattern.replace(/\//g, '.')}`,
          severity: 'warning',
          category: 'config',
          title: `Missing gitignore pattern: ${pattern}`,
          message: `Consider adding ${pattern} to .gitignore`,
        });
      }
    }
  }

  return issues;
}
```

### 4. `services/validation/tasks.ts`

```typescript
// src/services/validation/tasks.ts

import * as fs from 'fs';
import * as path from 'path';
import type { ValidationIssue, ValidationOptions } from './types';

/**
 * Check tasks directory
 */
export function checkTasksDirectory(options: ValidationOptions = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const tasksDir = options.tasksDir;

  if (!tasksDir) return issues;

  if (!fs.existsSync(tasksDir)) {
    issues.push({
      id: 'tasks.dir.missing',
      severity: 'error',
      category: 'tasks',
      title: 'Tasks directory not found',
      message: `Directory does not exist: ${tasksDir}`,
      fixes: ['Create the tasks directory', 'Run: cursorflow prepare <feature-name>'],
    });
    return issues;
  }

  const files = fs.readdirSync(tasksDir).filter(f => f.endsWith('.json'));

  if (files.length === 0) {
    issues.push({
      id: 'tasks.empty',
      severity: 'warning',
      category: 'tasks',
      title: 'No lane files found',
      message: `No .json files in ${tasksDir}`,
      fixes: ['Add lane files using: cursorflow prepare add-lane'],
    });
  }

  // Validate each lane file
  for (const file of files) {
    const filePath = path.join(tasksDir, file);
    issues.push(...validateLaneFile(filePath, file));
  }

  return issues;
}

/**
 * Validate a single lane file
 */
export function validateLaneFile(filePath: string, fileName: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const laneName = path.basename(fileName, '.json');

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lane = JSON.parse(content);

    // Check tasks array
    if (!lane.tasks) {
      issues.push({
        id: `tasks.${laneName}.missing_tasks`,
        severity: 'error',
        category: 'tasks',
        title: `Missing tasks array in ${laneName}`,
        message: `Lane "${laneName}" does not have a "tasks" array`,
      });
      return issues;
    }

    if (!Array.isArray(lane.tasks)) {
      issues.push({
        id: `tasks.${laneName}.invalid_tasks`,
        severity: 'error',
        category: 'tasks',
        title: `Invalid tasks in ${laneName}`,
        message: `Lane "${laneName}" has "tasks" but it's not an array`,
      });
      return issues;
    }

    if (lane.tasks.length === 0) {
      issues.push({
        id: `tasks.${laneName}.empty_tasks`,
        severity: 'warning',
        category: 'tasks',
        title: `No tasks in ${laneName}`,
        message: `Lane "${laneName}" has an empty tasks array`,
      });
    }

    // Validate each task
    for (let i = 0; i < lane.tasks.length; i++) {
      const task = lane.tasks[i];
      issues.push(...validateTask(task, laneName, i));
    }

  } catch (error: any) {
    issues.push({
      id: `tasks.${laneName}.parse_error`,
      severity: 'error',
      category: 'tasks',
      title: `Failed to parse ${laneName}`,
      message: error.message,
    });
  }

  return issues;
}

/**
 * Validate a single task
 */
export function validateTask(task: any, laneName: string, index: number): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!task.name) {
    issues.push({
      id: `tasks.${laneName}.${index}.missing_name`,
      severity: 'error',
      category: 'tasks',
      title: `Missing task name in ${laneName}`,
      message: `Task at index ${index} is missing the "name" field`,
    });
  } else if (typeof task.name !== 'string') {
    issues.push({
      id: `tasks.${laneName}.${index}.invalid_name`,
      severity: 'error',
      category: 'tasks',
      title: `Invalid task name type in ${laneName}`,
      message: `Task "${task.name}" name must be a string`,
    });
  }

  if (!task.prompt) {
    issues.push({
      id: `tasks.${laneName}.${index}.missing_prompt`,
      severity: 'error',
      category: 'tasks',
      title: `Missing prompt in ${laneName}`,
      message: `Task "${task.name || index}" is missing the "prompt" field`,
    });
  }

  // Validate model if specified
  if (task.model && typeof task.model !== 'string') {
    issues.push({
      id: `tasks.${laneName}.${index}.invalid_model`,
      severity: 'warning',
      category: 'tasks',
      title: `Invalid model in ${laneName}`,
      message: `Task "${task.name}" model must be a string`,
    });
  }

  return issues;
}

/**
 * Check for duplicate task names within a lane
 */
export function checkDuplicateTaskNames(tasks: any[], laneName: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const names = new Set<string>();

  for (const task of tasks) {
    if (task.name && names.has(task.name)) {
      issues.push({
        id: `tasks.${laneName}.duplicate.${task.name}`,
        severity: 'error',
        category: 'tasks',
        title: `Duplicate task name in ${laneName}`,
        message: `Task name "${task.name}" appears multiple times`,
      });
    }
    if (task.name) names.add(task.name);
  }

  return issues;
}
```

### 5. `services/validation/dependencies.ts`

```typescript
// src/services/validation/dependencies.ts

import * as fs from 'fs';
import * as path from 'path';
import type { ValidationIssue, ValidationOptions } from './types';

interface LaneInfo {
  name: string;
  dependsOn: string[];
  tasks: string[];
}

/**
 * Check for dependency cycles in lanes
 */
export function checkDependencyCycles(options: ValidationOptions = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const tasksDir = options.tasksDir;

  if (!tasksDir || !fs.existsSync(tasksDir)) return issues;

  const lanes = loadLaneInfo(tasksDir);
  const cycle = findCycle(lanes);

  if (cycle) {
    issues.push({
      id: 'deps.cycle',
      severity: 'error',
      category: 'dependencies',
      title: 'Dependency cycle detected',
      message: `Circular dependency: ${cycle.join(' → ')}`,
      fixes: ['Remove one of the dependencies to break the cycle'],
    });
  }

  return issues;
}

/**
 * Check for missing dependencies
 */
export function checkMissingDependencies(options: ValidationOptions = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const tasksDir = options.tasksDir;

  if (!tasksDir || !fs.existsSync(tasksDir)) return issues;

  const lanes = loadLaneInfo(tasksDir);
  const laneNames = new Set(lanes.map(l => l.name));

  for (const lane of lanes) {
    for (const dep of lane.dependsOn) {
      // Handle both lane-level and task-level dependencies
      const depLane = dep.split(':')[0];

      if (!laneNames.has(depLane!)) {
        issues.push({
          id: `deps.missing.${lane.name}.${depLane}`,
          severity: 'error',
          category: 'dependencies',
          title: `Missing dependency for ${lane.name}`,
          message: `Lane "${lane.name}" depends on "${depLane}" which does not exist`,
          fixes: [`Create lane "${depLane}"`, `Remove dependency on "${depLane}"`],
        });
      }
    }
  }

  return issues;
}

/**
 * Check task-level dependencies
 */
export function checkTaskDependencies(options: ValidationOptions = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const tasksDir = options.tasksDir;

  if (!tasksDir || !fs.existsSync(tasksDir)) return issues;

  const lanes = loadLaneInfo(tasksDir);
  const taskMap = new Map<string, Set<string>>();

  // Build task map: laneName -> Set of taskNames
  for (const lane of lanes) {
    taskMap.set(lane.name, new Set(lane.tasks));
  }

  // Check task-level dependencies
  for (const lane of lanes) {
    for (const dep of lane.dependsOn) {
      if (dep.includes(':')) {
        const [depLane, depTask] = dep.split(':');
        const tasks = taskMap.get(depLane!);

        if (tasks && !tasks.has(depTask!)) {
          issues.push({
            id: `deps.task.missing.${lane.name}.${dep}`,
            severity: 'error',
            category: 'dependencies',
            title: `Missing task dependency`,
            message: `Lane "${lane.name}" depends on "${dep}", but task "${depTask}" does not exist in "${depLane}"`,
          });
        }
      }
    }
  }

  return issues;
}

// Helper functions

function loadLaneInfo(tasksDir: string): LaneInfo[] {
  const lanes: LaneInfo[] = [];
  const files = fs.readdirSync(tasksDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(tasksDir, file), 'utf8');
      const lane = JSON.parse(content);
      lanes.push({
        name: path.basename(file, '.json').replace(/^\d+-/, ''),
        dependsOn: lane.dependsOn || [],
        tasks: (lane.tasks || []).map((t: any) => t.name).filter(Boolean),
      });
    } catch {
      // Skip invalid files
    }
  }

  return lanes;
}

function findCycle(lanes: LaneInfo[]): string[] | null {
  const graph = new Map<string, string[]>();
  for (const lane of lanes) {
    graph.set(lane.name, lane.dependsOn.map(d => d.split(':')[0]!));
  }

  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): boolean {
    if (stack.has(node)) {
      path.push(node);
      return true;
    }
    if (visited.has(node)) return false;

    visited.add(node);
    stack.add(node);
    path.push(node);

    for (const neighbor of graph.get(node) || []) {
      if (dfs(neighbor)) return true;
    }

    stack.delete(node);
    path.pop();
    return false;
  }

  for (const lane of lanes) {
    if (dfs(lane.name)) {
      // Find the start of the cycle in the path
      const cycleStart = path.indexOf(path[path.length - 1]!);
      return path.slice(cycleStart);
    }
    visited.clear();
    stack.clear();
    path.length = 0;
  }

  return null;
}
```

### 6. `services/validation/reporter.ts`

```typescript
// src/services/validation/reporter.ts

import * as fs from 'fs';
import * as path from 'path';
import type { ValidationIssue, ValidationReport, ValidationOptions, DoctorStatus } from './types';

import { checkNodeVersion, checkGitVersion, checkCursorAgent, checkCursorAuth, checkNetworkConnectivity } from './environment';
import { checkConfigFile, checkProjectStructure, checkGitRepository, checkGitignore } from './config';
import { checkTasksDirectory } from './tasks';
import { checkDependencyCycles, checkMissingDependencies, checkTaskDependencies } from './dependencies';

const DOCTOR_STATUS_FILE = '.cursorflow-doctor-status.json';

/**
 * Run all validation checks and generate report
 */
export async function runDoctor(options: ValidationOptions = {}): Promise<ValidationReport> {
  const issues: ValidationIssue[] = [];

  // Environment checks
  issues.push(...checkNodeVersion());
  issues.push(...checkGitVersion());
  issues.push(...checkCursorAgent(options));
  issues.push(...await checkCursorAuth(options));
  issues.push(...await checkNetworkConnectivity(options));

  // Config checks
  issues.push(...checkConfigFile(options));
  issues.push(...checkProjectStructure(options));
  issues.push(...checkGitRepository(options));
  issues.push(...checkGitignore(options));

  // Task checks
  issues.push(...checkTasksDirectory(options));

  // Dependency checks
  issues.push(...checkDependencyCycles(options));
  issues.push(...checkMissingDependencies(options));
  issues.push(...checkTaskDependencies(options));

  const report = createReport(issues);

  // Save status
  saveDoctorStatus(options.cwd || process.cwd(), report);

  return report;
}

/**
 * Create report from issues
 */
function createReport(issues: ValidationIssue[]): ValidationReport {
  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.filter(i => i.severity === 'warning').length;
  const infos = issues.filter(i => i.severity === 'info').length;

  return {
    ok: errors === 0,
    timestamp: Date.now(),
    issues,
    summary: { errors, warnings, infos },
  };
}

/**
 * Get last doctor status
 */
export function getDoctorStatus(projectRoot: string): DoctorStatus | null {
  const statusPath = path.join(projectRoot, DOCTOR_STATUS_FILE);

  try {
    if (fs.existsSync(statusPath)) {
      return JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    }
  } catch {
    // Ignore
  }

  return null;
}

/**
 * Save doctor status
 */
function saveDoctorStatus(projectRoot: string, report: ValidationReport): void {
  const statusPath = path.join(projectRoot, DOCTOR_STATUS_FILE);
  const status: DoctorStatus = {
    lastRun: report.timestamp,
    ok: report.ok,
    issueCount: report.issues.length,
  };

  try {
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
  } catch {
    // Ignore write errors
  }
}

/**
 * Format report for console output
 */
export function formatReportForConsole(report: ValidationReport): string {
  const lines: string[] = [];

  if (report.ok) {
    lines.push('✅ All checks passed!');
  } else {
    lines.push('❌ Some checks failed');
  }

  lines.push('');
  lines.push(`Summary: ${report.summary.errors} errors, ${report.summary.warnings} warnings, ${report.summary.infos} info`);
  lines.push('');

  // Group by category
  const byCategory = new Map<string, ValidationIssue[]>();
  for (const issue of report.issues) {
    const existing = byCategory.get(issue.category) || [];
    existing.push(issue);
    byCategory.set(issue.category, existing);
  }

  for (const [category, categoryIssues] of byCategory) {
    lines.push(`📁 ${category.toUpperCase()}`);
    for (const issue of categoryIssues) {
      const icon = issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️' : 'ℹ️';
      lines.push(`  ${icon} ${issue.title}`);
      lines.push(`     ${issue.message}`);
      if (issue.fixes?.length) {
        lines.push(`     Fix: ${issue.fixes[0]}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}
```

### 7. `services/validation/index.ts`

```typescript
// src/services/validation/index.ts

// Types
export * from './types';

// Environment checks
export {
  getEnvironmentInfo,
  checkNodeVersion,
  checkGitVersion,
  checkCursorAgent,
  checkCursorAuth,
  checkNetworkConnectivity,
} from './environment';

// Config checks
export {
  checkConfigFile,
  checkProjectStructure,
  checkGitRepository,
  checkGitignore,
} from './config';

// Task checks
export {
  checkTasksDirectory,
  validateLaneFile,
  validateTask,
  checkDuplicateTaskNames,
} from './tasks';

// Dependency checks
export {
  checkDependencyCycles,
  checkMissingDependencies,
  checkTaskDependencies,
} from './dependencies';

// Reporter
export {
  runDoctor,
  getDoctorStatus,
  formatReportForConsole,
} from './reporter';
```

## 마이그레이션 가이드

### Before
```typescript
import { runDoctor, getDoctorStatus } from '../utils/doctor';
```

### After
```typescript
import { runDoctor, getDoctorStatus } from '../services/validation';
```

## 테스트 계획

1. **유닛 테스트**: 각 검증 함수 독립 테스트
2. **통합 테스트**: `runDoctor()` 전체 시나리오
3. **엣지 케이스**: 잘못된 JSON, 순환 의존성 등

## 체크리스트

- [ ] `services/validation/` 디렉토리 생성
- [ ] `types.ts` 작성
- [ ] `environment.ts` 작성
- [ ] `config.ts` 작성
- [ ] `tasks.ts` 작성
- [ ] `dependencies.ts` 작성
- [ ] `reporter.ts` 작성
- [ ] `index.ts` 작성
- [ ] 모든 import 경로 변경
- [ ] `utils/doctor.ts` 삭제
- [ ] `cli/doctor.ts` 업데이트 (호출만 담당)
- [ ] 테스트 실행


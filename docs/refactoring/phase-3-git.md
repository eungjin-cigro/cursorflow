# Phase 3: Git 서비스 분리

## 목표

`utils/git.ts`를 책임별로 분리하여 명확한 Git 서비스 레이어를 구축합니다.

## 현재 상태

### 파일 분석: `utils/git.ts` (499줄)

```
utils/git.ts
├── 상수
│   ├── WORKTREE_LOCK_TIMEOUT
│   └── DEFAULT_RETRY_CONFIG
│
├── Worktree 관련 (약 150줄)
│   ├── createWorktree()
│   ├── removeWorktree()
│   ├── listWorktrees()
│   ├── isWorktreeClean()
│   └── isInWorktree()
│
├── Branch 관련 (약 120줄)
│   ├── createBranch()
│   ├── deleteBranch()
│   ├── listBranches()
│   ├── getCurrentBranch()
│   ├── switchBranch()
│   └── branchExists()
│
├── Commit/Diff 관련 (약 80줄)
│   ├── getCommitDiff()
│   ├── commitChanges()
│   ├── getLastCommitMessage()
│   └── hasUncommittedChanges()
│
├── Remote 관련 (약 50줄)
│   ├── pushBranch()
│   ├── fetchBranch()
│   └── getRemoteUrl()
│
├── Merge 관련 (약 60줄)
│   ├── mergeBranch()
│   ├── abortMerge()
│   └── resolveConflicts()
│
└── 유틸리티 (약 40줄)
    ├── getRepoRoot()
    ├── isGitRepo()
    └── execGit()
```

### 문제점
1. 모든 Git 기능이 단일 파일에 혼재
2. 함수명이 일관적이지 않음 (예: `createWorktree` vs `deleteBranch`)
3. 에러 처리가 각 함수마다 다름

## 목표 구조

```
src/services/git/
├── index.ts              # 통합 API export
├── types.ts              # Git 관련 타입
├── utils.ts              # 공통 유틸리티 (execGit, isGitRepo)
├── worktree.ts           # Worktree 연산
├── branch.ts             # Branch 연산
├── commit.ts             # Commit/Diff 연산
├── remote.ts             # Remote 연산
└── merge.ts              # Merge 연산
```

### 예상 파일 크기

| 파일 | 예상 라인 | 책임 |
|------|----------|------|
| `types.ts` | ~30 | Git 관련 타입 정의 |
| `utils.ts` | ~50 | execGit, isGitRepo, getRepoRoot |
| `worktree.ts` | ~120 | Worktree CRUD |
| `branch.ts` | ~100 | Branch CRUD |
| `commit.ts` | ~80 | Commit, Diff |
| `remote.ts` | ~50 | Push, Fetch |
| `merge.ts` | ~60 | Merge, Conflict |
| **총계** | **~490** | 기존 499줄과 유사 (구조 개선) |

## 상세 작업

### 1. `services/git/types.ts`

```typescript
// src/services/git/types.ts

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
  isMain: boolean;
}

export interface BranchInfo {
  name: string;
  isRemote: boolean;
  isCurrent: boolean;
  lastCommit?: string;
}

export interface CommitInfo {
  hash: string;
  author: string;
  date: string;
  message: string;
}

export interface MergeResult {
  success: boolean;
  conflicts?: string[];
  message?: string;
}

export interface GitExecOptions {
  cwd?: string;
  throwOnError?: boolean;
  timeout?: number;
}

export interface RetryConfig {
  maxRetries: number;
  delayMs: number;
  backoffMultiplier: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  delayMs: 1000,
  backoffMultiplier: 2,
};

export const WORKTREE_LOCK_TIMEOUT = 30000;
```

### 2. `services/git/utils.ts`

```typescript
// src/services/git/utils.ts

import { execSync, ExecSyncOptionsWithStringEncoding } from 'child_process';
import type { GitExecOptions, RetryConfig } from './types';
import { DEFAULT_RETRY_CONFIG } from './types';

/**
 * Execute a git command with error handling
 */
export function execGit(
  args: string[], 
  options: GitExecOptions = {}
): string {
  const { cwd = process.cwd(), throwOnError = true, timeout = 30000 } = options;
  
  const execOptions: ExecSyncOptionsWithStringEncoding = {
    cwd,
    encoding: 'utf8',
    timeout,
    stdio: ['pipe', 'pipe', 'pipe'],
  };

  try {
    return execSync(`git ${args.join(' ')}`, execOptions).trim();
  } catch (error: any) {
    if (throwOnError) {
      const stderr = error.stderr?.toString() || error.message;
      throw new Error(`Git command failed: git ${args.join(' ')}\n${stderr}`);
    }
    return '';
  }
}

/**
 * Check if directory is a git repository
 */
export function isGitRepo(dir: string = process.cwd()): boolean {
  try {
    execGit(['rev-parse', '--git-dir'], { cwd: dir, throwOnError: false });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get repository root directory
 */
export function getRepoRoot(cwd: string = process.cwd()): string {
  return execGit(['rev-parse', '--show-toplevel'], { cwd });
}

/**
 * Retry a git operation with exponential backoff
 */
export async function withRetry<T>(
  operation: () => Promise<T> | T,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  let lastError: Error | undefined;
  let delay = config.delayMs;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      if (attempt < config.maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= config.backoffMultiplier;
      }
    }
  }

  throw lastError;
}

/**
 * Sleep utility
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

### 3. `services/git/worktree.ts`

```typescript
// src/services/git/worktree.ts

import * as fs from 'fs';
import * as path from 'path';
import { execGit, withRetry, sleep } from './utils';
import type { WorktreeInfo, RetryConfig } from './types';
import { WORKTREE_LOCK_TIMEOUT, DEFAULT_RETRY_CONFIG } from './types';

/**
 * Create a new worktree
 */
export async function createWorktree(
  worktreePath: string,
  branch: string,
  options: { baseBranch?: string; force?: boolean; retryConfig?: RetryConfig } = {}
): Promise<void> {
  const { baseBranch, force = false, retryConfig = DEFAULT_RETRY_CONFIG } = options;

  await withRetry(async () => {
    // Wait for any lock to be released
    await waitForLock(worktreePath);

    const args = ['worktree', 'add'];
    if (force) args.push('--force');
    args.push(worktreePath, '-b', branch);
    if (baseBranch) args.push(baseBranch);

    execGit(args);
  }, retryConfig);
}

/**
 * Remove a worktree
 */
export async function removeWorktree(
  worktreePath: string,
  options: { force?: boolean } = {}
): Promise<void> {
  const { force = false } = options;

  await waitForLock(worktreePath);

  const args = ['worktree', 'remove'];
  if (force) args.push('--force');
  args.push(worktreePath);

  try {
    execGit(args);
  } catch {
    // If worktree removal fails, try to clean up manually
    if (force && fs.existsSync(worktreePath)) {
      fs.rmSync(worktreePath, { recursive: true, force: true });
      execGit(['worktree', 'prune']);
    }
  }
}

/**
 * List all worktrees
 */
export function listWorktrees(cwd?: string): WorktreeInfo[] {
  const output = execGit(['worktree', 'list', '--porcelain'], { cwd });
  const worktrees: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> = {};

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      current.path = line.substring(9);
    } else if (line.startsWith('HEAD ')) {
      current.head = line.substring(5);
    } else if (line.startsWith('branch ')) {
      current.branch = line.substring(7).replace('refs/heads/', '');
    } else if (line === '') {
      if (current.path) {
        worktrees.push({
          path: current.path,
          branch: current.branch || 'detached',
          head: current.head || '',
          isMain: worktrees.length === 0,
        });
      }
      current = {};
    }
  }

  return worktrees;
}

/**
 * Check if worktree has uncommitted changes
 */
export function isWorktreeClean(worktreePath: string): boolean {
  const status = execGit(['status', '--porcelain'], { cwd: worktreePath });
  return status.trim() === '';
}

/**
 * Check if current directory is in a worktree
 */
export function isInWorktree(cwd: string = process.cwd()): boolean {
  try {
    const gitDir = execGit(['rev-parse', '--git-dir'], { cwd });
    return gitDir.includes('.git/worktrees/');
  } catch {
    return false;
  }
}

/**
 * Wait for worktree lock to be released
 */
async function waitForLock(worktreePath: string, timeout = WORKTREE_LOCK_TIMEOUT): Promise<void> {
  const lockPath = path.join(worktreePath, '.git', 'index.lock');
  const startTime = Date.now();

  while (fs.existsSync(lockPath)) {
    if (Date.now() - startTime > timeout) {
      throw new Error(`Worktree lock timeout: ${lockPath}`);
    }
    await sleep(100);
  }
}
```

### 4. `services/git/branch.ts`

```typescript
// src/services/git/branch.ts

import { execGit } from './utils';
import type { BranchInfo } from './types';

/**
 * Create a new branch
 */
export function createBranch(
  branchName: string,
  options: { baseBranch?: string; cwd?: string } = {}
): void {
  const { baseBranch, cwd } = options;
  const args = ['checkout', '-b', branchName];
  if (baseBranch) args.push(baseBranch);
  execGit(args, { cwd });
}

/**
 * Delete a branch
 */
export function deleteBranch(
  branchName: string,
  options: { force?: boolean; remote?: boolean; cwd?: string } = {}
): void {
  const { force = false, remote = false, cwd } = options;

  if (remote) {
    execGit(['push', 'origin', '--delete', branchName], { cwd, throwOnError: false });
  }

  const args = ['branch', force ? '-D' : '-d', branchName];
  execGit(args, { cwd, throwOnError: !force });
}

/**
 * List branches
 */
export function listBranches(
  options: { remote?: boolean; cwd?: string } = {}
): BranchInfo[] {
  const { remote = false, cwd } = options;
  const args = ['branch', '--format=%(refname:short)|%(objectname:short)|%(HEAD)'];
  if (remote) args.push('-r');

  const output = execGit(args, { cwd });
  return output.split('\n').filter(Boolean).map(line => {
    const [name, lastCommit, head] = line.split('|');
    return {
      name: name!.trim(),
      lastCommit: lastCommit!.trim(),
      isRemote: remote,
      isCurrent: head === '*',
    };
  });
}

/**
 * Get current branch name
 */
export function getCurrentBranch(cwd?: string): string {
  return execGit(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
}

/**
 * Switch to a branch
 */
export function switchBranch(branchName: string, cwd?: string): void {
  execGit(['checkout', branchName], { cwd });
}

/**
 * Check if branch exists
 */
export function branchExists(
  branchName: string,
  options: { remote?: boolean; cwd?: string } = {}
): boolean {
  const { remote = false, cwd } = options;
  try {
    const ref = remote ? `refs/remotes/origin/${branchName}` : `refs/heads/${branchName}`;
    execGit(['show-ref', '--verify', '--quiet', ref], { cwd });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get branch tracking info
 */
export function getBranchTracking(branchName: string, cwd?: string): string | null {
  try {
    return execGit(['config', '--get', `branch.${branchName}.remote`], { cwd, throwOnError: false }) || null;
  } catch {
    return null;
  }
}
```

### 5. `services/git/commit.ts`

```typescript
// src/services/git/commit.ts

import { execGit } from './utils';
import type { CommitInfo } from './types';

/**
 * Get diff for a commit
 */
export function getCommitDiff(
  commitHash: string,
  options: { cwd?: string; stat?: boolean } = {}
): string {
  const { cwd, stat = false } = options;
  const args = ['diff', stat ? '--stat' : '-p', `${commitHash}^`, commitHash];
  return execGit(args, { cwd });
}

/**
 * Commit all changes
 */
export function commitChanges(
  message: string,
  options: { cwd?: string; allowEmpty?: boolean } = {}
): string {
  const { cwd, allowEmpty = false } = options;

  // Stage all changes
  execGit(['add', '-A'], { cwd });

  // Commit
  const args = ['commit', '-m', message];
  if (allowEmpty) args.push('--allow-empty');

  return execGit(args, { cwd });
}

/**
 * Get last commit message
 */
export function getLastCommitMessage(cwd?: string): string {
  return execGit(['log', '-1', '--format=%B'], { cwd }).trim();
}

/**
 * Get last commit hash
 */
export function getLastCommitHash(cwd?: string): string {
  return execGit(['rev-parse', 'HEAD'], { cwd });
}

/**
 * Check if there are uncommitted changes
 */
export function hasUncommittedChanges(cwd?: string): boolean {
  const status = execGit(['status', '--porcelain'], { cwd });
  return status.trim() !== '';
}

/**
 * Get commit info
 */
export function getCommitInfo(commitHash: string, cwd?: string): CommitInfo {
  const format = '%H|%an|%aI|%s';
  const output = execGit(['log', '-1', `--format=${format}`, commitHash], { cwd });
  const [hash, author, date, message] = output.split('|');

  return {
    hash: hash!.trim(),
    author: author!.trim(),
    date: date!.trim(),
    message: message!.trim(),
  };
}

/**
 * Get file changes between commits
 */
export function getChangedFiles(
  fromCommit: string,
  toCommit: string = 'HEAD',
  cwd?: string
): string[] {
  const output = execGit(['diff', '--name-only', fromCommit, toCommit], { cwd });
  return output.split('\n').filter(Boolean);
}
```

### 6. `services/git/remote.ts`

```typescript
// src/services/git/remote.ts

import { execGit } from './utils';

/**
 * Push branch to remote
 */
export function pushBranch(
  branchName: string,
  options: { remote?: string; force?: boolean; setUpstream?: boolean; cwd?: string } = {}
): void {
  const { remote = 'origin', force = false, setUpstream = false, cwd } = options;

  const args = ['push'];
  if (force) args.push('--force');
  if (setUpstream) args.push('-u');
  args.push(remote, branchName);

  execGit(args, { cwd });
}

/**
 * Fetch from remote
 */
export function fetchBranch(
  branchName?: string,
  options: { remote?: string; prune?: boolean; cwd?: string } = {}
): void {
  const { remote = 'origin', prune = false, cwd } = options;

  const args = ['fetch', remote];
  if (branchName) args.push(branchName);
  if (prune) args.push('--prune');

  execGit(args, { cwd });
}

/**
 * Get remote URL
 */
export function getRemoteUrl(remoteName: string = 'origin', cwd?: string): string | null {
  try {
    return execGit(['remote', 'get-url', remoteName], { cwd, throwOnError: false }) || null;
  } catch {
    return null;
  }
}

/**
 * List remotes
 */
export function listRemotes(cwd?: string): string[] {
  const output = execGit(['remote'], { cwd, throwOnError: false });
  return output.split('\n').filter(Boolean);
}

/**
 * Add remote
 */
export function addRemote(name: string, url: string, cwd?: string): void {
  execGit(['remote', 'add', name, url], { cwd });
}
```

### 7. `services/git/merge.ts`

```typescript
// src/services/git/merge.ts

import { execGit } from './utils';
import type { MergeResult } from './types';

/**
 * Merge a branch
 */
export function mergeBranch(
  branchName: string,
  options: { message?: string; noFf?: boolean; cwd?: string } = {}
): MergeResult {
  const { message, noFf = false, cwd } = options;

  const args = ['merge'];
  if (noFf) args.push('--no-ff');
  if (message) args.push('-m', message);
  args.push(branchName);

  try {
    execGit(args, { cwd });
    return { success: true };
  } catch (error: any) {
    // Check for conflicts
    const status = execGit(['status', '--porcelain'], { cwd, throwOnError: false });
    const conflicts = status
      .split('\n')
      .filter(line => line.startsWith('UU '))
      .map(line => line.substring(3));

    if (conflicts.length > 0) {
      return { success: false, conflicts };
    }

    return { success: false, message: error.message };
  }
}

/**
 * Abort an in-progress merge
 */
export function abortMerge(cwd?: string): void {
  execGit(['merge', '--abort'], { cwd, throwOnError: false });
}

/**
 * Check if merge is in progress
 */
export function isMergeInProgress(cwd?: string): boolean {
  try {
    execGit(['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get list of conflicted files
 */
export function getConflictedFiles(cwd?: string): string[] {
  const output = execGit(['diff', '--name-only', '--diff-filter=U'], { cwd, throwOnError: false });
  return output.split('\n').filter(Boolean);
}

/**
 * Mark file as resolved
 */
export function markResolved(filePath: string, cwd?: string): void {
  execGit(['add', filePath], { cwd });
}

/**
 * Cherry-pick a commit
 */
export function cherryPick(
  commitHash: string,
  options: { noCommit?: boolean; cwd?: string } = {}
): void {
  const { noCommit = false, cwd } = options;
  const args = ['cherry-pick'];
  if (noCommit) args.push('-n');
  args.push(commitHash);
  execGit(args, { cwd });
}
```

### 8. `services/git/index.ts`

```typescript
// src/services/git/index.ts

// Types
export * from './types';

// Utils
export { execGit, isGitRepo, getRepoRoot, withRetry } from './utils';

// Worktree
export {
  createWorktree,
  removeWorktree,
  listWorktrees,
  isWorktreeClean,
  isInWorktree,
} from './worktree';

// Branch
export {
  createBranch,
  deleteBranch,
  listBranches,
  getCurrentBranch,
  switchBranch,
  branchExists,
} from './branch';

// Commit
export {
  getCommitDiff,
  commitChanges,
  getLastCommitMessage,
  getLastCommitHash,
  hasUncommittedChanges,
  getCommitInfo,
  getChangedFiles,
} from './commit';

// Remote
export {
  pushBranch,
  fetchBranch,
  getRemoteUrl,
  listRemotes,
  addRemote,
} from './remote';

// Merge
export {
  mergeBranch,
  abortMerge,
  isMergeInProgress,
  getConflictedFiles,
  markResolved,
  cherryPick,
} from './merge';
```

## 마이그레이션 가이드

### Before
```typescript
import * as git from '../utils/git';
git.createWorktree(path, branch);
```

### After
```typescript
import * as git from '../services/git';
// 또는
import { createWorktree } from '../services/git';

await git.createWorktree(path, branch);
// 또는
await createWorktree(path, branch);
```

### 주요 변경점
1. `createWorktree`가 `async` 함수로 변경 (락 대기 로직)
2. 모든 함수에 일관된 `options` 패턴 적용
3. 타입이 `types.ts`로 분리

## 테스트 계획

1. **유닛 테스트**: 각 함수별 독립 테스트
2. **통합 테스트**: Worktree 생성 → 브랜치 작업 → 삭제 시나리오
3. **에러 케이스**: 잘못된 경로, 존재하지 않는 브랜치 등

## 체크리스트

- [ ] `services/git/` 디렉토리 생성
- [ ] `types.ts` 작성
- [ ] `utils.ts` 작성
- [ ] `worktree.ts` 작성
- [ ] `branch.ts` 작성
- [ ] `commit.ts` 작성
- [ ] `remote.ts` 작성
- [ ] `merge.ts` 작성
- [ ] `index.ts` 작성
- [ ] 모든 import 경로 변경
- [ ] `utils/git.ts` 삭제
- [ ] 테스트 실행


# CursorFlow Hook System Guide

CursorFlow의 Hook 시스템을 사용하면 외부 개발자가 **Supervisor AI**, **모니터링 시스템**, **커스텀 로직** 등을 구현하여 태스크 실행 플로우에 개입할 수 있습니다.

## 목차

- [Quick Start](#quick-start)
- [Hook Points](#hook-points)
- [데이터 접근 (HookDataAccessor)](#데이터-접근-hookdataaccessor)
- [플로우 제어 (FlowController)](#플로우-제어-flowcontroller)
- [설정](#설정)
- [사용 예시](#사용-예시)
- [API 레퍼런스](#api-레퍼런스)

---

## Quick Start

```typescript
// cursorflow.hooks.ts
import { hooks, HookPoint } from '@litmers/cursorflow-orchestrator';

// 태스크 완료 후 결과 리뷰
hooks.register({
  point: HookPoint.AFTER_TASK,
  mode: 'sync',
  name: 'my-reviewer',
  handler: async (ctx) => {
    // 수정된 파일 확인
    const files = await ctx.getData.git.getChangedFiles();
    console.log('Modified files:', files.map(f => f.path));
    
    // AI 응답 분석
    const response = await ctx.getData.conversation.getLastResponse();
    
    // 필요시 추가 태스크 삽입
    if (needsFix(response)) {
      ctx.flow.injectTask({
        name: `Fix: ${ctx.task.name}`,
        prompt: 'Fix the issues found in the previous task...',
      });
    }
  },
});

export default hooks;
```

`.cursorflow.json`에서 Hook 파일 지정:

```json
{
  "hooks": {
    "file": "./cursorflow.hooks.ts"
  }
}
```

---

## Hook Points

CursorFlow는 5개의 핵심 Hook Point를 제공합니다.

| Hook Point | 트리거 시점 | 주요 용도 | 모드 |
|------------|------------|----------|------|
| `beforeTask` | 태스크 실행 직전 | 프롬프트 검토/수정, 사전 조건 검증 | `sync` 권장 |
| `afterTask` | 태스크 완료 직후 | 결과 리뷰, 품질 검사, 추가 태스크 삽입 | `sync` 권장 |
| `onError` | 에러 발생 시 | 에러 분석, 복구 전략 결정 | `sync` 권장 |
| `onStall` | 응답 없음 감지 시 | 상황 분석, 개입 메시지 전송 | `sync` 권장 |
| `onLaneEnd` | Lane 종료 시 | 최종 리뷰, 보고서 생성 | `async` 권장 |

### Hook 실행 모드

- **`sync`** (동기): 핸들러가 완료될 때까지 플로우가 대기합니다. 플로우 제어가 필요할 때 사용합니다.
- **`async`** (비동기): 핸들러를 백그라운드에서 실행하고 플로우는 즉시 계속됩니다. 알림, 로깅 등에 적합합니다.

---

## 데이터 접근 (HookDataAccessor)

`ctx.getData`를 통해 다양한 실행 컨텍스트 데이터에 접근할 수 있습니다.

### Git 정보

```typescript
const git = ctx.getData.git;

// 현재 태스크에서 수정된 파일 목록
const files = await git.getChangedFiles();
// => [{ path: 'src/app.ts', status: 'modified', additions: 10, deletions: 2 }]

// 전체 diff
const diff = await git.getDiff();

// 최근 커밋
const commits = await git.getRecentCommits(5);

// 현재 브랜치
const branch = git.getCurrentBranch();

// 충돌 파일 (있는 경우)
const conflicts = await git.getConflictFiles();
```

### 대화 기록

```typescript
const conversation = ctx.getData.conversation;

// 현재 태스크의 대화 기록
const taskMessages = await conversation.getCurrentTaskMessages();

// 전체 Lane의 대화 기록
const allMessages = await conversation.getAllMessages();

// 최근 N개 메시지
const recent = await conversation.getRecentMessages(10);

// AI의 마지막 응답
const lastResponse = await conversation.getLastResponse();
```

### 태스크 상태

```typescript
const tasks = ctx.getData.tasks;

// 완료된 태스크 목록
const completed = tasks.getCompletedTasks();
// => [{ name: 'task-1', status: 'success', duration: 12000 }]

// 남은 태스크 목록
const pending = tasks.getPendingTasks();

// 특정 태스크의 결과
const result = tasks.getTaskResult('implement-feature');

// 의존성 태스크 결과
const deps = tasks.getDependencyResults();
```

### 로그/출력

```typescript
const logs = ctx.getData.logs;

// 현재 태스크의 raw 출력
const rawOutput = await logs.getRawOutput();

// AI가 호출한 tool call 목록
const toolCalls = await logs.getToolCalls();
// => [{ name: 'read_file', parameters: { path: 'src/app.ts' }, timestamp: '...' }]

// 에러 로그
const errors = await logs.getErrors();
```

### 타이밍 정보

```typescript
const timing = ctx.getData.timing;

// 태스크 시작 시간 (Unix timestamp)
const taskStart = timing.taskStartTime;

// Lane 시작 시간
const laneStart = timing.laneStartTime;

// 현재 태스크 소요 시간 (ms)
const elapsed = timing.getElapsedTime();
```

---

## 플로우 제어 (FlowController)

`ctx.flow`를 통해 실행 플로우를 제어할 수 있습니다.

### 플로우 제어

```typescript
// 플로우 일시 중지 (외부 승인 대기 등)
await ctx.flow.pause('Waiting for manual review');

// 플로우 재개 (외부에서 호출)
ctx.flow.resume({ approved: true });

// Lane 중단
ctx.flow.abort('Critical error detected');

// 현재 태스크 재시도
ctx.flow.retry();
// 수정된 프롬프트로 재시도
ctx.flow.retry({ modifiedPrompt: 'Please try again with...' });
```

### 태스크 조작

```typescript
// 다음에 실행할 태스크 삽입
ctx.flow.injectTask({
  name: 'Fix: validation error',
  prompt: 'Fix the validation error in src/validator.ts',
  model: 'claude-sonnet-4-20250514',
});

// 현재 태스크 프롬프트 수정 (beforeTask에서만)
ctx.flow.modifyCurrentPrompt('Updated prompt with more context...');

// 다음 태스크 수정
ctx.flow.modifyNextTask((task) => ({
  ...task,
  prompt: task.prompt + '\n\nAdditional context: ...',
}));

// 남은 태스크 전체 교체
ctx.flow.replaceRemainingTasks([
  { name: 'new-task-1', prompt: '...' },
  { name: 'new-task-2', prompt: '...' },
]);
```

### AI 통신

```typescript
// 현재 세션의 AI에게 메시지 전송
const response = await ctx.flow.sendMessage('Please continue with...');

// 별도 AI 세션 호출 (Supervisor AI 등)
const analysis = await ctx.flow.callAI(
  'Analyze the following code and suggest improvements...',
  { model: 'claude-sonnet-4-20250514', timeout: 60000 }
);
```

---

## 설정

### `.cursorflow.json` 설정

```json
{
  "hooks": {
    "file": "./cursorflow.hooks.ts",
    "timeout": 30000,
    "continueOnError": false,
    "debug": false
  }
}
```

| 옵션 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `file` | `string` | - | Hook 정의 파일 경로 |
| `timeout` | `number` | `30000` | Hook 실행 타임아웃 (ms) |
| `continueOnError` | `boolean` | `false` | Hook 에러 시 계속 진행 여부 |
| `debug` | `boolean` | `false` | 디버그 로깅 활성화 |

### 프로그래매틱 설정

```typescript
import { getHookManager } from '@litmers/cursorflow-orchestrator';

const hookManager = getHookManager();

hookManager.configure({
  timeout: 60000,
  continueOnError: true,
  debug: true,
});
```

---

## 사용 예시

### 예시 1: Supervisor AI로 결과 리뷰

```typescript
import { hooks, HookPoint } from '@litmers/cursorflow-orchestrator';
import OpenAI from 'openai';

const openai = new OpenAI();

hooks.register({
  point: HookPoint.AFTER_TASK,
  mode: 'sync',
  name: 'supervisor-reviewer',
  handler: async (ctx) => {
    // 태스크 결과 수집
    const changedFiles = await ctx.getData.git.getChangedFiles();
    const lastResponse = await ctx.getData.conversation.getLastResponse();
    const toolCalls = await ctx.getData.logs.getToolCalls();
    
    // Supervisor AI로 리뷰 요청
    const review = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are a senior code reviewer. Evaluate if the task was completed correctly.',
        },
        {
          role: 'user',
          content: `
Task: ${ctx.task.name}
Prompt: ${ctx.task.prompt}

Files Changed:
${changedFiles.map(f => `- ${f.path} (${f.status})`).join('\n')}

AI Response:
${lastResponse}

Tool Calls:
${toolCalls.map(t => `- ${t.name}`).join('\n')}

Evaluate: Was this task completed correctly? If not, what needs to be fixed?
          `,
        },
      ],
    });
    
    const verdict = review.choices[0]?.message?.content || '';
    
    // 수정이 필요하면 태스크 삽입
    if (verdict.toLowerCase().includes('needs fix') || verdict.toLowerCase().includes('incorrect')) {
      ctx.flow.injectTask({
        name: `Review Fix: ${ctx.task.name}`,
        prompt: `The previous task has issues:\n\n${verdict}\n\nPlease fix the problems.`,
      });
    }
  },
});
```

### 예시 2: 테스트 실행 후 자동 수정

```typescript
hooks.register({
  point: HookPoint.AFTER_TASK,
  mode: 'sync',
  name: 'auto-test-fixer',
  handler: async (ctx) => {
    // 테스트 관련 태스크만 처리
    if (!ctx.task.name.includes('test')) return;
    
    const errors = await ctx.getData.logs.getErrors();
    const testFailures = errors.filter(e => 
      e.message.includes('FAIL') || e.message.includes('AssertionError')
    );
    
    if (testFailures.length > 0) {
      // 테스트 실패 정보와 함께 수정 태스크 삽입
      ctx.flow.injectTask({
        name: `Fix Test Failures`,
        prompt: `
The following tests are failing:

${testFailures.map(e => e.message).join('\n')}

Please analyze the test failures and fix the code to make all tests pass.
        `,
      });
    }
  },
});
```

### 예시 3: 프롬프트 자동 개선

```typescript
hooks.register({
  point: HookPoint.BEFORE_TASK,
  mode: 'sync',
  name: 'prompt-enhancer',
  handler: async (ctx) => {
    // 의존성 태스크 결과를 프롬프트에 추가
    const deps = ctx.getData.tasks.getDependencyResults();
    
    if (deps.length > 0) {
      const depsContext = deps
        .filter(d => d.status === 'success')
        .map(d => `[${d.taskName}]: ${d.output?.substring(0, 500)}`)
        .join('\n\n');
      
      const enhancedPrompt = `
${ctx.task.prompt}

---
Context from dependency tasks:
${depsContext}
      `;
      
      ctx.flow.modifyCurrentPrompt(enhancedPrompt);
    }
  },
});
```

### 예시 4: Slack 알림

```typescript
hooks.register({
  point: HookPoint.ON_LANE_END,
  mode: 'async', // 비동기 - Lane 완료를 블로킹하지 않음
  name: 'slack-notifier',
  handler: async (ctx) => {
    const { summary } = ctx as any;
    
    const message = summary.status === 'completed'
      ? `✅ Lane "${ctx.laneName}" completed! ${summary.completedTasks} tasks done in ${Math.round(summary.totalDuration / 1000)}s`
      : `❌ Lane "${ctx.laneName}" failed. ${summary.failedTasks} tasks failed.`;
    
    await fetch(process.env.SLACK_WEBHOOK_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    });
  },
});
```

### 예시 5: 에러 자동 복구

```typescript
hooks.register({
  point: HookPoint.ON_ERROR,
  mode: 'sync',
  name: 'auto-recovery',
  handler: async (ctx) => {
    const { error } = ctx as any;
    
    // Git 충돌 자동 해결
    if (error.type === 'git_error' && error.message.includes('conflict')) {
      const conflicts = await ctx.getData.git.getConflictFiles();
      
      ctx.flow.retry({
        modifiedPrompt: `
There are merge conflicts in the following files:
${conflicts.join('\n')}

Please resolve the conflicts by:
1. Reading the conflicted files
2. Understanding both versions
3. Merging the changes appropriately
4. Removing conflict markers
        `,
      });
      return;
    }
    
    // 타임아웃은 재시도
    if (error.type === 'timeout' && error.retryable) {
      ctx.flow.retry();
      return;
    }
    
    // 복구 불가능한 에러는 중단
    ctx.flow.abort(`Unrecoverable error: ${error.message}`);
  },
});
```

---

## API 레퍼런스

### HookRegistration

```typescript
interface HookRegistration {
  point: HookPoint;           // Hook Point
  mode: 'sync' | 'async';     // 실행 모드
  handler: (ctx) => void | Promise<void>;  // 핸들러 함수
  priority?: number;          // 우선순위 (낮을수록 먼저, 기본: 50)
  name?: string;              // 핸들러 이름 (디버깅용)
  enabled?: boolean;          // 활성화 여부 (기본: true)
}
```

### HookContext

```typescript
interface HookContext {
  laneName: string;           // Lane 이름
  runId: string;              // Run ID
  taskIndex: number;          // 현재 태스크 인덱스 (0-based)
  totalTasks: number;         // 전체 태스크 수
  task: {
    name: string;
    prompt: string;
    model: string;
    dependsOn?: string[];
  };
  flow: FlowController;       // 플로우 컨트롤러
  getData: HookDataAccessor;  // 데이터 접근자
}
```

### Hook Point별 추가 필드

| Hook Point | 추가 필드 | 타입 |
|------------|----------|------|
| `afterTask` | `result` | `{ status, exitCode?, error? }` |
| `onError` | `error` | `{ type, message, stack?, retryable }` |
| `onStall` | `stall` | `{ idleTimeMs, lastActivity, bytesReceived, phase }` |
| `onLaneEnd` | `summary` | `{ status, completedTasks, failedTasks, totalDuration }` |

---

## 주의사항

1. **`sync` 모드 Hook은 실행 시간에 주의**: 오래 걸리는 작업은 `async` 모드를 사용하거나 타임아웃을 적절히 설정하세요.

2. **무한 루프 방지**: `afterTask`에서 `injectTask()`를 호출할 때 조건을 명확히 해서 무한 루프를 방지하세요.

3. **상태 변경 주의**: `flow.replaceRemainingTasks()`는 남은 모든 태스크를 교체하므로 신중하게 사용하세요.

4. **에러 처리**: Hook 내에서 발생한 에러는 기본적으로 플로우를 중단합니다. `continueOnError: true`로 설정하면 에러를 무시하고 계속 진행합니다.

5. **비동기 Hook**: `async` 모드 Hook은 백그라운드에서 실행되므로 플로우 제어 메서드(`abort`, `retry` 등)가 효과가 없을 수 있습니다.

---

## 관련 문서

- [MODULE_GUIDE.md](./MODULE_GUIDE.md) - 모듈 구조 및 아키텍처
- [CURSOR_AGENT_GUIDE.md](./CURSOR_AGENT_GUIDE.md) - cursor-agent CLI 사용법
- [TEST_ARCHITECTURE.md](./TEST_ARCHITECTURE.md) - 테스트 아키텍처

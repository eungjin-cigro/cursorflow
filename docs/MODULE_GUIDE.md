# CursorFlow 핵심 모듈 및 파일 가이드

이 문서는 CursorFlow의 주요 모듈과 파일들의 역할, 그리고 이들이 전체 시스템에서 어떻게 상호작용하는지를 설명합니다.

> 💡 **중요**: 핵심 아키텍처 원칙과 설계 철학은 **[ARCHITECTURE.md](./ARCHITECTURE.md)**를, 주요 설계 결정 히스토리는 **[ADR 디렉토리](./ADR/README.md)**를 참조하십시오.

## 📁 디렉토리 구조 개요

```
src/
├── cli/              # 사용자 커맨드 라인 인터페이스 진입점
├── core/             # 오케스트레이션 및 실행 로직 (Core Engine)
│   └── runner/       # 개별 Lane 실행 로직
├── services/         # 로깅, 프로세스 관리 등 공통 서비스 인프라
│   ├── logging/      # 로깅 시스템
│   └── process/      # 프로세스 관리
├── utils/            # Git, Config, Health Check 등 헬퍼 유틸리티
└── types/            # TypeScript 타입 정의
```

---

## 1. CLI (`src/cli`)

사용자와 상호작용하며 명령어를 파싱하고 적절한 코어 로직을 호출하는 진입점입니다.

| 파일 | 역할 | 활용 |
|------|------|------|
| `index.ts` | 메인 진입점. `process.argv` 파싱 및 명령어 라우팅 | `cursorflow <command>` 실행 시 최초 실행 |
| `run.ts` | `run` 명령어 핸들러 | 실행 옵션 파싱 후 `orchestrator.ts` 호출 |
| `monitor.ts` | 실시간 대시보드 UI (v2.0 탭 기반) | 실행 중인 워크플로우 상태 모니터링 |
| `logs.ts` | 로그 조회 및 내보내기 | Lane별/통합 로그 확인 |
| `init.ts`, `new.ts`, `add.ts` | 프로젝트/Flow/Task 생성 | 초기 설정 및 구성 |
| `resume.ts` | 중단된 실행 재개 | 실패 지점부터 재시작 |
| `clean.ts` | 리소스 정리 | Worktree/브랜치 삭제 |

---

## 2. Core (`src/core`)

CursorFlow의 핵심 엔진으로, 병렬 실행 관리, 에러 복구, 작업 실행을 담당합니다.

### 2.1 오케스트레이션 레이어

| 파일 | 역할 | 책임 |
|------|------|------|
| **`orchestrator.ts`** | **중앙 관리자(Brain)** | Lane 생명주기 관리, Worktree 격리, 의존성 해결, 교착상태 방지 |
| **`stall-detection.ts`** | **Stall 감지 서비스** | 응답 없는 Lane 감지, 다단계 복구 신호 전송 |
| **`auto-recovery.ts`** | **자동 복구 전략** | Git 충돌/네트워크 오류 시 자동 재시도 및 가이드 제공 |
| **`failure-policy.ts`** | **실패 정책 관리** | 실패 유형 분류, 복구 액션 결정, Circuit Breaker 통합 |

### 2.2 감독/조정 레이어

| 파일 | 역할 | 책임 |
|------|------|------|
| **`agent-supervisor.ts`** | **에이전트 감독자** | AI 에이전트 프롬프트 전송, 실패 분석, 이벤트 발행 |
| **`git-pipeline-coordinator.ts`** | **Git 파이프라인 조정자** | Worktree 생성/검증, 의존성 브랜치 머지, 충돌 처리 |

### 2.3 신규 생명주기 관리 레이어 (v2.1)

| 파일 | 역할 | 책임 |
|------|------|------|
| **`git-lifecycle-manager.ts`** | **Git 생명주기 관리자** | 작업 시작/종료 시 브랜치 관리, 안전한 커밋/푸시, 머지 자동화 |
| **`lane-state-machine.ts`** | **Lane 상태 머신** | 세분화된 상태 전이 관리, 복구/재시도 로직 중앙화, 상태 영속화 |

### 2.4 Runner 레이어 (`src/core/runner`)

개별 Lane 내에서 순차적으로 Task를 실행하는 Worker 모듈들입니다.

| 파일 | 역할 | 책임 |
|------|------|------|
| `index.ts` | Runner 진입점 | 프로세스 시그널 처리, 초기화 |
| `pipeline.ts` | 파이프라인 실행기 | Task 순차 실행, 상태 관리, 체크포인트 |
| `task.ts` | 개별 Task 실행 | 프롬프트 전송, 결과 파싱, 의존성 대기 |
| `agent.ts` | cursor-agent CLI 래퍼 | 채팅 생성, 메시지 전송, 응답 스트리밍 |
| `prompt.ts` | 프롬프트 생성기 | 컨텍스트 기반 프롬프트 조합 |
| `utils.ts` | Runner 유틸리티 | 공통 헬퍼 함수들 |

---

## 3. Services (`src/services`)

비즈니스 로직과 무관한 인프라성 기능을 제공합니다.

### 3.1 Logging (`src/services/logging`)

| 파일 | 역할 |
|------|------|
| `index.ts` | 로깅 모듈 export |
| `manager.ts` | 로그 관리자 (멀티 Lane 태깅) |
| `buffer.ts` | 로그 버퍼링 및 파일 출력 |
| `formatter.ts` | 로그 포맷팅 (ANSI, 타임스탬프) |
| `paths.ts` | 로그 파일 경로 관리 |
| `raw-log.ts` | Raw 로그 파싱 |

### 3.2 Process (`src/services/process`)

| 파일 | 역할 |
|------|------|
| `index.ts` | Lane 프로세스 상태 조회, Flow 요약 |

---

## 4. Utils (`src/utils`)

여러 모듈에서 공통적으로 사용되는 헬퍼 함수들입니다.

| 파일 | 역할 | 활용 |
|------|------|------|
| `cursor-agent.ts` | cursor-agent CLI 래퍼 | 설치 확인, 버전 체크, 명령어 생성 |
| `git.ts` | Git 명령어 래퍼 | Worktree, 브랜치, 커밋, 푸시 작업 |
| `state.ts` | Lane 상태 관리 | JSON 파일로 진행 상태 저장/복구 |
| `health.ts` | 시스템 상태 점검 | 필수 도구/인증 상태 검증 |
| `events.ts` | 이벤트 발행/구독 | 모듈간 비동기 통신 |
| **`event-registry.ts`** | **타입화된 이벤트 버스** | 카테고리별 이벤트 분류, 타입 안전 구독 |
| `retry.ts` | 재시도/Circuit Breaker | 실패 시 지수 백오프 재시도 |
| `config.ts` | 설정 로드 | `.cursorflow.json` 파싱 |
| `path.ts` | 안전한 경로 조합 | Path traversal 방지 |
| `checkpoint.ts` | 체크포인트 관리 | 복구 지점 생성/복원 |
| `logger.ts` | 범용 로거 | 콘솔/파일 출력, 컨텍스트 태깅 |

---

## 5. Types (`src/types`)

프로젝트 전반에서 사용되는 TypeScript 인터페이스 및 타입 정의입니다.

### 5.1 주요 타입

- `LaneConfig`, `LaneState` - Lane 설정/상태
- `Task`, `TaskExecutionResult` - Task 정의/실행 결과
- `RunState`, `RunnerConfig` - 실행 설정/상태
- `FailureType`, `RecoveryAction` - 실패 유형/복구 액션

### 5.2 신규 이벤트 카테고리 (v2.1)

`event-categories.ts`에서 정의된 타입들:

| 카테고리 | 설명 | 담당 모듈 |
|----------|------|-----------|
| `ORCHESTRATION` | 전체 실행 흐름 관리 | Orchestrator |
| `LANE` | 개별 Lane 생명주기 | Runner |
| `TASK` | Task 실행 관련 | Runner/Pipeline |
| `GIT` | Git 작업 관련 | GitLifecycleManager |
| `RECOVERY` | 복구 및 재시도 | StallDetectionService |
| `AGENT` | AI Agent 통신 | AgentSupervisor |
| `STATE` | 상태 전이 | LaneStateMachine |
| `SYSTEM` | 시스템 수준 | Infrastructure |

---

## 6. 모듈 상호작용 다이어그램

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                  CLI Layer                                   │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │  run    │ │ monitor │ │  logs   │ │ resume  │ │  clean  │ │  init   │   │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘   │
└───────┼──────────┼──────────┼──────────┼──────────┼──────────┼──────────────┘
        │          │          │          │          │          │
        ▼          ▼          ▼          ▼          ▼          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Core Layer                                      │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                         Orchestrator (Brain)                            │ │
│  │  • Lane 생명주기 관리  • 의존성 해결  • 병렬 실행 조율                   │ │
│  └────────────────────────────────┬───────────────────────────────────────┘ │
│                                   │                                          │
│  ┌──────────────┬────────────────┼────────────────┬──────────────┐         │
│  ▼              ▼                ▼                ▼              ▼         │
│  ┌────────┐ ┌────────────┐ ┌──────────────┐ ┌────────────┐ ┌────────────┐ │
│  │ Stall  │ │   Auto     │ │   Failure    │ │   Agent    │ │    Git     │ │
│  │Detect  │ │ Recovery   │ │   Policy     │ │ Supervisor │ │ Lifecycle  │ │
│  └────────┘ └────────────┘ └──────────────┘ └─────┬──────┘ └─────┬──────┘ │
│                                                    │              │         │
│  ┌──────────────────────────────────────┐         │              │         │
│  │         Lane State Machine           │◄────────┴──────────────┘         │
│  │  • 세분화된 상태 관리                │                                   │
│  │  • 상태 전이 검증                    │                                   │
│  │  • 복구/재시도 로직 중앙화           │                                   │
│  └──────────────────────────────────────┘                                   │
│                      │                                                       │
│  ┌───────────────────┴───────────────────────────────────────────────────┐ │
│  │                          Runner (Worker)                                │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐                   │ │
│  │  │ pipeline │ │   task   │ │  agent   │ │  prompt  │                   │ │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘                   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Services & Utils                                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   logging   │  │   process   │  │     git     │  │    state    │        │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘        │
│  ┌─────────────────────────────────────────────────────────────────┐       │
│  │                      Event Registry                              │       │
│  │  • 카테고리별 이벤트 분류  • 타입 안전 구독  • 이벤트 히스토리   │       │
│  └─────────────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Git 생명주기 아키텍처 (v2.1 신규)

### 7.1 Git 작업 흐름

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          GitLifecycleManager                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   1. startWork()                                                            │
│      ├── ensureWorktree() ─────────► 워크트리 생성/재사용                    │
│      ├── checkoutBranch() ─────────► 작업 브랜치 체크아웃                    │
│      └── mergeDependencies() ──────► 의존성 브랜치 머지                      │
│                │                                                             │
│                ▼                                                             │
│   2. (작업 진행)                                                             │
│      └── saveProgress() [선택] ────► 중간 커밋 저장                          │
│                │                                                             │
│                ▼                                                             │
│   3. finalizeWork()                                                         │
│      ├── stageAll() ───────────────► 모든 변경사항 스테이징                  │
│      ├── commit() ─────────────────► 커밋 생성                               │
│      └── push() ───────────────────► 원격으로 푸시                           │
│                │                                                             │
│                ▼                                                             │
│   4. mergeToTarget()                                                        │
│      ├── checkConflict() ──────────► 충돌 사전 체크                          │
│      ├── merge() ──────────────────► Task → Pipeline 머지                    │
│      └── push() ───────────────────► 머지 결과 푸시                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Git 생명주기 상태

| 상태 | 설명 |
|------|------|
| `IDLE` | 대기 상태 |
| `PREPARING` | 브랜치/워크트리 준비 중 |
| `WORKING` | 작업 진행 중 |
| `COMMITTING` | 커밋 중 |
| `PUSHING` | 푸시 중 |
| `MERGING` | 머지 중 |
| `ERROR` | 오류 발생 |

---

## 8. Lane 상태 머신 아키텍처 (v2.1 신규)

### 8.1 상태 계층

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          LaneStateMachine                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Primary State (주 상태)                                                     │
│  ├── PENDING ─────────────► 대기 중                                          │
│  ├── INITIALIZING ────────► 초기화 중                                        │
│  ├── RUNNING ─────────────► 실행 중                                          │
│  ├── WAITING ─────────────► 의존성 대기                                      │
│  ├── PAUSED ──────────────► 일시 중지                                        │
│  ├── RECOVERING ──────────► 복구 중                                          │
│  ├── COMPLETED ───────────► 완료                                             │
│  ├── FAILED ──────────────► 실패                                             │
│  └── ABORTED ─────────────► 강제 중단                                        │
│                                                                             │
│  Sub State (부 상태) - RUNNING 세부 단계                                     │
│  ├── PREPARING_GIT ───────► Git 워크트리 준비                                │
│  ├── MERGING_DEPENDENCIES ► 의존성 브랜치 머지                               │
│  ├── CREATING_TASK_BRANCH ► Task 브랜치 생성                                 │
│  ├── PREPARING_TASK ──────► Task 실행 준비                                   │
│  ├── EXECUTING_AGENT ─────► AI 에이전트와 통신 중                            │
│  ├── FINALIZING_TASK ─────► Task 완료 처리                                   │
│  ├── COMMITTING ──────────► 변경사항 커밋                                    │
│  ├── PUSHING ─────────────► 푸시                                             │
│  └── MERGING ─────────────► 머지                                             │
│                                                                             │
│  Recovery State (복구 상태)                                                  │
│  ├── IDLE ────────────────► 복구 필요 없음                                   │
│  ├── MONITORING ──────────► 모니터링 중                                      │
│  ├── CONTINUE_SENT ───────► Continue 신호 발송됨                             │
│  ├── STRONGER_PROMPT_SENT ► Stronger prompt 발송됨                           │
│  ├── RESTART_REQUESTED ───► 재시작 요청됨                                    │
│  ├── DIAGNOSED ───────────► 진단 완료                                        │
│  └── EXHAUSTED ───────────► 복구 포기                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 8.2 상태 전이 다이어그램

```
                              ┌──────────┐
                              │ PENDING  │
                              └────┬─────┘
                                   │ START
                                   ▼
                           ┌──────────────┐
                           │ INITIALIZING │
                           └──────┬───────┘
                     FAILURE │    │ INITIALIZED
                             ▼    ▼
              ┌────────┐  ┌─────────┐  ┌─────────────┐
              │ FAILED │◄─┤ RUNNING │◄─┤ RECOVERING  │
              └────────┘  └────┬────┘  └─────────────┘
                  ▲            │              ▲
                  │     ┌──────┴──────┐       │
                  │     │             │       │
                  │     ▼             ▼       │
                  │ ┌───────┐    ┌───────┐    │
                  └─┤WAITING│    │PAUSED │────┘
                    └───────┘    └───────┘
                         │
                         │ ALL_TASKS_COMPLETED
                         ▼
                    ┌──────────┐
                    │COMPLETED │
                    └──────────┘

         ※ 모든 상태에서 ABORT 트리거로 ABORTED 상태로 전이 가능
```

---

## 9. 이벤트 분류 체계 (v2.1 신규)

### 9.1 이벤트 카테고리

| 카테고리 | Prefix | 주요 이벤트 |
|----------|--------|-------------|
| **ORCHESTRATION** | `orchestration.` | started, completed, failed, cycle_detected |
| **LANE** | `lane.` | started, completed, failed, paused, waiting, blocked |
| **TASK** | `task.` | started, completed, failed, retry, waiting_dependency |
| **GIT** | `git.` | branch_created, committed, pushed, merge_conflict |
| **RECOVERY** | `recovery.` | continue_signal, stronger_prompt, restart, diagnosed |
| **AGENT** | `agent.` | prompt_sent, response_received, connection_error |
| **STATE** | `state.` | transition, transition_failed, persisted, corrupted |
| **SYSTEM** | `system.` | startup, shutdown, health_check, signal_received |

### 9.2 이벤트 구독 패턴

```typescript
import { EventRegistry, EventCategory, LaneEventType } from './utils/event-registry';

const registry = EventRegistry.getInstance();

// 특정 이벤트 구독
registry.on(LaneEventType.COMPLETED, (event) => {
  console.log(`Lane ${event.payload.laneName} completed`);
});

// 카테고리별 구독
registry.onCategory(EventCategory.GIT, (event) => {
  console.log('Git event:', event.type);
});

// 모든 이벤트 구독
registry.onAny((event) => {
  console.log('Event:', event.type);
});

// 이벤트 대기 (Promise)
const event = await registry.waitFor(LaneEventType.COMPLETED, {
  timeout: 30000,
  filter: (e) => e.payload.laneName === 'my-lane'
});
```

---

## 10. 실패 처리 아키텍처

### 10.1 실패 유형 (FailureType)

| 카테고리 | 유형 | 설명 |
|----------|------|------|
| **Stall** | `STALL_IDLE` | 출력 없이 대기 중 |
| | `STALL_NO_PROGRESS` | 상태 파일 미갱신 |
| | `STALL_ZERO_BYTES` | 응답 데이터 없음 |
| **Agent** | `AGENT_UNAVAILABLE` | cursor-agent 서비스 불가 |
| | `AGENT_AUTH_ERROR` | 인증 실패 |
| | `AGENT_RATE_LIMIT` | API 요청 제한 |
| | `AGENT_TIMEOUT` | 응답 시간 초과 |
| | `AGENT_NO_RESPONSE` | 완전 무응답 |
| **Dependency** | `DEPENDENCY_BLOCK` | 의존성 대기 중 |
| | `DEPENDENCY_FAILED` | 의존성 Lane 실패 |
| | `DEPENDENCY_TIMEOUT` | 의존성 대기 시간 초과 |
| **Git** | `GIT_ERROR` | Git 작업 실패 |
| | `GIT_PUSH_REJECTED` | Push 거부 |
| | `MERGE_CONFLICT` | 머지 충돌 |
| **기타** | `NETWORK_ERROR` | 네트워크 오류 |
| | `STATE_CORRUPTION` | 상태 파일 손상 |
| | `UNKNOWN_CRASH` | 알 수 없는 오류 |

### 10.2 복구 액션 (RecoveryAction)

| 액션 | 설명 | 적용 상황 |
|------|------|----------|
| `CONTINUE_SIGNAL` | Continue 신호 전송 | 초기 Stall |
| `STRONGER_PROMPT` | 강화된 프롬프트 전송 | Continue 무응답 |
| `RETRY_TASK` | Task 재시도 | 일시적 오류 |
| `RESTART_LANE` | Lane 재시작 | 반복 실패 |
| `KILL_AND_RESTART` | 프로세스 강제 종료 후 재시작 | 좀비 프로세스 |
| `WAIT_AND_RETRY` | 대기 후 재시도 | Rate Limit |
| `SEND_GIT_GUIDANCE` | Git 해결 가이드 전송 | Git 충돌 |
| `RUN_DOCTOR` | 진단 실행 | 원인 불명 |
| `ABORT_LANE` | Lane 중단 | 복구 불가 |

### 10.3 다단계 Stall 복구 흐름

```
Phase 0 (정상) ──[2분 idle]──▶ Phase 1 (CONTINUE_SIGNAL)
                                    │
                              [2분 대기]
                                    │
                                    ▼
                              Phase 2 (STRONGER_PROMPT)
                                    │
                              [2분 대기]
                                    │
                                    ▼
                              Phase 3 (KILL_AND_RESTART)
                                    │
                           [max_restarts 초과?]
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
              재시작 시도                      RUN_DOCTOR
```

---

## 11. 데이터 흐름

### 11.1 실행 시작 → 완료

```
1. CLI: cursorflow run
         │
2. Orchestrator: Lane 생성 → Worktree 격리 → Runner 프로세스 spawn
         │
3. Runner/Pipeline: Task 순회 실행
         │
4. GitLifecycleManager: Task 브랜치 생성 → 작업 → 커밋 → 머지
         │
5. LaneStateMachine: 상태 전이 기록 → 이벤트 발행
         │
6. Orchestrator: 모든 Lane 완료 → 최종 머지 → 정리
```

### 11.2 실패 감지 → 복구

```
1. StallDetectionService: 주기적 상태 체크
         │
2. LaneStateMachine: RUNNING → RECOVERING 상태 전이
         │
3. FailurePolicy: 실패 유형 분석 → RecoveryAction 결정
         │
4. AutoRecovery: 복구 액션 실행
         │
5. EventRegistry: 'recovery.*' 이벤트 발행
         │
6. LaneStateMachine: RECOVERING → RUNNING | FAILED 상태 전이
```

---

## 12. 사용 예제

### 12.1 GitLifecycleManager 사용

```typescript
import { getGitLifecycleManager } from './core/git-lifecycle-manager';

const gitManager = getGitLifecycleManager();

// 1. Lane 초기화
gitManager.initializeLane('lane-1', 'cursorflow/pipeline/lane-1', '/path/to/worktree');

// 2. 작업 시작
await gitManager.startWork({
  worktreeDir: '/path/to/worktree',
  branchName: 'cursorflow/task-1',
  baseBranch: 'cursorflow/pipeline/lane-1',
  repoRoot: '/path/to/repo',
  laneName: 'lane-1',
  taskName: 'implement-feature'
});

// 3. 작업 종료 (모든 변경사항 커밋 및 푸시)
await gitManager.finalizeWork({
  worktreeDir: '/path/to/worktree',
  branchName: 'cursorflow/task-1',
  commitMessage: 'feat: implement feature',
  laneName: 'lane-1',
  taskName: 'implement-feature'
});

// 4. Pipeline으로 머지
await gitManager.mergeToTarget({
  worktreeDir: '/path/to/worktree',
  sourceBranch: 'cursorflow/task-1',
  targetBranch: 'cursorflow/pipeline/lane-1',
  laneName: 'lane-1',
  mergeType: 'task_to_pipeline'
});
```

### 12.2 LaneStateMachine 사용

```typescript
import { getStateMachine, LanePrimaryState, StateTransitionTrigger } from './core/lane-state-machine';

const sm = getStateMachine();

// 1. Lane 등록
sm.registerLane('lane-1', 'run-123', {
  totalTasks: 5,
  pipelineBranch: 'cursorflow/pipeline/lane-1'
});

// 2. 상태 전이
sm.transition('lane-1', StateTransitionTrigger.START);
sm.transition('lane-1', StateTransitionTrigger.INITIALIZED);

// 3. Task 진행 업데이트
sm.updateTaskProgress('lane-1', 0, 'implement-feature', 'cursorflow/task-1');

// 4. 상태 조회
const ctx = sm.getContext('lane-1');
console.log(`State: ${ctx.primaryState}, Task: ${ctx.currentTaskIndex}/${ctx.totalTasks}`);

// 5. 상태 영속화
sm.persistState('lane-1', '/path/to/lane/dir');
```

### 12.3 EventRegistry 사용

```typescript
import { getEventRegistry, EventCategory, LaneEventType, GitEventType } from './utils/event-registry';

const registry = getEventRegistry();

// 1. Run ID 설정
registry.setRunId('run-123');

// 2. 이벤트 구독
registry.on(LaneEventType.COMPLETED, (event) => {
  console.log(`Lane ${event.payload.laneName} completed with exit code ${event.payload.exitCode}`);
});

// 3. 카테고리별 구독
registry.onCategory(EventCategory.GIT, (event) => {
  console.log(`Git event: ${event.type}`);
});

// 4. 이벤트 발행
registry.emit(LaneEventType.STARTED, {
  laneName: 'lane-1',
  pid: 12345,
  logPath: '/path/to/log',
  worktreeDir: '/path/to/worktree',
  pipelineBranch: 'cursorflow/pipeline/lane-1'
});

// 5. 히스토리 조회
const gitEvents = registry.getCategoryHistory(EventCategory.GIT, 10);
console.log(`Last 10 Git events:`, gitEvents);
```

---

## 13. 관련 문서

- [CURSOR_AGENT_GUIDE.md](./CURSOR_AGENT_GUIDE.md) - cursor-agent CLI 사용법
- [TEST_ARCHITECTURE.md](./TEST_ARCHITECTURE.md) - 테스트 아키텍처
- [HOOKS_GUIDE.md](./HOOKS_GUIDE.md) - Hook 시스템 사용법

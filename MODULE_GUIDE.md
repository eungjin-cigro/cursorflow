# CursorFlow 핵심 모듈 및 파일 가이드

이 문서는 CursorFlow의 주요 모듈과 파일들의 역할, 그리고 이들이 전체 시스템에서 어떻게 상호작용하는지를 설명합니다.

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

### 2.2 감독/조정 레이어 (신규)

| 파일 | 역할 | 책임 |
|------|------|------|
| **`agent-supervisor.ts`** | **에이전트 감독자** | AI 에이전트 프롬프트 전송, 실패 분석, 이벤트 발행 |
| **`git-pipeline-coordinator.ts`** | **Git 파이프라인 조정자** | Worktree 생성/검증, 의존성 브랜치 머지, 충돌 처리 |

### 2.3 Runner 레이어 (`src/core/runner`)

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
| `retry.ts` | 재시도/Circuit Breaker | 실패 시 지수 백오프 재시도 |
| `config.ts` | 설정 로드 | `.cursorflow.json` 파싱 |
| `path.ts` | 안전한 경로 조합 | Path traversal 방지 |
| `checkpoint.ts` | 체크포인트 관리 | 복구 지점 생성/복원 |
| `logger.ts` | 범용 로거 | 콘솔/파일 출력, 컨텍스트 태깅 |

---

## 5. Types (`src/types`)

프로젝트 전반에서 사용되는 TypeScript 인터페이스 및 타입 정의입니다.

주요 타입:
- `LaneConfig`, `LaneState` - Lane 설정/상태
- `Task`, `TaskExecutionResult` - Task 정의/실행 결과
- `RunState`, `RunnerConfig` - 실행 설정/상태
- `FailureType`, `RecoveryAction` - 실패 유형/복구 액션

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
│  │Detect  │ │ Recovery   │ │   Policy     │ │ Supervisor │ │ Coordinator│ │
│  └────────┘ └────────────┘ └──────────────┘ └─────┬──────┘ └─────┬──────┘ │
│                                                    │              │         │
│  ┌─────────────────────────────────────────────────┴──────────────┴───────┐ │
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
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. 실패 처리 아키텍처

### 7.1 실패 유형 (FailureType)

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

### 7.2 복구 액션 (RecoveryAction)

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

### 7.3 다단계 Stall 복구 흐름

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

## 8. 데이터 흐름

### 8.1 실행 시작 → 완료

```
1. CLI: cursorflow run
         │
2. Orchestrator: Lane 생성 → Worktree 격리 → Runner 프로세스 spawn
         │
3. Runner/Pipeline: Task 순회 실행
         │
4. Runner/Task: 프롬프트 → AgentSupervisor → cursor-agent
         │
5. GitPipelineCoordinator: Task 브랜치 → Pipeline 브랜치 머지
         │
6. Orchestrator: 모든 Lane 완료 → 최종 머지 → 정리
```

### 8.2 실패 감지 → 복구

```
1. StallDetectionService: 주기적 상태 체크
         │
2. FailurePolicy: 실패 유형 분석 → RecoveryAction 결정
         │
3. AutoRecovery: 복구 액션 실행
         │
4. Events: 'lane.recovered' / 'lane.failed' 발행
```

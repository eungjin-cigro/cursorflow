# CursorFlow 테스트 아키텍처

---

## 1. 테스트 피라미드

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TEST PYRAMID                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                              ┌───────────┐                                  │
│                              │   Smoke   │  ← 배포 전 Gate (~2분)           │
│                              └─────┬─────┘                                  │
│                      ┌─────────────┴─────────────┐                          │
│                      │       Real E2E Tests      │  ← 로컬 전용 (~3-5분)    │
│                      └─────────────┬─────────────┘                          │
│                         ┌──────────┴──────────┐                             │
│                         │    Integration      │  ← Mock Agent (~60초)       │
│                         └──────────┬──────────┘                             │
│              ┌─────────────────────┴─────────────────────┐                  │
│              │              Unit Tests                    │  ← 모든 커밋 (~10초)│
│              └────────────────────────────────────────────┘                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

| 레이어 | 범위 | 실행 시점 |
|--------|------|----------|
| **Unit** | 개별 함수/클래스 | 모든 커밋 |
| **Integration** | Mock Agent + Real Git | PR / 주요 변경 |
| **Real E2E** | Real cursor-agent + Git | 로컬 수동 실행 |
| **Smoke** | 실제 CLI 검증 | 배포 전 |

---

## 2. 테스트 실행 명령어

```bash
# 빠른 피드백 (개발 중)
pnpm run test:unit

# Contract 테스트 (API 스키마 검증)
pnpm run test:contract

# 통합 테스트 (Mock Agent + Real Git)
pnpm run test:integration

# 스모크 테스트 (실제 CLI 검증)
pnpm run test:smoke

# 커밋 전 검증
pnpm run test:verify

# 전체 테스트 (CI)
pnpm run test:ci

# 실제 cursor-agent 테스트 (로컬 전용)
pnpm run test:e2e:real
```

---

## 3. 핵심 유즈케이스 ↔ 테스트 매핑

| 유즈케이스 | 테스트 파일 |
|-----------|------------|
| 병렬 Lane 실행 | `tests/e2e/orchestration.test.ts` |
| 의존성 해결 | `tests/e2e/orchestration.test.ts` |
| Stall 감지/복구 | `tests/integration/auto-recovery.test.ts` |
| 상태 저장/복구 | `tests/integration/lifecycle.test.ts` |
| CLI 진단 | `tests/smoke/smoke.test.ts` |
| Git 충돌 처리 | `tests/integration/git-conflict.test.ts` |
| Real Agent 통신 | `tests/e2e/real-e2e.test.ts` |

---

## 4. Real E2E 테스트

### 전제 조건

```bash
# 1. cursor-agent 설치 확인
which cursor-agent

# 2. 로그인 상태 확인
cursor-agent status
```

### 실행

```bash
npm run test:e2e:real
```

### Mock vs Real 비교

| 항목 | `test:e2e` (Mock) | `test:e2e:real` (Real) |
|------|-------------------|------------------------|
| cursor-agent | mock 사용 | 실제 CLI |
| API 호출 | 없음 | 실제 호출 (비용 발생) |
| 실행 시간 | ~60초 | ~3-5분 |
| CI/CD | ✓ 적합 | ✗ 로컬 전용 |

---

## 5. 테스트 디렉토리 구조

```
tests/
├── unit/           # 단위 테스트
├── integration/    # 통합 테스트 (Mock Agent)
├── e2e/            # E2E 테스트
│   ├── orchestration.test.ts    # Mock E2E
│   └── real-e2e.test.ts         # Real cursor-agent E2E
├── smoke/          # 스모크 테스트
├── contract/       # API 계약 테스트
└── fixtures/       # 테스트 픽스처
    └── mock-cursor-agent/       # Mock Agent
```

---

## 6. 모듈 × 테스트 타입 매트릭스

```
┌─────────────────┬─────────┬─────────────┬──────────┬─────────┐
│ Module          │  Unit   │ Integration │ Real E2E │  Smoke  │
├─────────────────┼─────────┼─────────────┼──────────┼─────────┤
│ orchestrator    │    ✓    │      ✓      │    -     │    ✓    │
│ lane-state-m.   │    ✓    │      ✓      │    -     │    -    │
│ auto-recovery   │    ✓    │      ✓      │    -     │    -    │
│ runner/agent    │    ✓    │      -      │    ✓     │    -    │
│ CLI (run/doctor)│    ✓    │      -      │    -     │    ✓    │
│ utils (git/state)│   ✓    │      ✓      │    -     │    -    │
│ cursor-agent    │    -    │      -      │    ✓     │    -    │
└─────────────────┴─────────┴─────────────┴──────────┴─────────┘
```

---

## 7. 관련 문서

- [MODULE_GUIDE.md](./MODULE_GUIDE.md) - 모듈 구조
- [CURSOR_AGENT_GUIDE.md](./CURSOR_AGENT_GUIDE.md) - cursor-agent 사용법
- [HOOKS_GUIDE.md](./HOOKS_GUIDE.md) - Hook 시스템 사용법

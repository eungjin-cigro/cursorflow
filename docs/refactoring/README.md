# CursorFlow 리팩토링 계획

## 개요

이 문서는 CursorFlow 코드베이스의 체계적인 리팩토링 계획을 담고 있습니다.

### 핵심 원칙
1. **간결함 (Simplicity)**: 파일당 300줄 이하, 명확한 책임
2. **책임 분리 (Separation of Concerns)**: 단일 책임 원칙 준수
3. **의존성 방향**: `cli → core → services → types`

### 현재 상태

| 디렉토리 | 파일 수 | 총 라인 | 문제점 |
|----------|---------|---------|--------|
| `cli/` | 15 | ~5,500 | 비즈니스 로직 혼입 |
| `core/` | 4 | ~2,400 | 다중 책임, 거대 파일 |
| `utils/` | 19 | ~6,500 | 로깅 유틸 분산, 중복 |
| `ui/` | 2 | ~900 | 컴포넌트화 부족 |

### Phase 목록

| Phase | 제목 | 예상 소요 | 위험도 | 영향도 |
|-------|------|----------|--------|--------|
| [Phase 1](./phase-1-types.md) | 타입 정리 | 1일 | 낮음 | 높음 |
| [Phase 2](./phase-2-logging.md) | 로깅 통합 | 2일 | 낮음 | 높음 |
| [Phase 3](./phase-3-git.md) | Git 서비스 분리 | 1일 | 낮음 | 중간 |
| [Phase 4](./phase-4-validation.md) | 검증 서비스 분리 | 1일 | 낮음 | 중간 |
| [Phase 5](./phase-5-runner.md) | Runner 리팩토링 | 2일 | 중간 | 높음 |
| [Phase 6](./phase-6-orchestrator.md) | Orchestrator 리팩토링 | 2일 | 중간 | 높음 |
| [Phase 7](./phase-7-cli.md) | CLI 정리 | 2일 | 낮음 | 중간 |
| [Phase 8](./phase-8-ui.md) | UI 컴포넌트화 | 1일 | 낮음 | 낮음 |

### 목표 아키텍처

```
src/
├── cli/                    # CLI 진입점 (파싱, 옵션)
│   ├── commands/           # 개별 커맨드
│   └── formatters/         # 출력 포맷
│
├── core/                   # 핵심 비즈니스 로직
│   ├── orchestrator/       # 오케스트레이션
│   ├── runner/             # 태스크 실행
│   ├── reviewer.ts         # 리뷰
│   └── failure-policy.ts   # 실패 정책
│
├── services/               # 재사용 서비스
│   ├── git/                # Git 연산
│   ├── logging/            # 통합 로깅
│   ├── state/              # 상태 관리
│   └── validation/         # 검증
│
├── ui/                     # 터미널 UI
│   ├── monitor/            # 모니터 UI
│   └── shared/             # 공유 컴포넌트
│
└── types/                  # 중앙 타입 정의
    ├── index.ts
    ├── config.ts
    ├── lane.ts
    ├── task.ts
    └── logging.ts
```

### 진행 상태

- [ ] Phase 1: 타입 정리
- [ ] Phase 2: 로깅 통합
- [ ] Phase 3: Git 서비스 분리
- [ ] Phase 4: 검증 서비스 분리
- [ ] Phase 5: Runner 리팩토링
- [ ] Phase 6: Orchestrator 리팩토링
- [ ] Phase 7: CLI 정리
- [ ] Phase 8: UI 컴포넌트화

### 실행 가이드

각 Phase 문서에는 다음 내용이 포함됩니다:
1. **목표**: 해당 Phase의 목적
2. **현재 상태**: 리팩토링 대상 파일 분석
3. **목표 구조**: 리팩토링 후 파일 구조
4. **상세 작업**: 구체적인 작업 목록
5. **마이그레이션 가이드**: 기존 코드 변경 방법
6. **테스트 계획**: 검증 방법
7. **롤백 계획**: 문제 시 복구 방법


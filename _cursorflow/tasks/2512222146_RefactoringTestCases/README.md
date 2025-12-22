# Refactoring Test Cases

이 태스크는 `docs/refactoring/` 문서를 기반으로 리팩토링 코드의 테스트 케이스를 작성합니다.

## 🎯 목표

1. **Phase 1-8 문서에서 코드 추출** - 터미널 명령어로만 코드 추출
2. **추출된 코드 리뷰** - 완전성 및 정확성 검증
3. **테스트 케이스 작성** - 각 모듈별 단위/통합 테스트
4. **검증** - 테스트 실행 및 커버리지 확인

## 📂 레인 구성

| 레인 | 파일 | 대상 Phase | 의존성 |
|------|------|-----------|--------|
| 1 | `01-types-tests.json` | Phase 1: Types | 없음 |
| 2 | `02-logging-tests.json` | Phase 2: Logging | Lane 1 |
| 3 | `03-git-validation-tests.json` | Phase 3-4: Git, Validation | Lane 1 |
| 4 | `04-core-tests.json` | Phase 5-6: Runner, Orchestrator | Lane 2, 3 |
| 5 | `05-cli-ui-tests.json` | Phase 7-8: CLI, UI | Lane 4 |

## 🔄 작업 흐름

각 레인은 다음 패턴을 따릅니다:

```
1. extract-*-code    → 문서에서 코드 추출 (sed/awk 사용)
2. review-*-code     → 추출된 코드 리뷰
3. write-*-tests     → 테스트 케이스 작성
4. verify-*-tests    → 테스트 실행 및 검증
```

## ⚠️ 중요 원칙

### 코드 추출 시:
- **수동 코드 작성 금지** - 터미널 명령어로만 추출
- 사용 도구: `sed`, `awk`, `grep`, `cat`
- 추출 실패 시 리포트 후 수동 검토 요청

### 예시 추출 패턴:
```bash
# 특정 섹션 찾기
grep -n '// src/types/config.ts' docs/refactoring/phase-1-types.md

# 코드 블록 추출
awk '/\/\/ src\/types\/config.ts/,/^```$/' docs/refactoring/phase-1-types.md | sed '1d;$d'
```

## 📊 예상 결과

| 레인 | 예상 테스트 수 | 예상 커버리지 |
|------|---------------|--------------|
| Types | 10+ | 80%+ |
| Logging | 15+ | 60%+ |
| Git/Validation | 27+ | 50%+ |
| Core | 30+ | 50%+ |
| CLI/UI | 27+ | 50%+ |
| **총계** | **109+** | **58%+** |

## 🚀 실행 방법

```bash
# 전체 실행
cursorflow run _cursorflow/tasks/2512222146_RefactoringTestCases/

# 특정 레인만 실행
cursorflow run _cursorflow/tasks/2512222146_RefactoringTestCases/ --lane 1

# 모니터링
cursorflow monitor
```

## 📁 참조 문서

- `docs/refactoring/README.md` - 전체 개요
- `docs/refactoring/phase-1-types.md` - Types 정리
- `docs/refactoring/phase-2-logging.md` - Logging 통합
- `docs/refactoring/phase-3-git.md` - Git 서비스 분리
- `docs/refactoring/phase-4-validation.md` - 검증 서비스 분리
- `docs/refactoring/phase-5-runner.md` - Runner 리팩토링
- `docs/refactoring/phase-6-orchestrator.md` - Orchestrator 리팩토링
- `docs/refactoring/phase-7-cli.md` - CLI 정리
- `docs/refactoring/phase-8-ui.md` - UI 컴포넌트화

## ✅ 완료 체크리스트

- [ ] Lane 1: Types 테스트 완료
- [ ] Lane 2: Logging 테스트 완료
- [ ] Lane 3: Git/Validation 테스트 완료
- [ ] Lane 4: Core 테스트 완료
- [ ] Lane 5: CLI/UI 테스트 완료
- [ ] 전체 테스트 통과
- [ ] 커버리지 목표 달성


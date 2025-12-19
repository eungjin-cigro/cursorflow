# CursorFlow Run

## Overview
준비된 태스크를 실행합니다. 단일 레인 또는 멀티 레인 오케스트레이션을 수행합니다.

## Steps

1. **태스크 디렉토리 확인**
   ```bash
   ls _cursorflow/tasks/
   ```

2. **멀티 레인 실행**
   ```bash
   cursorflow run _cursorflow/tasks/MyFeature/
   ```

3. **단일 레인 실행**
   ```bash
   cursorflow lane _cursorflow/tasks/MyFeature/01-task.json
   ```

4. **Dry run (실행 계획 확인)**
   ```bash
   cursorflow run _cursorflow/tasks/MyFeature/ --dry-run
   ```

5. **실행 모니터링**
   
   실행 중에는 다른 터미널에서 모니터링:
   ```bash
   cursorflow monitor --watch
   ```

## 옵션

| 옵션 | 설명 |
|------|------|
| `--dry-run` | 실제 실행 없이 계획만 확인 |
| `--executor <type>` | 실행 방식 (cursor-agent \| cloud) |
| `--no-review` | 코드 리뷰 비활성화 |
| `--config <path>` | 커스텀 설정 파일 경로 |

## 예제

### 기본 실행
```bash
cursorflow run _cursorflow/tasks/2512191700_MyFeature/
```

### Cloud 실행 (API 키 필요)
```bash
export CURSOR_API_KEY=your_key
cursorflow run _cursorflow/tasks/MyFeature/ --executor cloud
```

### 리뷰 없이 빠른 실행
```bash
cursorflow run _cursorflow/tasks/MyFeature/ --no-review
```

## 실행 프로세스

1. **초기화**
   - 설정 로드
   - cursor-agent CLI 확인
   - Git 저장소 확인

2. **레인 준비**
   - Worktree 생성
   - 브랜치 체크아웃
   - 환경 설정

3. **태스크 실행**
   - 순차적으로 태스크 수행
   - 각 태스크 완료 후 커밋
   - 리뷰 활성화 시 자동 리뷰

4. **완료**
   - 변경사항 푸시
   - PR 생성 (설정에 따라)
   - 로그 저장

## 로그 위치

실행 로그는 `_cursorflow/logs/runs/` 에 저장됩니다:

```
_cursorflow/logs/runs/<lane>-<timestamp>/
├── state.json              # 레인 상태
├── results.json            # 태스크 결과
├── conversation.jsonl      # 에이전트 대화
├── git-operations.jsonl    # Git 작업 로그
└── events.jsonl            # 이벤트 로그
```

## Checklist
- [ ] cursor-agent CLI가 설치되어 있는가?
- [ ] Git worktree가 사용 가능한가?
- [ ] 태스크 파일이 올바른가?
- [ ] 브랜치 이름이 충돌하지 않는가?
- [ ] 필요한 환경 변수가 설정되었는가? (Cloud 실행 시)

## 트러블슈팅

### 브랜치 충돌
```bash
# 기존 브랜치 정리
cursorflow clean branches --pattern "feature/my-*"
```

### Worktree 충돌
```bash
# 기존 worktree 정리
cursorflow clean worktrees --all
```

### 실행 실패
```bash
# 로그 확인
cursorflow monitor
# 또는
cat _cursorflow/logs/runs/latest/*/state.json
```

## Next Steps
1. `cursorflow monitor --watch`로 진행 상황 모니터링
2. 완료 후 PR 확인 및 리뷰
3. 실패 시 `cursorflow resume <lane>`로 재개

# CursorFlow Resume

## Overview
중단되거나 실패한 레인을 재개합니다. 상태를 복구하거나 처음부터 다시 시작할 수 있습니다.

## Steps

1. **레인 상태 확인**
   ```bash
   cursorflow monitor
   ```

2. **레인 재개**
   ```bash
   cursorflow resume <lane-name>
   ```

3. **브랜치 정리 후 재시작**
   ```bash
   cursorflow resume <lane-name> --clean
   ```

4. **처음부터 다시 시작**
   ```bash
   cursorflow resume <lane-name> --restart
   ```

## 옵션

| 옵션 | 설명 |
|------|------|
| `--run-dir <path>` | 특정 run 디렉토리 지정 |
| `--clean` | 브랜치 정리 후 재시작 |
| `--restart` | 처음부터 다시 시작 |
| `--force` | 확인 없이 진행 |

## 예제

### 기본 재개
```bash
# 최신 run에서 해당 레인 재개
cursorflow resume 01-dashboard
```

### 특정 run에서 재개
```bash
cursorflow resume --run-dir _cursorflow/logs/runs/my-run/ 01-dashboard
```

### 브랜치 충돌 해결 후 재개
```bash
# 기존 브랜치 정리 후 재시작
cursorflow resume 01-dashboard --clean
```

### 완전히 새로 시작
```bash
# 모든 상태 초기화 후 재시작
cursorflow resume 01-dashboard --restart
```

## 재개 프로세스

1. **상태 확인**
   - `state.json` 파일 로드
   - 마지막 태스크 위치 확인
   - Worktree 상태 확인

2. **환경 복구**
   - Worktree 접근 가능 여부 확인
   - 브랜치 체크아웃
   - 미커밋 변경사항 확인

3. **실행 재개**
   - 중단된 태스크부터 계속
   - 또는 새로 시작 (--restart)

4. **완료**
   - 남은 태스크 모두 수행
   - 변경사항 커밋 및 푸시

## 상태 파일 예시

```json
{
  "label": "01-dashboard",
  "status": "failed",
  "currentTaskIndex": 1,
  "totalTasks": 3,
  "worktreeDir": ".cursorflow/logs/worktrees/01-dashboard-abc123",
  "pipelineBranch": "feature/dashboard-abc123",
  "error": "Build failed",
  "startTime": 1734567890000,
  "endTime": null
}
```

## Checklist
- [ ] 레인이 실제로 중단되었는가?
- [ ] 상태 파일이 존재하는가?
- [ ] 브랜치 충돌은 없는가?
- [ ] Worktree가 존재하는가?
- [ ] 미커밋 변경사항이 있는가?

## 트러블슈팅

### 상태 파일이 없는 경우
```bash
# 최신 run 디렉토리 확인
ls -lt _cursorflow/logs/runs/

# 특정 run 지정
cursorflow resume --run-dir _cursorflow/logs/runs/latest/ 01-dashboard
```

### 브랜치 충돌
```bash
# 기존 브랜치 확인
git branch | grep dashboard

# 정리 후 재개
cursorflow resume 01-dashboard --clean
```

### Worktree 문제
```bash
# Worktree 목록 확인
git worktree list

# 문제 있는 worktree 제거
git worktree remove <path> --force

# 재개
cursorflow resume 01-dashboard --restart
```

### 의존성 블록
```bash
# 의존성이 해결되었는지 확인
cursorflow monitor

# 의존성 해결 후 재개
cursorflow resume 01-dashboard
```

## 재개 시나리오

### 시나리오 1: 네트워크 오류로 중단
```bash
# 단순 재개 (같은 위치부터 계속)
cursorflow resume 01-dashboard
```

### 시나리오 2: 빌드 에러로 실패
```bash
# 코드 수정 후
cd .cursorflow/logs/worktrees/01-dashboard-xxx/
# ... 코드 수정 ...
git add -A
git commit -m "fix: build error"

# 다음 태스크부터 계속
cursorflow resume 01-dashboard
```

### 시나리오 3: 브랜치 충돌
```bash
# 브랜치 정리 후 새로 시작
cursorflow resume 01-dashboard --clean
```

### 시나리오 4: 처음부터 다시
```bash
# 모든 상태 초기화
cursorflow resume 01-dashboard --restart
```

## Next Steps
1. 재개 후 `cursorflow monitor --watch`로 모니터링
2. 완료 시 PR 확인
3. 반복 실패 시 태스크 설정 검토

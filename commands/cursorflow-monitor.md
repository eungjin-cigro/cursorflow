# CursorFlow Monitor

## Overview
레인 실행 상태를 모니터링합니다. 실시간으로 진행 상황을 확인하고 로그를 조회할 수 있습니다.

## Steps

1. **실시간 모니터링**
   ```bash
   cursorflow monitor --watch
   ```

2. **특정 run 모니터링**
   ```bash
   cursorflow monitor _cursorflow/logs/runs/my-run/
   ```

3. **상태 확인**
   
   레인별 상태 정보:
   - pending: 대기 중
   - running: 실행 중
   - completed: 완료
   - failed: 실패
   - blocked_dependency: 의존성 대기

4. **로그 확인**
   
   각 레인의 로그 파일:
   - `state.json`: 현재 상태
   - `conversation.jsonl`: 에이전트 대화
   - `git-operations.jsonl`: Git 작업
   - `events.jsonl`: 이벤트 로그

## 옵션

| 옵션 | 설명 |
|------|------|
| `--watch` | 실시간 갱신 (2초 간격) |
| `--interval <sec>` | 갱신 간격 (초) |
| `--json` | JSON 형식으로 출력 |

## 예제

### 최신 run 모니터링
```bash
cursorflow monitor
```

### 실시간 모니터링 (5초 간격)
```bash
cursorflow monitor --watch --interval 5
```

### JSON 출력
```bash
cursorflow monitor --json | jq
```

## 출력 예시

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📡 Lane 상태 모니터링
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Run: 01-dashboard-2025-12-19T18-30-00

- 01-dashboard: running (2/3)
- 02-client: completed (3/3)
- 03-projects: blocked_dependency (1/2)
```

## 로그 조회

### 대화 기록
```bash
cat _cursorflow/logs/runs/01-dashboard-xxx/conversation.jsonl | jq
```

### Git 작업 로그
```bash
cat _cursorflow/logs/runs/01-dashboard-xxx/git-operations.jsonl | jq
```

### 이벤트 로그
```bash
cat _cursorflow/logs/runs/01-dashboard-xxx/events.jsonl | jq
```

## 상태 분석

### 레인별 진행률
```bash
# 모든 레인의 state.json 확인
for state in _cursorflow/logs/runs/*/lanes/*/state.json; do
  echo "$(dirname $state):"
  jq '.status, .currentTaskIndex, .totalTasks' $state
done
```

### 실패한 레인 찾기
```bash
# status가 failed인 레인
find _cursorflow/logs/runs -name "state.json" -exec sh -c \
  'jq -r "select(.status==\"failed\") | .label" {}' \;
```

## Checklist
- [ ] 레인 상태가 정상인가?
- [ ] 에러가 발생했는가?
- [ ] 로그를 확인했는가?
- [ ] Blocked lane이 있는가?
- [ ] 의존성 문제는 없는가?

## 트러블슈팅

### 레인이 멈춘 경우
1. `state.json`에서 상태 확인
2. `conversation.jsonl`에서 마지막 대화 확인
3. 필요시 `cursorflow resume <lane>`로 재개

### 로그가 없는 경우
1. 실행이 시작되었는지 확인
2. 로그 디렉토리 권한 확인
3. 설정 파일의 logsDir 경로 확인

## Next Steps
1. 문제 발견 시 `cursorflow resume`로 재개
2. 완료된 레인의 PR 확인
3. 로그 분석으로 개선점 파악

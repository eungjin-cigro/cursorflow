# cursorflow run

Flow 실행 및 재개를 위한 통합 가이드입니다.

## 실행 (`run`)

```bash
cursorflow run <flow-name> [options]
```

### 옵션

| 옵션 | 설명 |
|------|------|
| `--max-concurrent <num>` | 동시 실행 레인 수 제한 |
| `--dry-run` | 실행 계획만 표시 (실제 실행 안 함) |
| `--skip-doctor` | 환경 검사 건너뛰기 |
| `--no-git` | Git 작업 건너뛰기 |

### 예시

```bash
# 기본 실행
cursorflow run SearchFeature

# 동시 실행 레인 수 제한
cursorflow run SearchFeature --max-concurrent 2

# 실행 계획 미리보기
cursorflow run SearchFeature --dry-run
```

---

## 재개 (`resume`)

중단되거나 실패한 레인을 재개합니다.

```bash
cursorflow resume [lane-name] [options]
```

### 옵션

| 옵션 | 설명 |
|------|------|
| `--status` | 모든 레인 상태 확인 (재개 없음) |
| `--all` | 미완료된 모든 레인 재개 |
| `--restart` | 첫 번째 태스크부터 다시 시작 |
| `--run-dir <path>` | 특정 실행 디렉토리 지정 |
| `--max-concurrent <n>` | 동시 재개 레인 수 (기본: 3) |

### 예시

```bash
# 레인 상태 확인
cursorflow resume --status

# 모든 미완료 레인 재개
cursorflow resume --all

# 특정 레인만 재개
cursorflow resume 01-api

# 처음부터 다시 시작
cursorflow resume 01-api --restart
```

### 상태 확인 출력

```
📊 Lane Status (run-1703145600000)

  Lane                     Status      Progress    Needs Resume
  ------------------------------------------------------------
  01-api                   completed   3/3         
  02-web                   failed      1/3         ✓
   └─ Error: cursor-agent timed out...
  03-mobile                paused      2/3         ✓

  Total: 3 | Completed: 1 | Needs Resume: 2

  Tip: Run cursorflow resume --all to resume all incomplete lanes
```

---

## 모니터링 (`monitor`)

실행 중인 Flow를 실시간으로 모니터링합니다.

```bash
# 최근 실행 모니터링
cursorflow monitor latest

# 특정 실행 모니터링
cursorflow monitor run-xxxxx

# 모든 실행 목록 보기
cursorflow monitor --list
```

### 대시보드 단축키

| 키 | 기능 |
|---|------|
| `↑/↓` | 레인 간 이동 |
| `→/Enter` | 상세 보기 |
| `←/Esc` | 뒤로 가기 |
| `F` | 의존성 Flow 보기 |
| `T` | 터미널 스트리밍 |
| `I` | 에이전트에 메시지 전송 |
| `K` | 프로세스 종료 |
| `Q` | 종료 |

---

## 실행 흐름 예시

### 병렬 실행

```bash
cursorflow new FrontBack --lanes "frontend,backend"
cursorflow add FrontBack frontend --task "name=ui|prompt=UI 구현"
cursorflow add FrontBack backend --task "name=api|prompt=API 구현"
cursorflow run FrontBack
```

```
┌───────────┐
│ frontend  │  (ui)
└───────────┘
              ─── 병렬 실행
┌───────────┐
│  backend  │  (api)
└───────────┘
```

### 순차 실행 (의존성)

```bash
cursorflow new FullStack --lanes "backend,api,frontend"

cursorflow add FullStack backend --task "name=db|prompt=DB 설정"
cursorflow add FullStack api --task "name=impl|prompt=API 구현" --after "backend"
cursorflow add FullStack frontend --task "name=ui|prompt=UI 구현" --after "api"

cursorflow run FullStack
```

```
┌───────────┐     ┌───────────┐     ┌───────────┐
│  backend  │ ──▶ │    api    │ ──▶ │ frontend  │
│   (db)    │     │  (impl)   │     │   (ui)    │
└───────────┘     └───────────┘     └───────────┘
                        │                 │
                   backend           backend,api
                   브랜치 머지        브랜치 머지
```

---

## 로그 확인

```bash
# 최근 실행 로그 요약
cursorflow logs

# 특정 레인 로그
cursorflow logs --lane api

# 모든 레인 통합 로그
cursorflow logs --all

# 실시간 로그 팔로우
cursorflow logs --lane api --follow
```

---

## 문제 해결

### 레인이 멈춤

```bash
# 에이전트에 메시지 전송
cursorflow signal <lane-name> --message "continue"

# 또는 재개
cursorflow resume --all
```

### 의존성 오류

```bash
# 설정 검증
cursorflow doctor <flow-name>

# 순환 의존성 확인
# ❌ Circular dependency: 01-a:task1 → 02-b:task2 → 01-a:task1
```

### 브랜치 충돌

```bash
# 기존 브랜치 정리
cursorflow clean branches --dry-run
cursorflow clean branches
```

---

## 베스트 프랙티스

1. **실행 전 검증**: `cursorflow doctor <flow-name>` 먼저 실행
2. **작게 시작**: 단일 레인으로 테스트 후 확장
3. **`--dry-run` 활용**: 실행 계획 미리 확인
4. **모니터링**: `cursorflow monitor` 항상 켜두기
5. **의존성 계획**: 복잡한 워크플로우는 DAG 먼저 그리기

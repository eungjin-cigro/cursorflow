# cursorflow init

프로젝트에 CursorFlow를 초기화합니다.

## 사용법

```bash
cursorflow init [options]
```

## 옵션

| 옵션 | 설명 |
|------|------|
| `--example` | 예제 Flow를 생성하여 빠르게 시작 |
| `--config-only` | `cursorflow.config.js` 파일만 생성 |
| `--no-commands` | Cursor IDE 커맨드 설치 건너뛰기 |
| `--no-gitignore` | `.gitignore`에 `_cursorflow/` 추가 안 함 |
| `--force` | 기존 설정 덮어쓰기 |

## 생성되는 구조

```
your-project/
├── cursorflow.config.js          # 중앙 설정 파일
├── _cursorflow/
│   ├── flows/                    # Flow 정의 (new 커맨드로 생성)
│   ├── tasks/                    # Legacy 태스크 (deprecated)
│   └── logs/                     # 실행 로그
└── .cursor/
    └── commands/cursorflow/      # Cursor IDE 커맨드
```

## 빠른 시작

### Step 1: 초기화

```bash
cd your-project
cursorflow init
```

### Step 2: Flow 생성

```bash
# 백엔드와 프론트엔드 2개 레인으로 Flow 생성
cursorflow new MyFeature --lanes "backend,frontend"
```

### Step 3: Task 추가

```bash
# 백엔드 레인에 태스크 추가
cursorflow add MyFeature backend \
  --task "name=implement|prompt=API 엔드포인트 구현"

# 프론트엔드 레인에 태스크 추가 (백엔드 완료 후 시작)
cursorflow add MyFeature frontend \
  --task "name=ui|prompt=UI 컴포넌트 구현" \
  --after "backend"
```

### Step 4: 검증 및 실행

```bash
# 설정 검증
cursorflow doctor MyFeature

# 실행
cursorflow run MyFeature

# 모니터링
cursorflow monitor latest
```

## 워크플로우 다이어그램

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ 1. Create Flow  │ ──▶ │ 2. Add Tasks    │ ──▶ │ 3. Validate     │ ──▶ │ 4. Run          │
│ (new)           │     │ (add)           │     │ (doctor)        │     │ (run)           │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
```

## 설정 파일 (cursorflow.config.js)

```javascript
module.exports = {
  // 기본 브랜치 (worktree 생성 기준)
  baseBranch: 'main',
  
  // 동시 실행 레인 수
  maxConcurrentLanes: 3,
  
  // 기본 AI 모델 (task에서 model 생략 시 사용)
  defaultModel: 'sonnet-4.5',
  
  // 태스크 타임아웃 (ms)
  timeout: 600000,
  
  // AI 리뷰 활성화
  enableReview: true,
  reviewModel: 'sonnet-4.5-thinking',
  
  // Flow/Task 디렉토리
  flowsDir: '_cursorflow/flows',
  tasksDir: '_cursorflow/tasks',  // legacy
  logsDir: '_cursorflow/logs',
};
```

## 기본 모델 설정

```bash
# 기본 모델 확인
cursorflow config defaultModel

# 기본 모델 변경
cursorflow config defaultModel gemini-2.5-flash

# 사용 가능한 모델 목록
cursorflow models
```

## 관련 명령어

- [cursorflow new](cursorflow-new.md) - Flow와 Lane 생성
- [cursorflow add](cursorflow-add.md) - Lane에 Task 추가
- [cursorflow run](cursorflow-run.md) - Flow 실행
- [cursorflow monitor](cursorflow-monitor.md) - 실행 모니터링
- [cursorflow doctor](cursorflow-doctor.md) - 설정 검증

# CursorFlow

> Parallel AI agent orchestration system built on Git worktrees

[![npm version](https://img.shields.io/npm/v/@litmers/cursorflow-orchestrator.svg)](https://www.npmjs.com/package/@litmers/cursorflow-orchestrator)
[![CI](https://github.com/eungjin-cigro/cursorflow/actions/workflows/ci.yml/badge.svg)](https://github.com/eungjin-cigro/cursorflow/actions/workflows/ci.yml)
[![Security Scan](https://github.com/eungjin-cigro/cursorflow/actions/workflows/security.yml/badge.svg)](https://github.com/eungjin-cigro/cursorflow/actions/workflows/security.yml)
[![Publish to NPM](https://github.com/eungjin-cigro/cursorflow/actions/workflows/npm-publish.yml/badge.svg)](https://github.com/eungjin-cigro/cursorflow/actions/workflows/npm-publish.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

## 🚀 Key Features

- ⚡ **Parallel Execution**: Run multiple AI agents concurrently using isolated Git worktrees.
- 🔗 **Task Dependencies (DAG)**: Define complex workflows where tasks wait for and merge their dependencies automatically.
- 🌊 **Flow Architecture**: Intuitive `new` + `add` commands to define Flows, Lanes, and Tasks.
- 📊 **Interactive Dashboard**: A powerful terminal-based monitor to track all lanes, progress, and dependencies in real-time.
- 📺 **Live Terminal Streaming**: Watch the AI agent's output as it happens with scrollable history.
- 🙋 **Human Intervention**: Send direct messages to running agents to guide them or fix issues on the fly.
- 🔀 **Smart Merging**: Automatically merge completed feature branches into subsequent dependent lanes.
- 🔒 **Security-First**: Automated security scanning and dependency policy enforcement.

## 🛠️ Quick Start

### 1. Install

```bash
npm install -g @litmers/cursorflow-orchestrator
```

### 2. Create a Flow

```bash
cd your-project
cursorflow init

# Create a Flow with two Lanes: backend and frontend
cursorflow new ShopFeature --lanes "backend,frontend"
```

### 3. Add Tasks to Lanes

```bash
# Add tasks to backend lane (uses default model)
cursorflow add ShopFeature backend \
  --task "name=implement|prompt=상품 검색 API 구현"

# Add tasks to frontend lane (waits for backend)
cursorflow add ShopFeature frontend \
  --task "name=ui|prompt=검색 UI 구현" \
  --after "backend:implement"
```

### 4. Run

```bash
# Start orchestration
cursorflow run ShopFeature

# Monitor progress in real-time
cursorflow monitor latest
```

## 📋 Flow 커맨드 - 시나리오로 배우기

**시나리오**: "쇼핑몰" 프로젝트에서 백엔드 API와 프론트엔드를 동시에 개발

---

### Step 1: Flow와 Lane 생성 (`new`)

```bash
cursorflow new SearchFeature --lanes "api,web,mobile"
```

**결과:**
```
_cursorflow/flows/001_SearchFeature/
├── flow.meta.json       # Flow 메타데이터
├── api.json             # API 레인 (빈 상태)
├── web.json             # Web 레인 (빈 상태)
└── mobile.json          # Mobile 레인 (빈 상태)
```

---

### Step 2: 각 Lane에 Task 추가 (`add`)

```bash
# API 레인: 의존성 없음, 바로 시작
cursorflow add SearchFeature api \
  --task "name=plan|prompt=API 설계" \
  --task "name=implement|prompt=검색 API 구현" \
  --task "name=test|prompt=API 테스트 작성"

# Web 레인: API의 implement 완료 후 시작
cursorflow add SearchFeature web \
  --task "name=ui|prompt=검색 UI 구현" \
  --after "api:implement"

# Mobile 레인: API 테스트까지 모두 끝나야 시작
cursorflow add SearchFeature mobile \
  --task "name=app|prompt=모바일 검색 화면 구현" \
  --after "api:test"
```

---

### Step 3: 실행

```bash
cursorflow run SearchFeature
```

**실행 흐름:**
```
api:    [plan] → [implement] → [test]
                     │            │
web:                 └─→ [ui] ────┤
                                  │
mobile:                           └─→ [app]
```

---

### --task 형식

```
"name=<이름>|prompt=<프롬프트>"          # 기본 모델 사용
"name=<이름>|model=<모델>|prompt=<프롬프트>"  # 모델 지정
```

| 필드 | 필수 | 설명 |
|------|------|------|
| `name` | ✅ | 태스크 이름 (영문, 숫자, -, _) |
| `prompt` | ✅ | 태스크 프롬프트 |
| `model` | ❌ | AI 모델 (생략 시 기본 모델 사용) |

기본 모델 설정: `cursorflow config defaultModel <model-name>`

---

### --after 형식 (의존성)

```
--after "lane:task"           # 특정 태스크 완료 후 시작
--after "lane"                # 해당 레인의 마지막 태스크 완료 후
--after "a:t1, b:t2"          # 여러 태스크 모두 완료 후 (콤마 구분)
```

---

### 커맨드 요약

| 커맨드 | 설명 | 예시 |
|--------|------|------|
| `new` | Flow와 Lane 생성 | `cursorflow new Feature --lanes "api,web"` |
| `add` | Lane에 Task 추가 | `cursorflow add Feature api --task "..."` |
| `run` | Flow 실행 | `cursorflow run Feature` |

## 🎮 Dashboard Controls

Within the `cursorflow monitor` dashboard:
- `↑/↓`: Navigate between lanes or scroll through logs.
- `→ / Enter`: Enter detailed lane view.
- `← / Esc`: Go back.
- `F`: Toggle **Dependency Flow** view.
- `T`: Open **Live Terminal Streaming**.
- `I`: **Intervene** (send a message to the agent).
- `K`: **Kill** the current agent process.
- `Q`: Quit monitor.

## ⚙️ Configuration

### Task Configuration Schema

```json
{
  "branchPrefix": "feature/lane-1-",
  "timeout": 600000,
  "enableIntervention": true,
  "tasks": [
    {
      "name": "setup",
      "model": "sonnet-4.5",
      "prompt": "Set up the project structure..."
    },
    {
      "name": "implement",
      "model": "sonnet-4.5",
      "prompt": "Implement the user authentication...",
      "acceptanceCriteria": ["Code complete", "Tests pass"],
      "dependsOn": ["other-lane:setup"]
    }
  ]
}
```

### Key Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `timeout` | number | 600000 | Task timeout in milliseconds (10 min) |
| `enableIntervention` | boolean | true | Enable stdin piping for intervention |
| `model` | string | "sonnet-4.5" | AI model to use |

## 🔗 태스크 의존성 (dependsOn)

**언제 사용?** 프론트엔드가 백엔드 API 완성 후에 시작해야 할 때

### 사용법

JSON 파일에서 `dependsOn` 필드 추가:

```json
{
  "tasks": [
    { "name": "setup", "prompt": "초기 설정..." },
    { 
      "name": "integrate", 
      "prompt": "API 연동...",
      "dependsOn": ["backend:implement"]  // ← 이 태스크 완료 후 시작
    }
  ]
}
```

형식: `"레인파일명:태스크명"` (확장자 `.json` 제외)

### 실행 흐름 예시

```
1-backend: [setup] → [implement] → [test]
                          ↓ 완료!
2-frontend: [setup] ─────┴─ 대기 → [integrate] → [test]
```

- 백엔드와 프론트엔드 **동시 시작**
- 프론트의 `integrate`는 백엔드 `implement` 완료까지 대기
- 완료되면 백엔드 브랜치 **자동 머지** 후 시작

### 순환 의존성 검사

```bash
cursorflow doctor --tasks-dir _cursorflow/tasks/MyFeature
# ❌ Cyclic dependency: a:task1 → b:task2 → a:task1
```

## 🩺 Pre-flight Checks

Doctor validates your configuration before running:

```bash
cursorflow doctor --tasks-dir _cursorflow/tasks/my-feature

# Checks performed:
# ✓ Git repository and remote
# ✓ Branch prefix collisions
# ✓ Task structure validation
# ✓ Circular dependency detection (DAG)
# ✓ Existing branch conflicts
```

## 📚 Commands Reference

### Flow Commands (New)
| Command | Description |
|---------|-------------|
| `cursorflow new` | Create Flow with Lanes |
| `cursorflow add` | Add Tasks to Lane |
| `cursorflow config` | View/set configuration |
| `cursorflow tasks` | Browse flows and legacy tasks |

### Execution
| Command | Description |
|---------|-------------|
| `cursorflow run` | Run orchestration (DAG-based) |
| `cursorflow monitor` | Interactive lane dashboard |
| `cursorflow resume` | Resume lane(s) - use --all for batch resume |
| `cursorflow stop` | Stop running workflows |

### Inspection
| Command | Description |
|---------|-------------|
| `cursorflow doctor` | Check environment and preflight |
| `cursorflow logs` | View, export, and follow logs |
| `cursorflow models` | List available AI models |

### Utility
| Command | Description |
|---------|-------------|
| `cursorflow init` | Initialize CursorFlow in project |
| `cursorflow setup` | Install Cursor IDE commands |
| `cursorflow clean` | Clean branches/worktrees/logs/tasks |
| `cursorflow signal` | Directly intervene in a running lane |

### Legacy
| Command | Description |
|---------|-------------|
| `cursorflow prepare` | (deprecated) Use 'new' + 'add' instead |

## 📝 Enhanced Logging

CursorFlow provides comprehensive logging with automatic cleanup and export options.

### Log Format

Logs use the format `[{n}-{t}-{lanename}]`:
- `{n}`: Lane number (1-indexed)
- `{t}`: Task number (1-indexed)
- `{lanename}`: First 10 characters of lane name

Example: `[1-2-backend]` = Lane 1, Task 2, lane "backend"

### Features
- **ANSI Stripping**: Clean logs without terminal escape codes
- **Timestamps**: Automatic timestamps on each line (ISO, relative, or short format)
- **Log Rotation**: Automatic rotation when files exceed size limits
- **Multiple Formats**: 
  - `terminal.log` - Clean, readable logs
  - `terminal-raw.log` - Raw logs with ANSI codes
  - `terminal.jsonl` - Structured JSON for programmatic access

### Usage

```bash
# View logs summary for latest run
cursorflow logs

# View specific lane logs
cursorflow logs --lane api-setup

# View ALL lanes merged (unified timeline)
cursorflow logs --all

# Follow all lanes in real-time
cursorflow logs --all --follow

# Follow logs in real-time
cursorflow logs --lane api-setup --follow

# Export to different formats
cursorflow logs --lane api-setup --format json --output logs.json
cursorflow logs --all --format html --output all-logs.html

# Filter logs
cursorflow logs --all --filter "error|failed"
cursorflow logs --all --level stderr
cursorflow logs --lane api-setup --level error --tail 50
```

### Merged Logs View (`--all`)

When running multiple lanes, use `--all` to see a unified timeline:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🔀 Merged Logs - run-123 (45 entries from 3 lanes)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Lanes: ■ api-setup  ■ frontend  ■ database

[10:15:30] [api-setup   ] [STDOUT] Starting API setup...
[10:15:31] [frontend    ] [STDOUT] Setting up React...
[10:15:32] [database    ] [STDOUT] Creating schema...
[10:15:33] [api-setup   ] [STDOUT] Endpoints created
[10:15:34] [frontend    ] [STDERR] Warning: Deprecated API
...
```

### Configuration

Add to `cursorflow.config.js`:

```javascript
module.exports = {
  // ... other config ...
  enhancedLogging: {
    enabled: true,           // Enable enhanced logging
    stripAnsi: true,         // Strip ANSI codes for clean logs
    addTimestamps: true,     // Add timestamps to each line
    maxFileSize: 52428800,   // 50MB max before rotation
    maxFiles: 5,             // Keep 5 rotated files
    keepRawLogs: true,       // Keep raw logs separately
    writeJsonLog: true,      // Generate JSON logs
    timestampFormat: 'iso',  // 'iso' | 'relative' | 'short'
  },
};
```

## 📖 Documentation

- [📋 Prepare Command](commands/cursorflow-prepare.md) - Task generation with presets
- [🏃 Run Command](commands/cursorflow-run.md) - Execution options
- [🩺 Doctor Command](commands/cursorflow-doctor.md) - Validation details
- [📊 Monitor Command](commands/cursorflow-monitor.md) - Dashboard usage
- [🔗 Event Triggers & Webhooks](commands/cursorflow-triggers.md) - Event system and webhooks
- [📦 Examples](examples/) - Practical examples

## 🚀 Deployment & Updates

### For Maintainers
To release a new version to NPM:
1. Run the release script: `./scripts/release.sh [patch|minor|major]`
2. The script handles versioning, changelog, and triggers GitHub Actions.

### For Users
Update and refresh commands:
```bash
npm install -g @litmers/cursorflow-orchestrator
cursorflow-setup --force
```

## License

MIT © Eugene Jin

---

**Made with ❤️ for Cursor IDE users**

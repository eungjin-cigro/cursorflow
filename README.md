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
- 📋 **Preset Templates**: Built-in templates for common patterns (complex, simple, merge).
- 📊 **Interactive Dashboard**: A powerful terminal-based monitor to track all lanes, progress, and dependencies in real-time.
- 📺 **Live Terminal Streaming**: Watch the AI agent's output as it happens with scrollable history.
- 🙋 **Human Intervention**: Send direct messages to running agents to guide them or fix issues on the fly.
- 🔍 **Automatic Review**: AI-powered code review with iterative feedback loops.
- 🔀 **Smart Merging**: Automatically merge completed feature branches into subsequent dependent lanes.
- 🔒 **Security-First**: Automated security scanning and dependency policy enforcement.

## 🛠️ Quick Start

### 1. Install

```bash
npm install -g @litmers/cursorflow-orchestrator
```

### 2. Initialize & Prepare Tasks

```bash
cd your-project
cursorflow init

# Simple task (single implement task)
cursorflow prepare FixBug --prompt "Fix the login validation bug in auth.ts"

# Complex feature (plan → implement → test)
cursorflow prepare AuthSystem --preset complex --prompt "Build user authentication with JWT"

# Multiple parallel lanes
cursorflow prepare FullStack --lanes 3 --sequential --preset complex \
  --prompt "Build your layer of the full-stack feature"
```

### 3. Validate & Run

```bash
# Check for issues before running
cursorflow doctor --tasks-dir _cursorflow/tasks/2412211530_AuthSystem

# Start orchestration
cursorflow run _cursorflow/tasks/2412211530_AuthSystem

# Open the interactive dashboard
cursorflow monitor latest
```

## 📋 Preset Templates

CursorFlow provides built-in task templates:

| Preset | Tasks | Use Case |
|--------|-------|----------|
| `--preset complex` | plan → implement → test | Complex features (saves plan to `_cursorflow/PLAN_lane-{N}.md`) |
| `--preset simple` | implement → test | Simple changes, bug fixes |
| `--preset merge` | merge → test | Integration lanes (auto-applied with `--depends-on`) |
| *(none)* | implement | Quick single task |

### Using External Templates

You can use templates from a local file, a remote URL, or a built-in name:

```bash
# Using a built-in template name
cursorflow prepare Feature --template basic

# Using a local template file
cursorflow prepare Custom --template ./my-template.json

# Using a remote template URL
cursorflow prepare Remote --template https://raw.githubusercontent.com/user/repo/main/template.json
```

Templates support `{{featureName}}`, `{{laneNumber}}`, and `{{devPort}}` placeholders.

```bash
# Complex: Creates plan document that subsequent tasks reference
cursorflow prepare Feature --preset complex --prompt "Build user dashboard"

# Simple: Just implement and test
cursorflow prepare BugFix --preset simple --prompt "Fix null pointer in auth.ts"

# Single task: Just the prompt
cursorflow prepare QuickFix --prompt "Update README.md"
```

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
  "baseBranch": "main",
  "branchPrefix": "feature/lane-1-",
  "timeout": 600000,
  "enableIntervention": false,
  "dependsOn": ["01-lane-1"],
  "enableReview": true,
  "reviewModel": "sonnet-4.5-thinking",
  "tasks": [
    {
      "name": "implement",
      "model": "sonnet-4.5",
      "prompt": "Implement the user authentication...",
      "acceptanceCriteria": ["Code complete", "Tests pass"]
    }
  ]
}
```

### Key Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `timeout` | number | 600000 | Task timeout in milliseconds (10 min) |
| `enableIntervention` | boolean | false | Enable stdin piping for intervention |
| `model` | string | "sonnet-4.5" | AI model to use |
| `dependsOn` | string[] | [] | Lane dependencies |
| `enableReview` | boolean | true | Enable AI code review |

## 🔗 Task Dependencies

Define dependencies between lanes. Dependent lanes wait for parents and auto-merge:

```bash
# Create 3 sequential lanes (1 → 2 → 3)
cursorflow prepare Pipeline --lanes 3 --sequential --preset complex

# Add a merge lane that depends on multiple lanes
cursorflow prepare --add-lane _cursorflow/tasks/2412211530_Pipeline \
  --depends-on "01-lane-1,02-lane-2"
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

| Command | Description |
|---------|-------------|
| `cursorflow init` | Initialize CursorFlow in project |
| `cursorflow setup` | Install Cursor IDE commands |
| `cursorflow prepare` | Prepare task directory and JSON files |
| `cursorflow run` | Run orchestration (DAG-based) |
| `cursorflow monitor` | Interactive lane dashboard |
| `cursorflow clean` | Clean branches/worktrees/logs/tasks |
| `cursorflow resume` | Resume lane(s) - use --all for batch resume |
| `cursorflow doctor` | Check environment and preflight |
| `cursorflow signal` | Directly intervene in a running lane |
| `cursorflow models` | List available AI models |
| `cursorflow logs` | View, export, and follow logs |

## 📝 Enhanced Logging

CursorFlow provides comprehensive logging with automatic cleanup and export options:

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

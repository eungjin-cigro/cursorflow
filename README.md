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
- 📊 **Interactive Dashboard**: A powerful terminal-based monitor to track all lanes, progress, and dependencies in real-time.
- 📺 **Live Terminal Streaming**: Watch the AI agent's output as it happens with scrollable history.
- 🙋 **Human Intervention**: Send direct messages to running agents to guide them or fix issues on the fly (requires `enableIntervention: true`).
- 🛡️ **PID Control**: Track and manage agent processes directly from the dashboard.
- 🔍 **Automatic Review**: AI-powered code review with iterative feedback loops.
- 🔀 **Smart Merging**: Automatically merge completed feature branches into subsequent dependent lanes.
- 🔒 **Security-First**: Automated security scanning and dependency policy enforcement.

## 🛠️ Quick Start

### 1. Install

```bash
# npm (recommended)
npm install -g @litmers/cursorflow-orchestrator
```

### 2. Initialize

```bash
cd your-project
cursorflow init --example
```

### 3. Run & Monitor

```bash
# Start orchestration
cursorflow run _cursorflow/tasks/example/

# Open the interactive dashboard (highly recommended!)
cursorflow monitor latest
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
  "branchPrefix": "cursorflow/feature-",
  "model": "sonnet-4.5",
  "timeout": 300000,
  "enableIntervention": false,
  "dependsOn": ["other-lane"],
  "dependencyPolicy": {
    "allowDependencyChange": false,
    "lockfileReadOnly": true
  },
  "tasks": [
    {
      "name": "implement-feature",
      "prompt": "Implement the user authentication..."
    }
  ]
}
```

### Key Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `timeout` | number | 300000 | Task timeout in milliseconds (5 min default) |
| `enableIntervention` | boolean | false | Enable stdin piping for intervention |
| `model` | string | "sonnet-4.5" | AI model to use |
| `dependsOn` | string[] | [] | Lane dependencies |

### Timeout Configuration

Set custom timeouts based on task complexity:

```json
{
  "timeout": 60000,
  "tasks": [{ "name": "simple-task", "prompt": "..." }]
}
```

- **Simple tasks**: `60000` (1 minute)
- **Medium tasks**: `300000` (5 minutes) - default
- **Complex tasks**: `600000` (10 minutes)

### Task Validation

CursorFlow automatically validates your task configuration before execution:

- ✅ Required `name` and `prompt` fields
- ✅ Valid task name format (letters, numbers, `-`, `_` only)
- ✅ Proper timeout values
- ✅ Helpful error messages with fix suggestions

### Progress Monitoring (Heartbeat)

During execution, CursorFlow logs progress every 30 seconds:

```
⏱ Heartbeat: 30s elapsed, 1234 bytes received
⏱ Heartbeat: 60s elapsed, 5678 bytes received
```

## 🔗 Task Dependencies

You can define dependencies between lanes in your task JSON files. Dependent lanes will wait for their parents to complete and then automatically merge the parent's work before starting.

```json
{
  "name": "api-implementation",
  "dependsOn": ["database-schema", "common-utils"],
  "tasks": [ ... ]
}
```

## 🧪 Advanced Testing

A complete test suite for dependency orchestration is included.

```bash
# Run a complex dependency test (6 interdependent lanes)
cursorflow run test-projects/advanced-orchestration/_cursorflow/tasks/full-stack/

# Monitor the flow
cursorflow monitor latest
```

## 📚 Documentation

- [📖 User Guide](docs/GUIDE.md) - Detailed usage instructions
- [📋 API Reference](docs/API.md) - CLI and config API
- [🎨 Command Guide](docs/COMMANDS.md) - Cursor command usage
- [🏗️ Architecture](docs/ARCHITECTURE.md) - System structure
- [🔧 Troubleshooting](docs/TROUBLESHOOTING.md) - Issue resolution
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

# CursorFlow

> Parallel AI agent orchestration system built on Git worktrees

[![npm version](https://img.shields.io/npm/v/@litmers/cursorflow-orchestrator.svg)](https://www.npmjs.com/package/@litmers/cursorflow-orchestrator)
[![CI](https://github.com/eungjin-cigro/cursorflow/actions/workflows/ci.yml/badge.svg)](https://github.com/eungjin-cigro/cursorflow/actions/workflows/ci.yml)
[![Security Scan](https://github.com/eungjin-cigro/cursorflow/actions/workflows/security.yml/badge.svg)](https://github.com/eungjin-cigro/cursorflow/actions/workflows/security.yml)
[![Publish to NPM](https://github.com/eungjin-cigro/cursorflow/actions/workflows/npm-publish.yml/badge.svg)](https://github.com/eungjin-cigro/cursorflow/actions/workflows/npm-publish.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

## Key Features

- 🚀 **Parallel execution**: Run multiple lanes concurrently with Git worktrees
- 🔍 **Automatic review**: AI-powered code review with iterative feedback
- 📝 **Detailed logging**: Capture conversations, commits, and Git operations
- 🔀 **Dependency management**: Automatic dependency gating and resume support
- 🎯 **Per-lane ports**: Unique dev server ports for each lane
- 💻 **Cursor integration**: Manage workflows directly inside the IDE with custom commands
- 🛠️ **Config-driven**: Flexible project-specific configuration
- 🔒 **Security-first**: Multi-layer automated security scanning before deployment

## Quick Start

### Install

```bash
# npm
npm install -g @litmers/cursorflow-orchestrator

# pnpm (recommended)
pnpm add -g @litmers/cursorflow-orchestrator

# yarn
yarn global add @litmers/cursorflow-orchestrator
```

### Requirements

- **Node.js** >= 18.0.0
- **Git** with worktree support
- **cursor-agent CLI**: `npm install -g @cursor/agent`

### Initialize a project

```bash
cd your-project
cursorflow init --example
```

This command:
1. Creates the `cursorflow.config.js` config file
2. Creates `_cursorflow/tasks/` and `_cursorflow/logs/` directories
3. Installs Cursor IDE commands
4. Generates example tasks when `--example` is provided

### Run the example

```bash
# Run example tasks
cursorflow run _cursorflow/tasks/example/

# Monitor from another terminal
cursorflow monitor --watch
```

## 🧪 Testing CursorFlow

A complete demo project is included for testing with real LLM execution.

### Quick Test

```bash
# From the CursorFlow repository root
./test-cursorflow.sh setup   # Verify prerequisites
./test-cursorflow.sh run     # Run demo with LLM
./test-cursorflow.sh watch   # Monitor in real-time
./test-cursorflow.sh clean   # Clean up after test
```

### What Gets Tested

- ✅ Task orchestration with 2 parallel lanes
- ✅ Git worktree creation and management
- ✅ Real LLM execution (Claude Sonnet 4.5 via cursor-agent)
- ✅ Branch creation and commits
- ✅ Real-time monitoring with status updates
- ✅ Complete log capture (conversation + terminal)

### Demo Tasks

1. **create-utils**: Creates `src/utils.js` with utility functions
2. **add-tests**: Creates `src/utils.test.js` with simple tests

Each task runs ~1-2 minutes, demonstrating the full CursorFlow workflow.

**See**: `test-projects/demo-project/README.md` for detailed documentation.

## 📚 Examples

Ready-to-use examples are included in the `examples/` directory.

### Demo Project

A complete example demonstrating CursorFlow's core features:

```bash
# Copy example tasks to your project
cd your-project
cursorflow init
cp -r /path/to/cursorflow/examples/demo-project/_cursorflow/tasks/demo-test _cursorflow/tasks/

# Run the demo
cursorflow run _cursorflow/tasks/demo-test/

# Monitor in real-time
cursorflow monitor --watch
```

**Includes:**
- 2 parallel tasks with real LLM execution
- Complete documentation and setup instructions
- Expected results and troubleshooting guide

**See**: `examples/demo-project/README.md` for detailed instructions.

**Browse more examples**: `examples/README.md`

## Cursor IDE Integration

CursorFlow ships custom commands that are available directly inside Cursor IDE.

### Install commands

```bash
# Installed automatically during init
cursorflow init

# Or install manually
npx cursorflow-setup
```

### Usage

Type `/` in Cursor chat and use:

- `/cursorflow-init` - initialize a project
- `/cursorflow-prepare` - prepare tasks
- `/cursorflow-run` - run orchestration
- `/cursorflow-monitor` - monitor runs
- `/cursorflow-clean` - clean resources
- `/cursorflow-resume` - resume a lane
- `/cursorflow-review` - configure or check reviews

## CLI Commands

### Init
```bash
cursorflow init [options]
  --example          Create example tasks
  --with-commands    Install Cursor commands (default: true)
  --config-only      Generate config file only
```

### Prepare tasks
```bash
cursorflow prepare <feature> [options]
  --lanes <number>   Number of lanes
  --template <path>  Template file path
```

### Run
```bash
cursorflow run <tasks-dir> [options]
  --dry-run          Show the execution plan only
  --executor <type>  cursor-agent | cloud
```

### Monitor
```bash
cursorflow monitor [run-dir] [options]
  --watch            Live monitoring
  --interval <sec>   Refresh interval
```

### Clean
```bash
cursorflow clean <type> [options]
  branches          Clean branches
  worktrees         Clean worktrees
  logs              Clean logs
  all               Clean everything
```

### Resume
```bash
cursorflow resume <lane> [options]
  --clean            Clean branches before restart
  --restart          Restart from the beginning
```

## Configuration

### Config file (cursorflow.config.js)

```javascript
module.exports = {
  // Directories
  tasksDir: '_cursorflow/tasks',
  logsDir: '_cursorflow/logs',

  // Git settings
  baseBranch: 'main',
  branchPrefix: 'feature/',

  // Run settings
  executor: 'cursor-agent', // 'cursor-agent' | 'cloud'
  pollInterval: 60,

  // Dependency management
  allowDependencyChange: false,
  lockfileReadOnly: true,

  // Review settings
  enableReview: true,
  reviewModel: 'sonnet-4.5-thinking',
  maxReviewIterations: 3,

  // Default lane settings
  defaultLaneConfig: {
    devPort: 3001,
    autoCreatePr: false,
  },

  // Logging
  logLevel: 'info',
  verboseGit: false,
};
```

### Task file (JSON)

```json
{
  "repository": "https://github.com/your-org/your-repo",
  "baseBranch": "main",
  "branchPrefix": "feature/my-",
  "executor": "cursor-agent",
  "laneNumber": 1,
  "devPort": 3001,
  "enableReview": true,
  "tasks": [
    {
      "name": "implement",
      "model": "sonnet-4.5",
      "acceptanceCriteria": [
        "No build errors",
        "Key features implemented"
      ],
      "prompt": "Implementation instructions..."
    }
  ]
}
```

## Usage Examples

### Single feature development

```bash
# 1. Prepare tasks
cursorflow prepare AddUserAuth --lanes 1

# 2. Edit the task JSON
# _cursorflow/tasks/2512191830_AddUserAuth/01-task.json

# 3. Run
cursorflow run _cursorflow/tasks/2512191830_AddUserAuth/

# 4. Monitor
cursorflow monitor --watch
```

### Multi-domain parallel development

```bash
# 1. Prepare tasks (5 lanes)
cursorflow prepare AdminDashboard --lanes 5

# 2. Configure each lane
# 01-dashboard.json, 02-clients.json, ...

# 3. Run in parallel
cursorflow run _cursorflow/tasks/2512191830_AdminDashboard/

# 4. Live monitor
cursorflow monitor --watch --interval 5
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CursorFlow CLI                       │
└──────────────────┬──────────────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
   ┌────▼────┐          ┌────▼────┐
   │ Config  │          │  Core   │
   │ System  │          │ Engine  │
   └────┬────┘          └────┬────┘
        │                    │
        │         ┌──────────┼──────────┐
        │         │          │          │
   ┌────▼────┐ ┌─▼──┐  ┌────▼────┐  ┌─▼─────┐
   │   Git   │ │Run │  │ Monitor │  │Review │
   │ Utils   │ │ner │  │         │  │       │
   └─────────┘ └─┬──┘  └─────────┘  └───────┘
                 │
        ┌────────┼────────┐
        │        │        │
   ┌────▼───┐ ┌─▼──────┐ │
   │Worktree│ │ Cursor │ │
   │        │ │ Agent  │ │
   └────────┘ └────────┘ │
                          │
                     ┌────▼────┐
                     │  Logs   │
                     │  State  │
                     └─────────┘
```

## Documentation

- [📖 User Guide](docs/GUIDE.md) - Detailed usage instructions
- [📋 API Reference](docs/API.md) - CLI and config API
- [🎨 Command Guide](docs/COMMANDS.md) - Cursor command usage
- [🏗️ Architecture](docs/ARCHITECTURE.md) - System structure
- [🔧 Troubleshooting](docs/TROUBLESHOOTING.md) - Issue resolution
- [📦 Examples](examples/) - Practical examples

## Roadmap

- [ ] v1.0: Core features and base docs
- [ ] v1.1: Enhanced review system
- [ ] v1.2: Improved cloud execution
- [ ] v1.3: Plugin system
- [ ] v2.0: GUI tool

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md).

### Set up dev environment
```bash
git clone https://github.com/eungjin-cigro/cursorflow.git
cd cursorflow
pnpm install
pnpm test
```

## License

MIT © Eugene Jin

## Support

- 🐛 [Issue Tracker](https://github.com/eungjin-cigro/cursorflow/issues)
- 💬 [Discussions](https://github.com/eungjin-cigro/cursorflow/discussions)
- 📧 Email: eungjin.cigro@gmail.com

---

**Made with ❤️ for Cursor IDE users**

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.14] - 2025-12-21

### Added
- **Enhanced Logging System**: Comprehensive terminal output capture and management
  - ANSI escape sequence stripping for clean, readable logs
  - Automatic timestamps on each log line (ISO, relative, or short format)
  - Log rotation with configurable max size and file retention
  - Separate raw logs (with ANSI codes) and clean logs
  - Structured JSON logs (`terminal.jsonl`) for programmatic access
  - **Streaming JSON output** from cursor-agent (`--output-format stream-json`)
  - Streaming message parser for real-time log processing
  - Session headers with context (lane name, task, model, timestamps)
- **Log Viewer CLI**: New `cursorflow logs` command
  - View logs for specific lanes with `--lane <name>`
  - **View all lanes merged**: `--all` or `-a` for unified timeline view
  - Follow logs in real-time with `--follow` or `-f` (works with `--all`)
  - Export to multiple formats: text, json, markdown, html
  - Filter by regex pattern with `--filter`
  - Filter by log level with `--level`
  - Tail last N lines with `--tail`
  - Color-coded lanes in merged view for easy identification
- **Logging Configuration**: New `enhancedLogging` section in `cursorflow.config.js`
  - `enabled`: Toggle enhanced logging (default: true)
  - `stripAnsi`: Remove ANSI codes from clean logs (default: true)
  - `addTimestamps`: Prepend timestamps to lines (default: true)
  - `maxFileSize`: Rotation threshold in bytes (default: 50MB)
  - `maxFiles`: Number of rotated files to keep (default: 5)
  - `keepRawLogs`: Store raw logs separately (default: true)
  - `writeJsonLog`: Generate structured JSON logs (default: true)
  - `timestampFormat`: 'iso' | 'relative' | 'short' (default: 'iso')
- **Full Lifecycle Integration Test**: Added `scripts/test-real-cursor-lifecycle.sh` (and `npm run test:lifecycle`) to verify end-to-end orchestration, result verification, and resource cleanup.
- **Enhanced Log Customization**: Added `agentOutputFormat` to `cursorflow.config.js` to control `cursor-agent` output format (defaults to `stream-json`).
- **Readable Logs by Default**: `cursorflow logs` now defaults to showing parsed, human-readable AI outputs for better visibility.
- **Event System**: New `events.ts` module for structured event handling
- **Webhook Support**: New `webhook.ts` for external integrations

## [0.1.13] - 2025-12-21

### Fixed
- **Orchestration**: Fixed a bug where blocked lanes (exit code 2) were treated as completed, causing dependent lanes to start prematurely.
- **Security**: Fixed command injection vulnerability in `checkDiskSpace` by using `spawnSync` instead of `execSync`.
- **Workflow**: Updated security scanner to latest Semgrep Action.

## [0.1.12] - 2025-12-21

### Added
- **Preset Templates**: Three built-in task templates for common patterns:
  - `--preset complex`: plan → implement → test (saves plan to `_cursorflow/PLAN_lane-{N}.md`)
  - `--preset simple`: implement → test
  - `--preset merge`: merge → test (auto-applied for dependent lanes)
- **Plan Document Integration**: Complex preset saves implementation plans to dedicated files, which are referenced by subsequent tasks
- **Single Task Mode**: Create simple tasks with just `--prompt` without specifying a preset
- **Branch Validation in Doctor**: 
  - Detects branch prefix collisions between lanes
  - Warns about existing branches that may conflict
  - Suggests consistent naming conventions
- **Pre-resume Validation**: `cursorflow resume` now runs doctor checks before resuming (use `--skip-doctor` to bypass)
- **Models Command**: `cursorflow models` to list available AI models
- **Incremental Lane/Task Addition**: 
  - `--add-lane` to add new lanes to existing task directories
  - `--add-task` to append tasks to existing lane files

### Changed
- All documentation updated to English
- Improved task generation with better prompts and acceptance criteria
- Enhanced error messages for branch and dependency issues

## [0.1.9] - 2025-12-21

### Added
- **Configurable Timeout**: Support for `timeout` field in task JSON to handle complex tasks.
- **Improved Stdio Handling**: Optimized child process spawning with `ignore` stdin by default to prevent buffering issues.
- **Task Validation**: Robust pre-flight validation of task JSON configurations with helpful error messages.
- **Heartbeat Monitoring**: Real-time progress logging (elapsed time and bytes received) for long-running tasks.
- **Diagnostic Tools**: Added `scripts/patches/test-cursor-agent.js` for direct agent testing and `_cursorflow/tasks/minimal-test/` for isolation.
- **Enhanced Documentation**: New `docs/API.md` and `docs/TROUBLESHOOTING.md` with detailed configuration guides.

### Fixed
- **Intervention Stability**: Redesigned intervention to be optional (`enableIntervention: true`) to ensure maximum stability for default runs.
- **Environment Safety**: Smarter `NODE_OPTIONS` handling that preserves user settings while removing problematic debugging flags.

## [0.1.8] - 2025-12-21

### Added
- **Interactive Dashboard**: Full-screen interactive terminal monitor with lane navigation.
- **Live Terminal Streaming**: Real-time streaming of `cursor-agent` output with scrollback support.
- **Human Intervention**: UI for sending manual prompts to running agents via `I` key.
- **PID Control**: Tracking of process IDs and force-kill (`K` key) functionality for stuck agents.
- **Improved Visualization**: Color-coded logs and "Next Action" status in monitor.

## [0.1.7] - 2025-12-21

### Added
- **Task Dependencies**: Implemented DAG (Directed Acyclic Graph) scheduler for complex workflows.
- **Automatic Branch Merging**: Dependent lanes now automatically merge their parents' branches before starting.
- **Deadlock Detection**: Prevention of circular task dependencies at startup.
- **Concurrency Control**: `maxConcurrentLanes` support in orchestrator.

## [0.1.6] - 2025-12-21

### Added
- `cursorflow doctor` command for environment validation and pre-flight checks
- `cursorflow signal` command for real-time lane intervention (Intercommander)
- Auto-installation of Cursor IDE commands on `cursorflow run`
- Full implementation of `cursorflow resume` to pick up from failed tasks
- `/cursorflow-doctor` and `/cursorflow-signal` IDE commands

### Fixed
- Improved robustness of Git and worktree management
- Better error messages for missing origin remotes and Cursor authentication
- Resolved issues with `runTasks` not being able to restart from specific indices

## [0.1.5] - 2025-12-20

### Added
- Repository-specific Cursor rules (`.cursorrules`)
- Improved ignore patterns for Git and worktrees

## [1.0.0] - TBD

### Added
- Git worktree-based orchestration
- Parallel lane execution
- AI code review integration
- Detailed logging (conversation, git operations, events)
- Dependency management
- Lane monitoring
- Branch and worktree management
- Cursor IDE integration
- Configuration-based setup
- CLI interface
- Comprehensive documentation

### Features
- **Parallel Execution**: Multiple lanes running simultaneously
- **Auto Review**: AI-based code review and feedback loop
- **Detailed Logging**: Full conversation and operation logs
- **Dependency Gate**: Automatic dependency change handling
- **Lane Ports**: Unique dev server port per lane
- **Cursor Integration**: Custom commands for IDE
- **Config System**: Flexible project-based configuration

### Documentation
- README with quick start guide
- Usage guide (GUIDE.md)
- API reference (API.md)
- Command guide (COMMANDS.md)
- Architecture documentation (ARCHITECTURE.md)
- Troubleshooting guide (TROUBLESHOOTING.md)
- Examples

### Dependencies
- Node.js >= 18.0.0
- Git with worktree support
- cursor-agent CLI

---

## Release Notes Template

### [X.Y.Z] - YYYY-MM-DD

#### Added
- New features

#### Changed
- Changes in existing functionality

#### Deprecated
- Soon-to-be removed features

#### Removed
- Removed features

#### Fixed
- Bug fixes

#### Security
- Security improvements

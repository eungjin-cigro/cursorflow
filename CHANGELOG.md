# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.6] - 2025-12-30

### Added
- **Flow Auto-Completion**: Automatic merging of all successful lane branches into a unified `feature/{flow}-integrated` branch.
- **Cleanup Automation**: Automatic deletion of temporary lane branches and worktrees after successful integration.
- **Manual Completion CLI**: New `cursorflow complete <flow>` command for manual flow integration and recovery.
- **Flow Meta Tracking**: Enhanced `flow.meta.json` with integration status, target branch, and error reporting.

### Changed
- **Event System**: Refactored `CursorFlowEvents` to better handle `runId` and completion events.
- **Interactive Dashboard**: Updated UI to reflect completion and integration states.
- **Architecture**: Added ADR-0006 and updated high-level workflow diagrams.

## [0.2.5] - 2025-12-28
- Internal release with logging and hook improvements.

## [0.2.4] - 2025-12-28
- Internal release with build fixes and monitor UI updates.

## [0.2.3] - 2025-12-28
- Chore: bump version to v0.2.3.


## [0.1.37] - 2025-12-26

### Fixed
- **Runner**: Updated `cursor-agent` CLI flags to `--output-format` and added `--print`, `--force`, `--approve-mcps` for compatibility with latest versions.

### Performance
- **Git**: Optimized `pre-push` hook by excluding heavy E2E tests from local validation.

## [0.1.36] - 2025-12-26

### Fixed
- **CLI**: Fixed indentation and validation logic in `tasks` command.
- **Tests**: Improved `stop.test.ts` stability by mocking `process.chdir`.
- **E2E**: Removed redundant `lane-a.json` from `test-tasks-e2e`.

### Changed
- **Release**: Improved release process with annotated tags.

## [0.1.35] - 2025-12-26

### Changed
- **Log Format**: Updated log format to `L{n}-T{t}-{lanename}` with single-digit numbers and 10-char max lane name for cleaner output.
- **Flow Support**: All commands now support flow names in addition to directory paths.
  - `run`, `resume`, `doctor` can now use flow names like `cursorflow run MyFlow`
  - `tasks` command now browses flows from `_cursorflow/flows/` directory

### Fixed
- **Build Errors**: Fixed missing `getLogsDir` import in `logs.ts` and `monitor.ts`.
- **Flow Recognition**: Fixed `flow.meta.json` being incorrectly treated as a lane file in orchestrator.
- **Doctor CLI**: Fixed positional argument parsing for flow names.

### Added
- `getFlowsDir()` function in config.ts for consistent flow directory resolution.
- `findFlowDir()` utility for resolving flow names to paths.

## [0.1.30] - 2025-12-25

### Added
- **Modular Test Suite**: Restructured the comprehensive lifecycle test into a modular directory structure under `tests/scripts/`.
- **New Test Modules**:
  - `cli/`: Tests for `doctor` and other CLI commands.
  - `git/`: Tests for Git worktree and branch management.
  - `integration/`: Full lifecycle, logging, and parallel execution tests.
  - `prepare/`: Task generation and preset validation tests.
  - `templates/`: Template loading and processing tests.
  - `validation/`: Edge cases and bug scenario tests.
- **CI/CD Integration**: Integrated the new `test:quick` suite into GitHub Actions workflows (`ci.yml` and `npm-publish.yml`).
- **NPM Scripts**: Added granular test commands to `package.json` (`test:all`, `test:quick`, `test:cli`, etc.).

### Changed
- **Validation**: Enhanced `cursorflow doctor` validation checks for circular dependencies, duplicate task names, and branch prefix collisions.

## [0.1.28] - 2025-12-25

### Added
- **Auto-Resume on Run**: `cursorflow run` now automatically resumes incomplete lanes if an existing run is found for the same tasks directory.

### Fixed
- **Stall Detection**: Fixed false positive STALL_NO_PROGRESS warnings when agent is actively working (THNK/TOOL events now reset progress tracking).
- **Recovery Timing**: Changed all stall recovery intervals from 1 minute to 2 minutes for more stable operation.

## [0.1.26] - 2025-12-22

### Fixed
- **Security**: Resolved Semgrep finding (detect-child-process) in process service by using `spawnSync`.
- **Security**: Fixed potential file system race conditions (TOCTOU) and added atomic write patterns for POF files.
- **Testing**: Fixed E2E test failures by skipping preflight checks in test environments.
- **CI**: Added `pnpm` installation step and updated workflow steps to use `pnpm` in GitHub Actions.
- **Refactor**: Removed unused variables and imports identified by CodeQL analysis.

## [0.1.20] - 2025-12-22

### Fixed
- **Security**: Resolved potential path traversal vulnerabilities in `Runner` and `Template` utilities by using `safeJoin`.
- **Logging**: Improved terminal output formatting and log rotation management.
- **Orchestration**: Refined lane status reporting and error handling.

### Added
- **Log Formatting**: Added `src/utils/log-formatter.ts` for consistent log output across the system.

## [0.1.19] - 2025-12-22

### Added
- **CLI Help Improvements**: Added missing `setup` command and updated `clean` command description to include `tasks`.
- **README Updates**: Synchronized command reference table with CLI help descriptions and added examples for `logs`, `resume`, and `doctor`.

## [0.1.16] - 2025-12-22

### Fixed
- **Runner**: Corrected `cursor-agent` tool approval flag from `--yes` to `--force` to resolve "Rejection Loop".
- **Runner**: Added `--approve-mcps` flag to automatically approve MCP server permissions in non-interactive mode.

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
- **Full Lifecycle Integration Test**: Added `tests/scripts/test-real-cursor-lifecycle.sh` (and `npm run test:lifecycle`) to verify end-to-end orchestration, result verification, and resource cleanup.
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

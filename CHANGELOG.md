# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

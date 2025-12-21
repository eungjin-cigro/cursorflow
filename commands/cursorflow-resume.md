# CursorFlow Resume

## Overview
Resume a lane that was interrupted or failed. CursorFlow allows you to continue from where the agent left off or restart the lane from the first task.

## Usage

```bash
cursorflow resume <lane-name> [options]
```

## Options

| Option | Description |
|------|------|
| `<lane-name>` | The name of the lane to resume (e.g., `lane-1`) |
| `--run-dir <path>` | Use a specific run directory (default: latest) |
| `--restart` | Restart the lane from the very first task |
| `--clean` | Clean up the existing worktree before resuming |
| `--skip-doctor` | Skip pre-resume checks (not recommended) |

## How it works
1. **Pre-flight Checks**: Runs doctor validation to check for branch conflicts and Git issues.
2. **State Loading**: Reads the `state.json` for the specified lane to find the last successful task.
3. **Environment Restore**: Verifies the Git worktree and branch for the lane.
4. **Execution**: Spawns a new runner that starts either from the current task index or from index 0 if `--restart` is used.

## Pre-resume Validation

Before resuming, CursorFlow automatically runs validation checks:
- **Branch conflicts**: Ensures no existing branches conflict with the lane's prefix
- **Git status**: Verifies repository state and remote connectivity
- **Task configuration**: Validates the task JSON files are still valid

To skip these checks (not recommended):
```bash
cursorflow resume lane-1 --skip-doctor
```

## Examples

### Resume a failed lane
```bash
cursorflow resume 01-lane-1
```

### Restart a lane from scratch
```bash
cursorflow resume 02-lane-2 --restart
```

### Resume from an older run
```bash
cursorflow resume 01-lane-1 --run-dir _cursorflow/logs/runs/run-123456789/
```

## Troubleshooting

### State not found
If the command fails because the state is missing, ensure you are providing the correct lane name. Use `cursorflow monitor` to see the names of the lanes in the latest run.

### Worktree issues
If the worktree directory was manually deleted, use the `--clean` or `--restart` flag to allow CursorFlow to recreate the environment.

### Branch conflicts
If resume fails due to branch conflicts:

```bash
# Check what branches exist
git branch --list "feature/*"

# Clean up old CursorFlow branches
cursorflow clean branches --dry-run
cursorflow clean branches

# Or manually delete specific branches
git branch -D feature/lane-1-old-branch
```

### Changed branch prefix
If the task JSON file's `branchPrefix` was changed after the initial run:
1. Either restore the original prefix in the JSON
2. Or use `--restart` to start fresh with the new prefix
3. Or manually clean up old branches with `cursorflow clean branches`

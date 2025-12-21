# CursorFlow Resume

## Overview
Resume lanes that were interrupted or failed. CursorFlow allows you to continue from where the agent left off, restart from the first task, or resume all incomplete lanes at once.

## Usage

```bash
cursorflow resume [lane-name] [options]
cursorflow resume --status              # Check status of all lanes
cursorflow resume --all                 # Resume all incomplete lanes
```

## Options

| Option | Description |
|------|------|
| `<lane-name>` | The name of the lane to resume (e.g., `lane-1`) |
| `--status` | Show status of all lanes in the run (no resume) |
| `--all` | Resume ALL incomplete/failed lanes automatically |
| `--run-dir <path>` | Use a specific run directory (default: latest) |
| `--max-concurrent <n>` | Max lanes to run in parallel when using `--all` (default: 3) |
| `--restart` | Restart from the first task (index 0) |
| `--clean` | Clean up the existing worktree before resuming |
| `--skip-doctor` | Skip pre-resume checks (not recommended) |

## Checking Lane Status

Before resuming, you can check the status of all lanes:

```bash
cursorflow resume --status
```

This displays a table showing:
- Lane name
- Current status (completed, failed, running, paused, etc.)
- Progress (current task / total tasks)
- Whether the lane needs to be resumed

Example output:
```
📊 Lane Status (run-1703145600000)

  Lane                     Status      Progress    Needs Resume
  ------------------------------------------------------------
  01-lane-auth             completed   3/3         
  02-lane-api              failed      1/3         ✓
   └─ Error: cursor-agent timed out...
  03-lane-ui               running     2/3         ✓

  Total: 3 | Completed: 1 | Needs Resume: 2

  Tip: Run cursorflow resume --all to resume all incomplete lanes
```

## Resuming All Incomplete Lanes

The most common use case after interruption:

```bash
# Check what needs to be resumed
cursorflow resume --status

# Resume all incomplete lanes
cursorflow resume --all

# Resume with custom concurrency
cursorflow resume --all --max-concurrent 2

# Restart all incomplete lanes from the beginning
cursorflow resume --all --restart
```

## How it works

### Single Lane Resume
1. **Pre-flight Checks**: Runs doctor validation to check for branch conflicts and Git issues.
2. **State Loading**: Reads the `state.json` for the specified lane to find the last successful task.
3. **Environment Restore**: Verifies the Git worktree and branch for the lane.
4. **Execution**: Spawns a new runner that starts either from the current task index or from index 0 if `--restart` is used.

### Resume All (`--all`)
1. **Status Check**: Scans all lanes in the run directory.
2. **Filter**: Identifies lanes that need resuming (failed, paused, interrupted).
3. **Dependency Analysis**: 
   - Checks each lane's `dependsOn` field
   - Skips lanes with unresolvable dependencies (deps not completed and not in resume list)
   - Orders execution so lanes wait for their dependencies to complete first
4. **Pre-flight Checks**: Runs doctor validation once for the entire run.
5. **Parallel Execution**: Spawns runners for multiple lanes with concurrency control.
6. **Dependency-Aware Scheduling**: Only starts a lane when all its dependencies have completed.
7. **Progress Tracking**: Reports success/failure/skipped for each lane.

## Pre-resume Validation

Before resuming, CursorFlow automatically runs validation checks:
- **Branch conflicts**: Ensures no existing branches conflict with the lane's prefix
- **Git status**: Verifies repository state and remote connectivity
- **Task configuration**: Validates the task JSON files are still valid

To skip these checks (not recommended):
```bash
cursorflow resume lane-1 --skip-doctor
cursorflow resume --all --skip-doctor
```

## Examples

### Check status of all lanes
```bash
cursorflow resume --status
```

### Resume all incomplete lanes
```bash
cursorflow resume --all
```

### Resume a single failed lane
```bash
cursorflow resume 01-lane-1
```

### Restart a lane from scratch
```bash
cursorflow resume 02-lane-2 --restart
```

### Resume from an older run
```bash
cursorflow resume --status --run-dir _cursorflow/logs/runs/run-123456789/
cursorflow resume --all --run-dir _cursorflow/logs/runs/run-123456789/
```

### Resume with limited parallelism
```bash
cursorflow resume --all --max-concurrent 1  # One at a time
```

## Dependency Handling

When using `--all`, CursorFlow respects the `dependsOn` field in each lane's configuration:

- **Automatic ordering**: Lanes will wait for their dependencies to complete before starting
- **Skipped lanes**: If a lane depends on another that isn't completed and isn't in the resume queue, it will be skipped
- **Parallel with deps**: Independent lanes run in parallel; dependent lanes wait

Example status output with dependencies:
```
📊 Lane Status (run-1703145600000)

  Lane                     Status      Progress    DependsOn      Resumable
  ---------------------------------------------------------------------------
  01-lane-core             completed   3/3         -              
  02-lane-api              failed      1/3         01-lane-core   ✓
  03-lane-ui               failed      0/3         02-lane-api    ⏳ waiting
   └─ waiting for: 02-lane-api

  Total: 3 | Completed: 1 | Needs Resume: 2

  Tip: Run cursorflow resume --all to resume all incomplete lanes
       Lanes with dependencies will wait until their dependencies complete.
```

In this example:
- `01-lane-core` is already completed
- `02-lane-api` can start immediately (its dependency `01-lane-core` is completed)
- `03-lane-ui` will wait until `02-lane-api` completes

## Troubleshooting

### State not found
If the command fails because the state is missing, ensure you are providing the correct lane name. Use `cursorflow resume --status` to see the names of the lanes in the latest run.

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

### Some lanes still failing after `--all`
If some lanes continue to fail after using `--all`:
1. Check the specific error with `cursorflow resume --status`
2. Try resuming the problematic lane individually with more visibility
3. Use `cursorflow monitor` to watch the lane in real-time
4. Check the lane's terminal log in `_cursorflow/logs/runs/<run>/lanes/<lane>/`

# CursorFlow Resume

## Overview
Resume lanes that were interrupted or failed. You can restore the previous state or restart from scratch.

## Steps

1. **Check lane status**
   ```bash
   cursorflow monitor
   ```

2. **Resume a lane**
   ```bash
   cursorflow resume <lane-name>
   ```

3. **Clean branches before resuming**
   ```bash
   cursorflow resume <lane-name> --clean
   ```

4. **Restart from the beginning**
   ```bash
   cursorflow resume <lane-name> --restart
   ```

## Options

| Option | Description |
|------|------|
| `--run-dir <path>` | Use a specific run directory |
| `--clean` | Clean branches before restarting |
| `--restart` | Start over from the beginning |
| `--force` | Continue without confirmation |

## Examples

### Resume the latest run
```bash
# Resume the lane from the latest run
cursorflow resume 01-dashboard
```

### Resume from a specific run
```bash
cursorflow resume --run-dir _cursorflow/logs/runs/my-run/ 01-dashboard
```

### Resolve branch conflicts then resume
```bash
# Clean up existing branches before restarting
cursorflow resume 01-dashboard --clean
```

### Start completely fresh
```bash
# Reset all state before restarting
cursorflow resume 01-dashboard --restart
```

## Resume process

1. **Check state**
   - Load `state.json`
   - Locate the last task index
   - Inspect the worktree state

2. **Restore the environment**
   - Verify worktree accessibility
   - Check out the branch
   - Check for uncommitted changes

3. **Resume execution**
   - Continue from the interrupted task
   - Or restart from the beginning (`--restart`)

4. **Complete**
   - Finish remaining tasks
   - Commit and push changes

## Sample state file

```json
{
  "label": "01-dashboard",
  "status": "failed",
  "currentTaskIndex": 1,
  "totalTasks": 3,
  "worktreeDir": ".cursorflow/logs/worktrees/01-dashboard-abc123",
  "pipelineBranch": "feature/dashboard-abc123",
  "error": "Build failed",
  "startTime": 1734567890000,
  "endTime": null
}
```

## Checklist
- [ ] Was the lane actually interrupted?
- [ ] Does the state file exist?
- [ ] Are there any branch conflicts?
- [ ] Does the worktree still exist?
- [ ] Are there uncommitted changes?

## Troubleshooting

### State file missing
```bash
# Check the latest run directory
ls -lt _cursorflow/logs/runs/

# Specify a run explicitly
cursorflow resume --run-dir _cursorflow/logs/runs/latest/ 01-dashboard
```

### Branch conflicts
```bash
# Inspect existing branches
git branch | grep dashboard

# Clean up and resume
cursorflow resume 01-dashboard --clean
```

### Worktree issues
```bash
# List worktrees
git worktree list

# Remove problematic worktree
git worktree remove <path> --force

# Resume
cursorflow resume 01-dashboard --restart
```

### Dependency blocks
```bash
# Verify dependencies are resolved
cursorflow monitor

# Resume after resolving
cursorflow resume 01-dashboard
```

## Resume scenarios

### Scenario 1: Interrupted by network errors
```bash
# Simply resume from the same position
cursorflow resume 01-dashboard
```

### Scenario 2: Failed due to build errors
```bash
# After fixing code
cd .cursorflow/logs/worktrees/01-dashboard-xxx/
# ... apply fixes ...
git add -A
git commit -m "fix: build error"

# Continue from the next task
cursorflow resume 01-dashboard
```

### Scenario 5: Timeout errors
If the lane failed due to timeout:
1. Increase the timeout in your task JSON:
   ```json
   { "timeout": 600000 }
   ```
2. Resume the lane:
   ```bash
   cursorflow resume 01-dashboard
   ```

### Scenario 3: Branch conflicts
```bash
# Clean branches then restart
cursorflow resume 01-dashboard --clean
```

### Scenario 4: Start over
```bash
# Reset all state
cursorflow resume 01-dashboard --restart
```

## Next steps
1. After resuming, monitor with `cursorflow monitor --watch`.
2. Check the PR when the run finishes.
3. If failures repeat, review the task configuration.

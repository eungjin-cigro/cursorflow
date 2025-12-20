# CursorFlow Run

## Overview
Execute prepared tasks with single-lane or multi-lane orchestration.

## Steps

1. **Check the task directory**
   ```bash
   ls _cursorflow/tasks/
   ```

2. **Run multiple lanes**
   ```bash
   cursorflow run _cursorflow/tasks/MyFeature/
   ```

3. **Run a single lane**
   ```bash
   cursorflow lane _cursorflow/tasks/MyFeature/01-task.json
   ```

4. **Dry run (preview the plan)**
   ```bash
   cursorflow run _cursorflow/tasks/MyFeature/ --dry-run
   ```

5. **Monitor execution**

   Watch progress from another terminal while the run is in progress:
   ```bash
   cursorflow monitor --watch
   ```

## Options

| Option | Description |
|------|------|
| `--dry-run` | Preview the plan without executing |
| `--executor <type>` | Execution mode (`cursor-agent` \| `cloud`) |
| `--no-review` | Disable code review |
| `--config <path>` | Use a custom config file |

## Examples

### Standard run
```bash
cursorflow run _cursorflow/tasks/2512191700_MyFeature/
```

### Cloud run (requires API key)
```bash
export CURSOR_API_KEY=your_key
cursorflow run _cursorflow/tasks/MyFeature/ --executor cloud
```

### Fast run without review
```bash
cursorflow run _cursorflow/tasks/MyFeature/ --no-review
```

## Execution process

1. **Initialization**
   - Load configuration
   - Verify the `cursor-agent` CLI
   - Confirm Git repository status

2. **Prepare lanes**
   - Create worktrees
   - Check out branches
   - Configure the environment

3. **Run tasks**
   - Execute tasks sequentially
   - Commit after each task
   - Trigger automatic review when enabled

4. **Complete**
   - Push changes
   - Create a PR (depending on settings)
   - Store logs

## Log location

Run logs are stored in `_cursorflow/logs/runs/`:

```
_cursorflow/logs/runs/<lane>-<timestamp>/
├── state.json              # Lane status
├── results.json            # Task results
├── conversation.jsonl      # Agent conversation
├── git-operations.jsonl    # Git activity log
└── events.jsonl            # Event log
```

## Checklist
- [ ] Is the `cursor-agent` CLI installed?
- [ ] Are Git worktrees available?
- [ ] Are the task files valid?
- [ ] Do branch names avoid collisions?
- [ ] Are required environment variables set? (for cloud runs)

## Troubleshooting

### Branch conflicts
```bash
# Clean up existing branches
cursorflow clean branches --pattern "feature/my-*"
```

### Worktree conflicts
```bash
# Clean up existing worktrees
cursorflow clean worktrees --all
```

### Run failures
```bash
# Inspect logs
cursorflow monitor
# or
cat _cursorflow/logs/runs/latest/*/state.json
```

## Next steps
1. Monitor progress with `cursorflow monitor --watch`.
2. Review the PR when the run completes.
3. If a run fails, resume with `cursorflow resume <lane>`.

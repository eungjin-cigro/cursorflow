# Multi-Instance Safety Guide

This document covers potential issues when running multiple CursorFlow instances simultaneously and provides best practices for safe operation.

## Overview

CursorFlow uses Git worktrees to enable parallel AI agent execution. When multiple flows run on the same repository, shared resources can lead to conflicts and data loss if not managed carefully.

## Potential Issues

### 1. Clean Command Data Loss (Critical)

**Problem**: Running `cursorflow clean` while another flow is active can delete worktrees containing unpushed work.

```
Flow A: Running tasks in worktree-1 (has uncommitted changes)
Flow B: User runs "cursorflow clean worktrees --force"
Result: worktree-1 deleted, Flow A's work is LOST
```

**Mitigation**:
- CursorFlow now auto-pushes branches to remote before cleaning (v0.1.30+)
- Active flow detection warns before destructive operations
- Use `--dry-run` first to see what would be affected

### 2. Branch Name Collisions

**Problem**: Two flows preparing tasks with the same feature name may create conflicting branch names.

```
Flow A: cursorflow prepare AuthFeature --lanes 2
Flow B: cursorflow prepare AuthFeature --lanes 2
Result: Both try to create "authfeature/lane-1-*" branches
```

**Mitigation**:
- Use unique feature names for each flow
- Include timestamps or identifiers in feature names
- Example: `AuthFeature-$(date +%H%M)` or `AuthFeature-alice`

### 3. Worktree Path Conflicts

**Problem**: Worktrees are created in `_cursorflow/worktrees/`. If naming patterns overlap, conflicts occur.

**Mitigation**:
- CursorFlow uses run-specific paths: `_cursorflow/worktrees/run-{timestamp}/`
- Each run gets isolated directories
- Avoid manually creating worktrees in this directory

### 4. Lock File Contention

**Problem**: Some operations use file-based locks. Heavy concurrent usage may cause timeouts.

**Mitigation**:
- Locks auto-expire after 60 seconds if process dies
- `cursorflow doctor` can clean stale locks
- Reduce concurrent operations if timeouts occur

## Best Practices

### For Multiple Flows on Same Repository

1. **Use Unique Task Names**
   ```bash
   # Good: Unique identifiers
   cursorflow prepare Feature-Alice --preset complex
   cursorflow prepare Feature-Bob --preset complex
   
   # Bad: Same name
   cursorflow prepare Feature --preset complex  # Flow A
   cursorflow prepare Feature --preset complex  # Flow B - conflicts!
   ```

2. **Check Status Before Cleaning**
   ```bash
   # Always check what's running
   cursorflow runs
   
   # Use dry-run first
   cursorflow clean worktrees --dry-run
   
   # Only then clean
   cursorflow clean worktrees
   ```

3. **Let Auto-Push Protect Your Work**
   ```bash
   # Default: pushes branches before cleaning
   cursorflow clean worktrees
   
   # Skip push only for truly disposable work
   cursorflow clean worktrees --no-push
   ```

4. **Monitor Active Flows**
   ```bash
   # See all running flows
   cursorflow monitor
   
   # Check specific run status
   cursorflow runs --run-id run-1234567890
   ```

### For CI/CD Environments

1. **Isolate by Directory**
   ```bash
   # Each CI job gets its own clone
   git clone repo /tmp/job-$CI_JOB_ID
   cd /tmp/job-$CI_JOB_ID
   cursorflow run tasks/
   ```

2. **Use `--no-git` for Stateless Runs**
   ```bash
   # No worktrees, no branches - purely local execution
   cursorflow run tasks/ --no-git
   ```

3. **Clean Up After Each Job**
   ```bash
   # At end of CI job
   cursorflow clean all --include-latest
   ```

## Recovery Procedures

### If Work Was Lost Due to Clean

#### Method 1: Recover from Remote (Recommended)

If auto-push was enabled (default), branches were pushed before deletion:

```bash
# List all remote branches
git branch -r | grep cursorflow

# Checkout the lost branch
git checkout -b recovered-work origin/feature/lane-1-abc123

# Or fetch all and find your commits
git fetch --all
git log --all --oneline | head -50
```

#### Method 2: Recover from Git Reflog

Git keeps references to recent commits even after branch deletion:

```bash
# Show recent HEAD positions
git reflog

# Find commits from your lost work (look for commit messages)
git reflog | grep "your commit message"

# Recover specific commit
git checkout -b recovered-work abc123

# Or cherry-pick commits to current branch
git cherry-pick abc123
```

#### Method 3: Recover from Dangling Commits

```bash
# Find unreachable commits
git fsck --unreachable | grep commit

# Show content of a dangling commit
git show abc123

# Recover it
git checkout -b recovered abc123
```

### If Worktree Is Corrupted

```bash
# Remove corrupted worktree reference
git worktree remove --force _cursorflow/worktrees/corrupted-path

# Prune stale worktree references
git worktree prune

# Re-run CursorFlow
cursorflow run tasks/
```

### If Branch Is Locked

```bash
# Check for lock files
ls -la .git/worktrees/*/locked

# Remove stale locks
rm .git/worktrees/*/locked

# Or use CursorFlow's lock cleanup
cursorflow doctor --fix
```

## Architecture Notes

### How CursorFlow Manages Resources

```
Repository Root/
├── _cursorflow/
│   ├── worktrees/           # Git worktrees for parallel lanes
│   │   └── run-{timestamp}/ # Each run gets isolated directory
│   │       ├── lane-1/      # Worktree for lane 1
│   │       └── lane-2/      # Worktree for lane 2
│   ├── logs/
│   │   └── runs/            # Run logs and state
│   │       └── run-{timestamp}/
│   │           ├── lanes/   # Per-lane state files
│   │           └── state.json
│   └── locks/               # File-based locks
│       └── *.lock
└── .git/
    └── worktrees/           # Git's internal worktree tracking
```

### Flow Lifecycle

1. **Prepare**: Creates task JSON files in `_cursorflow/tasks/`
2. **Run**: Creates worktrees, branches, and executes tasks
3. **Monitor**: Tracks state in `_cursorflow/logs/runs/`
4. **Clean**: Removes worktrees and optionally branches

### Resource Isolation

Each `cursorflow run` creates:
- Unique run directory: `run-{timestamp}`
- Unique branch names: `{feature}/{lane}-{hash}`
- Isolated worktree paths

This isolation prevents most conflicts, but the `clean` command operates globally.

## Troubleshooting

### "Lock acquisition failed"

```bash
# Check lock status
cursorflow doctor

# Clean stale locks
cursorflow doctor --fix

# Or manually
rm -f _cursorflow/locks/*.lock
```

### "Worktree already exists"

```bash
# Check existing worktrees
git worktree list

# Remove specific worktree
git worktree remove _cursorflow/worktrees/path --force

# Or clean all CursorFlow worktrees
cursorflow clean worktrees
```

### "Branch already exists"

```bash
# List feature branches
git branch | grep feature/

# Delete specific branch
git branch -D feature/conflicting-branch

# Or clean all CursorFlow branches
cursorflow clean branches
```

## Related Commands

| Command | Description |
|---------|-------------|
| `cursorflow runs` | List all runs and their status |
| `cursorflow clean --dry-run` | Preview what would be cleaned |
| `cursorflow clean --run <id>` | Clean specific run only |
| `cursorflow clean --orphaned` | Clean only orphaned resources |
| `cursorflow doctor` | Check and fix environment issues |


# CursorFlow Clean

## Overview
Clean up temporary resources created by CursorFlow, including Git worktrees, feature branches, log files, and task definitions.

## Usage

```bash
cursorflow clean <type> [options]
```

## Clean Types

| Type | Description |
|------|------|
| `branches` | Remove local feature branches created by CursorFlow |
| `worktrees` | Remove temporary Git worktrees |
| `logs` | Clear all run and terminal logs |
| `tasks` | Remove task definition directories (keeps `example/`) |
| `all` | Clean everything (branches, worktrees, logs, and tasks) |

## Options

| Option | Description |
|------|------|
| `--run <id>` | Clean resources linked to a specific run |
| `--older-than <time>` | Clean resources older than a specific time (e.g., `24h`, `7d`) |
| `--orphaned` | Clean orphaned resources (worktrees without runs, etc.) |
| `--dry-run` | Show what would be removed without actually deleting anything |
| `--force` | Force removal (ignore uncommitted changes in worktrees) |
| `--include-latest` | Also remove the most recent item (by default, latest is kept) |
| `--help`, `-h` | Show help |

## Examples

### Review before deleting (latest is kept by default)
```bash
cursorflow clean all --dry-run
```

### Clean only worktrees (keeps the latest worktree)
```bash
cursorflow clean worktrees
```

### Force clean everything including the latest
```bash
cursorflow clean all --force --include-latest
```

### Remove all worktrees including the latest
```bash
cursorflow clean worktrees --include-latest
```

### Clean resources for a specific run
```bash
cursorflow clean all --run run-1734873132
```

### Clean logs and tasks older than 7 days
```bash
cursorflow clean logs --older-than 7d
cursorflow clean tasks --older-than 7d
```

### Clean orphaned worktrees and branches
```bash
cursorflow clean all --orphaned
```

## Notes

1. **Safety**: It is highly recommended to run with `--dry-run` first to see exactly what will be deleted.
2. **Worktrees**: The command identifies CursorFlow worktrees by their location (usually in `_cursorflow/worktrees/`) or their prefix.
3. **Branches**: Only branches starting with the configured `branchPrefix` (default: `cursorflow/`) are targeted.
4. **Irreversible**: Once logs are deleted, they cannot be recovered.
5. **Default Behavior**: By default, the most recent item is preserved. The "most recent" is determined by:
   - **Worktrees**: Directory modification time
   - **Branches**: Latest commit timestamp
   - **Logs**: File/directory modification time
   - **Tasks**: Directory modification time
   
   Use `--include-latest` to remove everything including the most recent item.

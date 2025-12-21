# CursorFlow Clean

## Overview
Clean up temporary resources created by CursorFlow, including Git worktrees, feature branches, and log files.

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
| `all` | Clean everything (branches, worktrees, and logs) |

## Options

| Option | Description |
|------|------|
| `--dry-run` | Show what would be removed without actually deleting anything |
| `--force` | Force removal (ignore uncommitted changes in worktrees) |
| `--help`, `-h` | Show help |

## Examples

### Review before deleting
```bash
cursorflow clean all --dry-run
```

### Clean only worktrees
```bash
cursorflow clean worktrees
```

### Force clean everything
```bash
cursorflow clean all --force
```

## Notes

1. **Safety**: It is highly recommended to run with `--dry-run` first to see exactly what will be deleted.
2. **Worktrees**: The command identifies CursorFlow worktrees by their location (usually in `_cursorflow/worktrees/`) or their prefix.
3. **Branches**: Only branches starting with the configured `branchPrefix` (default: `cursorflow/`) are targeted.
4. **Irreversible**: Once logs are deleted, they cannot be recovered.

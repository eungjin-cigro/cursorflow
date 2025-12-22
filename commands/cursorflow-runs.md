# CursorFlow Runs

## Overview
List and view detailed information about CursorFlow runs.

## Usage

```bash
cursorflow runs [run-id] [options]
```

## Options

| Option | Description |
|--------|-------------|
| `[run-id]` | View details of a specific run |
| `--running` | Filter to show only running runs |
| `--status <status>` | Filter by status: `running`, `completed`, `failed`, `partial`, `pending` |
| `--json` | Output in JSON format |
| `--help`, `-h` | Show help |

## Examples

### List all runs
```bash
cursorflow runs
```

### List only running runs
```bash
cursorflow runs --running
```

### View details of a specific run
```bash
cursorflow runs run-1734873132
```

### Export runs to JSON
```bash
cursorflow runs --json > runs.json
```

## Output Format

### List View
```
    Run ID              Task            Status     Lanes     Duration
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ▶ run-20251222-153012 AuthSystem      🔄 running  2/3       15m 23s
    run-20251222-143052 UserProfile     ✅ done     3/3       45m 12s
```

### Detail View
The detail view includes:
- Task name and overall status
- Start time and duration
- Individual lane statuses and PIDs
- Associated Git branches and worktrees

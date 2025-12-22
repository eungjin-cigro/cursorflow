# CursorFlow Stop

## Overview
Stop running CursorFlow workflows or specific lanes by killing their associated processes.

## Usage

```bash
cursorflow stop [run-id] [options]
```

## Options

| Option | Description |
|--------|-------------|
| `[run-id]` | Stop a specific run |
| `--lane <name>` | Stop only a specific lane |
| `--force` | Use `SIGKILL` instead of `SIGTERM` (immediate termination) |
| `--yes`, `-y` | Skip confirmation prompt |
| `--help`, `-h` | Show help |

## Examples

### Stop all running workflows
```bash
cursorflow stop
```

### Stop a specific run
```bash
cursorflow stop run-20251222-153012
```

### Stop only one lane
```bash
cursorflow stop --lane api-setup
```

### Force stop everything without confirmation
```bash
cursorflow stop --force --yes
```

## Execution Flow

1. **Detection**: identifies active runs and their associated PIDs.
2. **Confirmation**: Unless `--yes` is used, it lists running workflows and asks for confirmation.
3. **Termination**: Sends termination signals to all active lane processes.
4. **Verification**: Displays which lanes were successfully stopped.

## Notes

1. **Signals**: By default, it sends `SIGTERM` to allow processes to clean up. Use `--force` for `SIGKILL` if a process is stuck.
2. **Persistence**: Stopping a run doesn't delete any logs or worktrees. You can resume later using `cursorflow resume`.
3. **PIDs**: The command relies on PIDs stored in the lane state files.

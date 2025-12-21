# CursorFlow Signal

## Overview
Directly intervene in a running lane by sending a message to the agent. This is useful for providing immediate feedback or corrections during long-running tasks.

## Usage

```bash
cursorflow signal <lane-name> "<message>" [options]
cursorflow signal <lane-name> --timeout <ms>
```

## Options

| Option | Description |
|------|------|
| `<lane-name>` | The name of the lane to signal |
| `"<message>"` | The text message to send to the agent |
| `--timeout <ms>` | Update the execution timeout (in milliseconds) |
| `--run-dir <path>` | Use a specific run directory (default: latest) |

## How it works
1. **Logging**: Intervention messages are recorded in the lane's conversation history.
2. **Injection**: If `enableIntervention: true`, messages are injected into the agent's input stream.
3. **Dynamic Timeout**: If `--timeout` is used, the active runner receives a signal to reset its internal timer to the new value.

## Examples

```bash
# Provide a hint to a running agent
cursorflow signal 01-lane-1 "Make sure to export the new function from index.ts"

# Increase timeout to 10 minutes mid-execution
cursorflow signal 01-lane-1 --timeout 600000
```

## Dashboard Alternative
You can also use the interactive monitor to send signals:
1. Run `cursorflow monitor latest`.
2. Select a lane and enter details (`→`).
3. Press `I` to send an intervention message.
4. Press `O` to update the execution timeout.

## Note on Intervention
For the agent to receive the signal immediately, the task must be configured with:
```json
{
  "enableIntervention": true,
  "tasks": [...]
}
```
If disabled, the signal will be logged but the agent will not be interrupted.

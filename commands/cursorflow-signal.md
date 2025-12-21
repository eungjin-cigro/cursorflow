# CursorFlow Signal

## Overview
Directly intervene in a running lane by sending a message to the agent. This is useful for providing immediate feedback or corrections during long-running tasks.

## Usage

```bash
cursorflow signal <lane-name> "<message>" [options]
```

## Options

| Option | Description |
|------|------|
| `<lane-name>` | The name of the lane to signal |
| `"<message>"` | The text message to send to the agent |
| `--run-dir <path>` | Use a specific run directory (default: latest) |

## How it works
1. **Logging**: The message is recorded in the lane's conversation history as a system/commander message.
2. **Injection**: If the lane's task configuration has `enableIntervention: true`, the message is injected into the agent's input stream.

## Example

```bash
# Provide a hint to a running agent
cursorflow signal 01-lane-1 "Make sure to export the new function from index.ts"
```

## Dashboard Alternative
You can also use the interactive monitor to send signals:
1. Run `cursorflow monitor latest`.
2. Select a lane and enter details (`→`).
3. Press `I` to type and send an intervention message.

## Note on Intervention
For the agent to receive the signal immediately, the task must be configured with:
```json
{
  "enableIntervention": true,
  "tasks": [...]
}
```
If disabled, the signal will be logged but the agent will not be interrupted.

# CursorFlow Monitor

## Overview
The `cursorflow monitor` command provides a powerful, interactive terminal-based dashboard to track the execution status of all lanes in real-time. It allows you to visualize dependencies, stream live terminal output, and intervene in running tasks.

## Usage

```bash
# Monitor the most recent run
cursorflow monitor latest

# Monitor a specific run directory
cursorflow monitor _cursorflow/logs/runs/run-2025-12-21T10-00-00
```

## Dashboard Controls

### List View (Main)
- **Navigation**: Use `↑` and `↓` to move between lanes.
- **Details**: Press `→` or `Enter` to enter the **Lane Detail View**.
- **Flow View**: Press `F` to see the task dependency graph (DAG).
- **Quit**: Press `Q` to exit.

### Lane Detail View
- **History Browsing**: Use `↑` and `↓` to scroll through conversation history.
- **Message Detail**: Press `→` or `Enter` on a message to see its full content.
- **Live Terminal**: Press `T` to enter the **Full Terminal View**.
- **Intervention**: Press `I` to send a manual prompt to the agent (requires `enableIntervention: true`).
- **Kill Process**: Press `K` to forcefully terminate a stuck agent process.
- **Back**: Press `←` or `Esc` to return to the List View.

### Full Terminal View
- **Scrolling**: Use `↑` and `↓` to scroll through the entire agent output log.
- **Back**: Press `T`, `←`, or `Esc` to return to the Lane Detail View.

### Intervention View
- **Typing**: Type your message directly.
- **Send**: Press `Enter` to send the intervention message.
- **Cancel**: Press `Esc` to cancel and return.

## Key Concepts

### Lane Statuses
| Status | Icon | Description |
|--------|------|-------------|
| `pending` | ⚪ | Lane is waiting to start |
| `waiting` | ⏳ | Waiting for parent dependencies to complete |
| `running` | 🔄 | Agent is currently executing tasks |
| `reviewing` | 👀 | AI Reviewer is checking the task results |
| `completed` | ✅ | All tasks and reviews finished successfully |
| `failed` | ❌ | A task or review failed with an error |
| `blocked` | 🚫 | Blocked by a failed dependency |

### Dependency Flow View
A visual representation of the Directed Acyclic Graph (DAG). It shows which lanes must finish before others can start, helping you understand the execution pipeline.

### Heartbeat Logs
CursorFlow monitors agent activity and logs status every few seconds. If a lane shows `0 bytes received` for a long period, it may be stuck or thinking deeply.

## Troubleshooting

### Lane is stuck
1. Enter the **Lane Detail View**.
2. Check the **PID** to ensure the process is still alive.
3. Check the **Live Terminal** preview or enter **Full Terminal View (T)**.
4. If it's truly stuck, press `K` to kill it, then use `cursorflow resume <lane>` to restart.

### Sending Instructions
If the agent is heading in the wrong direction, use the **Intervention (I)** feature to guide it without stopping the run. Note that this requires `enableIntervention: true` in the task's JSON configuration.

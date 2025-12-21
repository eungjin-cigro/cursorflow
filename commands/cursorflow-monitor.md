# CursorFlow Monitor

## Overview
The `cursorflow monitor` command provides a powerful, interactive terminal-based dashboard to track the execution status of all lanes in real-time. It allows you to visualize dependencies, stream live terminal output, and intervene in running tasks.

## Steps

1. **Launch the interactive dashboard**
   ```bash
   # Monitor the most recent run
   cursorflow monitor latest
   ```

2. **Dashboard Controls**
   - **Navigation**: Use `↑` and `↓` to move between lanes.
   - **Details**: Press `→` or `Enter` to see task progress, conversation history, and more.
   - **Flow View**: Press `F` (from list view) to see the Directed Acyclic Graph (DAG) of task dependencies.
   - **Live Terminal**: Press `T` (from lane detail) to stream the real-time output of the AI agent.
   - **Intervention**: Press `I` (from lane detail) to send a manual prompt to a running agent.
   - **Kill Process**: Press `K` (from lane detail) to forcefully terminate a stuck agent.
   - **Back**: Use `←` or `Esc` to navigate back to previous screens.
   - **Quit**: Press `Q` to exit.

3. **Monitor a specific run directory**
   ```bash
   cursorflow monitor _cursorflow/logs/runs/run-2025-12-21T10-00-00
   ```

## Key Views

### List View
Shows an overview of all lanes, their status (pending, running, completed, failed, blocked), progress percentage, elapsed time, and "Next Action" (what it's waiting for or what it unlocks).

### Dependency Flow View
A visual map of how tasks relate to each other. It shows which lanes must finish before others can start.

### Lane Detail View
Displays:
- **Status & Progress**: Current task index and total tasks.
- **PID**: The process ID of the running `cursor-agent`.
- **Live Terminal (Preview)**: The last few lines of the agent's output.
- **Conversation History**: A scrollable list of messages between the system and the agent. Select a message to see its full content.

### Full Terminal View
A dedicated view that acts like `tail -f` for the agent's log. You can scroll up/down through the history using `↑` and `↓`.

### Heartbeat Logs
During execution, CursorFlow outputs heartbeat messages every 30 seconds:
```
⏱ Heartbeat: 30s elapsed, 1234 bytes received
⏱ Heartbeat: 60s elapsed, 5678 bytes received
```

This helps you:
- Track progress of long-running tasks
- Identify stalled or hanging processes (0 bytes received)
- Estimate completion time

## Troubleshooting

### Lane is stuck (Thinking too long)
1. Enter the lane detail view.
2. Check the **PID** to ensure the process is still alive.
3. Check the **Live Terminal** to see if it's producing output.
4. If it's truly stuck, press `K` to kill the process and then use `cursorflow resume` to restart it.

### Intervention needed
If the agent is making a mistake or needs clarification:

> ⚠️ **Note**: Intervention requires `enableIntervention: true` in your task configuration!

1. Enter the lane detail view.
2. Press `I`.
3. Type your instructions (e.g., "Don't change the package.json, just fix the bug in utils.ts").
4. Press `Enter` to send.

If `enableIntervention` is enabled in your task JSON, the agent receives this as its next prompt. If not, the message is logged but not injected.

**To enable intervention in your task JSON:**
```json
{
  "enableIntervention": true,
  "tasks": [...]
}
```

## Next steps
1. Once all lanes reach `completed`, you can review the generated branches.
2. Use `cursorflow clean` to remove temporary worktrees after you've merged the changes.

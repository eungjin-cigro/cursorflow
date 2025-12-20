# CursorFlow Monitor

## Overview
Monitor lane execution status. Track progress in real time and inspect logs.

## Steps

1. **Monitor in real time**
   ```bash
   cursorflow monitor --watch
   ```

2. **Monitor a specific run**
   ```bash
   cursorflow monitor _cursorflow/logs/runs/my-run/
   ```

3. **Check status**

   Lane status values:
   - pending: waiting
   - running: in progress
   - completed: finished
   - failed: failed
   - blocked_dependency: waiting on dependencies

4. **Inspect logs**

   Per-lane log files:
   - `state.json`: current status
   - `conversation.jsonl`: agent conversation
   - `git-operations.jsonl`: Git activity
   - `events.jsonl`: event log

## Options

| Option | Description |
|------|------|
| `--watch` | Refresh in real time (every 2 seconds) |
| `--interval <sec>` | Refresh interval in seconds |
| `--json` | Output in JSON format |

## Examples

### Monitor the latest run
```bash
cursorflow monitor
```

### Real-time monitoring (5-second interval)
```bash
cursorflow monitor --watch --interval 5
```

### JSON output
```bash
cursorflow monitor --json | jq
```

## Sample output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  📡 Lane Status Monitoring
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Run: 01-dashboard-2025-12-19T18-30-00

- 01-dashboard: running (2/3)
- 02-client: completed (3/3)
- 03-projects: blocked_dependency (1/2)
```

## Viewing logs

### Conversation history
```bash
cat _cursorflow/logs/runs/01-dashboard-xxx/conversation.jsonl | jq
```

### Git activity log
```bash
cat _cursorflow/logs/runs/01-dashboard-xxx/git-operations.jsonl | jq
```

### Event log
```bash
cat _cursorflow/logs/runs/01-dashboard-xxx/events.jsonl | jq
```

## Status analysis

### Progress per lane
```bash
# Inspect state.json for all lanes
for state in _cursorflow/logs/runs/*/lanes/*/state.json; do
  echo "$(dirname $state):"
  jq '.status, .currentTaskIndex, .totalTasks' $state
done
```

### Find failed lanes
```bash
# Lanes where status is failed
find _cursorflow/logs/runs -name "state.json" -exec sh -c \
  'jq -r "select(.status==\"failed\") | .label" {}' \;
```

## Checklist
- [ ] Are lane states healthy?
- [ ] Did any errors occur?
- [ ] Have the logs been reviewed?
- [ ] Are any lanes blocked?
- [ ] Are there dependency issues?

## Troubleshooting

### Lane is stuck
1. Check status in `state.json`.
2. Inspect the last conversation in `conversation.jsonl`.
3. Resume if needed with `cursorflow resume <lane>`.

### Logs are missing
1. Confirm the run actually started.
2. Check log directory permissions.
3. Verify the `logsDir` path in the config file.

## Next steps
1. If you find issues, resume with `cursorflow resume`.
2. Review PRs for completed lanes.
3. Analyze logs to identify improvements.

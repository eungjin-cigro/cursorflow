# CursorFlow Run

## Overview
Execute the AI agent orchestration for a set of tasks. CursorFlow uses a sophisticated DAG (Directed Acyclic Graph) scheduler to handle dependencies between tasks and ensure they run in the correct order.

## Usage

```bash
cursorflow run <tasks-dir> [options]
```

## How it works

1. **Validation**: CursorFlow validates all task configurations before starting.
2. **Task Loading**: Scans the specified directory for `.json` task files.
3. **Dependency Resolution**: Builds a graph based on the `dependsOn` field in each task.
4. **Execution**:
   - Lanes with no unmet dependencies are started first.
   - When a lane completes, it unlocks dependent lanes.
   - Dependent lanes automatically merge the parent's branch before starting their first task.
5. **Monitoring**: Heartbeat logs every 30 seconds show progress.
6. **Concurrency**: Respects `maxConcurrentLanes` (set in `cursorflow.config.js`) to prevent overloading system resources.

## Options

| Option | Description |
|------|------|
| `<tasks-dir>` | Directory containing task JSON files (e.g., `_cursorflow/tasks/feature-x/`) |
| `--max-concurrent <num>` | Limit the number of parallel agents (overrides config) |
| `--dry-run` | Show the execution plan and dependency graph without starting agents |

## Task Definition (JSON)

### Full Configuration Schema

```json
{
  "baseBranch": "main",
  "branchPrefix": "cursorflow/feature-",
  "model": "sonnet-4.5",
  "timeout": 300000,
  "enableIntervention": false,
  "dependsOn": ["other-lane"],
  "dependencyPolicy": {
    "allowDependencyChange": false,
    "lockfileReadOnly": true
  },
  "tasks": [
    {
      "name": "implement-feature",
      "model": "gemini-3-flash",
      "prompt": "Create a reusable button component..."
    }
  ]
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `timeout` | number | 300000 | Task timeout in milliseconds |
| `enableIntervention` | boolean | false | Enable stdin piping for intervention feature |
| `model` | string | "sonnet-4.5" | Default AI model for all tasks |
| `dependsOn` | string[] | [] | Lane dependencies to merge before starting |
| `baseBranch` | string | "main" | Base branch for worktree |
| `branchPrefix` | string | "cursorflow/" | Prefix for created branches |

### Task Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | string | ✅ | Unique task identifier (alphanumeric, `-`, `_` only) |
| `prompt` | string | ✅ | Task prompt for the AI agent |
| `model` | string | ❌ | Override model for this specific task |

### Example with Dependencies

```json
{
  "name": "ui-components",
  "dependsOn": ["theme-engine", "common-utils"],
  "timeout": 600000,
  "tasks": [
    {
      "name": "implement-button",
      "prompt": "Create a reusable button component using the theme engine..."
    }
  ]
}
```

## Validation Errors

CursorFlow validates task files before execution and provides helpful error messages:

| Error | Solution |
|-------|----------|
| `Task N missing required "name" field` | Add `"name": "task-name"` to each task |
| `Task name contains invalid characters` | Use only letters, numbers, `-`, `_` |
| `"timeout" must be a positive number` | Provide timeout as milliseconds (e.g., `60000`) |

## Progress Monitoring

During execution, CursorFlow outputs heartbeat logs every 30 seconds:

```
⏱ Heartbeat: 30s elapsed, 1234 bytes received
⏱ Heartbeat: 60s elapsed, 5678 bytes received
```

This helps identify:
- Long-running tasks
- Stalled or hanging processes
- Network issues (0 bytes received)

## Best Practices

### Sequential Workflows
For tasks that must happen one after another, chain them using `dependsOn`. CursorFlow will handle the branch merges automatically.

### Parallel Workflows
Tasks that don't depend on each other will run in parallel up to the `maxConcurrentLanes` limit.

### Monitoring
Always use `cursorflow monitor latest` in a separate terminal to keep track of the run.

## Troubleshooting

### Deadlocks
If you create circular dependencies (e.g., A depends on B, and B depends on A), CursorFlow will detect the deadlock at startup and refuse to run.

### Merge Conflicts
If a parent lane and a child lane modify the same lines, a merge conflict might occur when the child starts.
1. The monitor will show the lane as `failed` with a merge error.
2. Go to the lane's worktree (found in the monitor detail).
3. Manually resolve the conflict.
4. Run `cursorflow resume <lane>` to continue.

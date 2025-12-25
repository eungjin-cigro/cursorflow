# CursorFlow Doctor

## Overview
Verify that your environment and flow configurations are properly set up for CursorFlow.

## Usage

```bash
cursorflow doctor [flow-name] [options]
```

## Checks Performed
- **Environment**: Git repository status, remote availability, and worktree support.
- **Cursor IDE**: Verifies `cursor-agent` is installed and authenticated.
- **Flow/Tasks**: (Optional) Validates flow JSON files for schema errors or missing fields.

## Options

| Option | Description |
|------|------|
| `[flow-name]` | Flow name to validate (e.g., `SearchFeature`) |
| `--tasks-dir <path>` | Validate flow/tasks in a specific directory (legacy) |
| `--executor <type>` | Check environment for `cursor-agent` \| `cloud` |
| `--test-agent` | Run an interactive agent test (to approve permissions) |
| `--no-cursor` | Skip Cursor Agent installation and auth checks |
| `--json` | Output the report in machine-readable JSON format |

## Flow Validation

When a flow name or `--tasks-dir` is provided, the doctor performs comprehensive validation:

### Structure Validation
- **tasks array**: Must exist and be non-empty
- **task.name**: Required, must be alphanumeric with `-` and `_` only, unique within lane
- **task.prompt**: Required, should be descriptive (warns if < 10 chars)
- **task.model**: Optional, must be string if provided
- **task.dependsOn**: Optional, task-level dependencies

### Dependency Validation (DAG)
- **Unknown dependencies**: Reports if `dependsOn` references non-existent lanes/tasks
- **Circular dependencies**: Detects cycles (e.g., A→B→A) that would cause deadlock
- Reports the exact cycle path for easy debugging

### Branch Validation
- **Prefix collision**: Warns if multiple lanes use the same `branchPrefix`
- **Existing branch conflicts**: Detects if existing branches match a lane's prefix
- **Duplicate lane names**: Ensures each lane file has a unique name

## Examples

```bash
# Basic environment check
cursorflow doctor

# Validate a specific flow by name
cursorflow doctor SearchFeature

# Test agent permissions
cursorflow doctor --test-agent

# Validate a specific flow directory
cursorflow doctor --tasks-dir _cursorflow/flows/001_SearchFeature

# Skip cursor checks (faster)
cursorflow doctor SearchFeature --no-cursor

# Output as JSON
cursorflow doctor SearchFeature --json
```

## Example Output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🩺 CursorFlow Doctor
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

cwd: /home/user/project
repo: /home/user/project
tasks: /home/user/project/_cursorflow/flows/001_SearchFeature

✅ All checks passed

💡 Tip: If this is your first run, we recommend running:
   cursorflow doctor --test-agent
```

## Common Issues & Fixes

| Issue | Potential Fix |
|-------|---------------|
| `Cursor Agent not found` | Ensure Cursor IDE is installed and `cursor` command is in PATH. |
| `Not authenticated` | Open Cursor IDE and log in to your account. |
| `Worktree not supported` | Upgrade your Git version (requires Git >= 2.5). |
| `Circular dependency` | Check the `dependsOn` fields in your task JSON files. |
| `Flow not found` | Verify flow name or create with `cursorflow new`. |

## Related Commands

- [cursorflow new](cursorflow-new.md) - Create Flow and Lanes
- [cursorflow add](cursorflow-add.md) - Add Tasks to Lanes
- [cursorflow run](cursorflow-run.md) - Run Flow

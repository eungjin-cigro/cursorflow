# CursorFlow Doctor

## Overview
Verify that your environment and task configurations are properly set up for CursorFlow.

## Usage

```bash
cursorflow doctor [options]
```

## Checks Performed
- **Environment**: Git repository status, remote availability, and worktree support.
- **Cursor IDE**: Verifies `cursor-agent` is installed and authenticated.
- **Tasks**: (Optional) Validates task JSON files for schema errors or missing fields.

## Options

| Option | Description |
|------|------|
| `--tasks-dir <path>` | Validate lane files in a specific directory |
| `--executor <type>` | Check environment for `cursor-agent` \| `cloud` |
| `--test-agent` | Run an interactive agent test (to approve permissions) |
| `--no-cursor` | Skip Cursor Agent installation and auth checks |
| `--json` | Output the report in machine-readable JSON format |

## Task Validation

When `--tasks-dir` is provided, the doctor performs comprehensive validation:

### Structure Validation
- **tasks array**: Must exist and be non-empty
- **task.name**: Required, must be alphanumeric with `-` and `_` only, unique within lane
- **task.prompt**: Required, should be descriptive (warns if < 10 chars)
- **task.model**: Optional, must be string if provided
- **task.acceptanceCriteria**: Optional, must be non-empty array if provided

### Dependency Validation (DAG)
- **Unknown dependencies**: Reports if `dependsOn` references non-existent lanes
- **Circular dependencies**: Detects cycles (e.g., A→B→A) that would cause deadlock
- Reports the exact cycle path for easy debugging

### Branch Validation
- **Prefix collision**: Warns if multiple lanes use the same `branchPrefix`
- **Existing branch conflicts**: Detects if existing branches match a lane's prefix
- **Duplicate lane names**: Ensures each lane file has a unique name
- **Naming suggestions**: Recommends using lane numbers in branch prefixes for consistency

Example errors:
```
❌ Branch prefix collision
   Multiple lanes use the same branchPrefix "feature/lane-1-": 01-lane-1, 02-lane-2
   Fix: Update the branchPrefix in each lane JSON file to be unique

⚠️ Existing branches may conflict with 01-lane-1
   Found 2 existing branch(es) matching prefix "feature/lane-1-": feature/lane-1-abc, feature/lane-1-xyz
   Fix: Delete conflicting branches or change the branchPrefix
```

## Example

```bash
# Basic environment check
cursorflow doctor

# Test agent permissions
cursorflow doctor --test-agent

# Validate a specific task set
cursorflow doctor --tasks-dir _cursorflow/tasks/my-feature/
```

## Common Issues & Fixes

| Issue | Potential Fix |
|-------|---------------|
| `Cursor Agent not found` | Ensure Cursor IDE is installed and `cursor` command is in PATH. |
| `Not authenticated` | Open Cursor IDE and log in to your account. |
| `Worktree not supported` | Upgrade your Git version (requires Git >= 2.5). |
| `Circular dependency` | Check the `dependsOn` fields in your task JSON files. |

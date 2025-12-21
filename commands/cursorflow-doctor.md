# /cursorflow-doctor

## Goal
Verify that the current environment is properly configured for CursorFlow.

## Usage
1. Type `/cursorflow-doctor` in the chat.
2. The agent will check:
   - Git repository status
   - 'origin' remote availability
   - Git worktree support
   - Cursor Agent installation and authentication
   - Task directory and lane file validity (if a path is provided)

## Context
Use this command whenever:
- You are setting up a new project with CursorFlow.
- A `cursorflow run` fails with environment-related errors.
- You want to verify your Cursor authentication status.
- You want to validate task configuration before running.

## Task Validation

When a task directory is provided, CursorFlow validates:

### Required Fields
- ✅ `tasks` array exists and is not empty
- ✅ Each task has a `name` field
- ✅ Each task has a `prompt` field

### Task Name Format
- ✅ Only letters, numbers, `-`, `_` allowed
- ❌ Spaces not allowed
- ❌ Special characters not allowed

### Configuration Values
- ✅ `timeout` is a positive number (if provided)
- ✅ `enableIntervention` is a boolean (if provided)

## Common Validation Errors

| Error | Solution |
|-------|----------|
| `Task N missing required "name" field` | Add `"name": "task-name"` to each task object |
| `Task name contains invalid characters` | Use only letters, numbers, `-`, `_` |
| `"timeout" must be a positive number` | Provide timeout in milliseconds (e.g., `60000`) |

## Example
"Check if my environment is ready for CursorFlow."
"Run cursorflow doctor on the _cursorflow/tasks/my-feature/ directory."
"Validate my task configuration in _cursorflow/tasks/api-lane/."


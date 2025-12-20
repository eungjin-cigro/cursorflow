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

## Example
"Check if my environment is ready for CursorFlow."
"Run cursorflow doctor on the _cursorflow/tasks/my-feature/ directory."


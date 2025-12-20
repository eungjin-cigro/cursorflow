# CursorFlow Demo Test

This directory contains test tasks for demonstrating CursorFlow with real LLM execution.

## Tasks Overview

### 01-create-utils.json
Creates a utility module with basic functions:
- capitalize(str)
- sum(arr)
- unique(arr)

**Model**: sonnet-4.5
**Estimated time**: 1-2 minutes

### 02-add-tests.json
Adds simple tests for the utility functions without requiring any testing framework.

**Model**: sonnet-4.5
**Estimated time**: 1-2 minutes

## Running the Demo

### Prerequisites
- cursor-agent CLI installed (`npm install -g @cursor/agent`)
- Valid Cursor API key configured

### Run the test

```bash
# From your project directory (after cursorflow init)
cursorflow run _cursorflow/tasks/demo-test/
```

### Monitor execution

In a separate terminal:
```bash
# Watch mode (updates every 2 seconds)
cursorflow monitor --watch --interval 2
```

### Check results

After completion:
```bash
# View the logs
ls -la _cursorflow/logs/runs/

# Check the latest run
cursorflow monitor
```

## What to Expect

1. **Orchestrator** will create 2 lanes (one per task)
2. **Each lane** will:
   - Create a Git worktree
   - Create a branch (`cursorflow/demo-XXXXX--01-create-utils`, etc.)
   - Execute the LLM agent with the prompt
   - Commit changes
   - Push the branch
3. **Monitor** will show:
   - Lane status (running, completed, failed)
   - Progress (current task / total tasks)
   - Real-time updates in watch mode

## Expected Output Structure

```
_cursorflow/
├── logs/
│   └── runs/
│       └── run-XXXXX/
│           └── lanes/
│               ├── 01-create-utils/
│               │   ├── state.json
│               │   ├── conversation.jsonl
│               │   └── terminal.log
│               └── 02-add-tests/
│                   ├── state.json
│                   ├── conversation.jsonl
│                   └── terminal.log
└── tasks/
    └── demo-test/
        ├── 01-create-utils.json
        ├── 02-add-tests.json
        └── README.md (this file)
```

## Troubleshooting

### If cursor-agent is not found
```bash
npm install -g @cursor/agent
```

### If API key is missing
Check your Cursor IDE settings and ensure you're authenticated.

### If worktree creation fails
Make sure you're in a Git repository with at least one commit.

## Notes

- These tasks are designed to be simple and quick
- No external dependencies required
- All operations are Git-safe (branches only, no main changes)
- Logs are preserved for inspection

# CursorFlow Demo Test

This directory contains test tasks for demonstrating CursorFlow with real LLM execution.

## Alternative: Generate with Prepare Command

Instead of using these pre-made files, you can generate similar tasks using:

```bash
# Simple approach
cursorflow prepare CreateUtils --preset simple --prompt "Create src/utils.js with capitalize, sum, unique functions"
cursorflow prepare AddTests --preset simple --prompt "Create src/utils.test.js with tests for utils"

# Or use a single complex task
cursorflow prepare UtilsWithTests --preset complex --prompt "Create utility module with tests"
```

## Tasks Overview

### 01-create-utils.json
Creates a utility module with basic functions:
- `capitalize(str)` - Capitalizes first letter
- `sum(arr)` - Sums array of numbers
- `unique(arr)` - Returns unique elements

**Model**: sonnet-4.5
**Estimated time**: 1-2 minutes
**Acceptance Criteria**: 5 criteria including function verification

### 02-add-tests.json
Adds simple tests for the utility functions without requiring any testing framework.

**Model**: sonnet-4.5
**Estimated time**: 1-2 minutes
**Acceptance Criteria**: 5 criteria including test coverage

## Running the Demo

### Prerequisites
- cursor-agent CLI installed (`npm install -g @cursor/agent`)
- Valid Cursor authentication (sign in via Cursor IDE)

### 1. Validate first
```bash
cursorflow doctor --tasks-dir _cursorflow/tasks/demo-test/
```

### 2. Run the test
```bash
cursorflow run _cursorflow/tasks/demo-test/
```

### 3. Monitor execution
```bash
# Interactive dashboard (recommended)
cursorflow monitor latest

# Or watch mode
cursorflow monitor --watch --interval 2
```

### 4. Check results
```bash
# View lane status
cursorflow monitor

# Check git branches
git branch | grep cursorflow
```

## What to Expect

1. **Orchestrator** will create 2 lanes (one per task)
2. **Each lane** will:
   - Create a Git worktree
   - Create a branch (`cursorflow/demo-utils-*`, `cursorflow/demo-tests-*`)
   - Execute the LLM agent with the prompt
   - Run AI code review (if enabled)
   - Commit changes
   - Push the branch
3. **Monitor** will show:
   - Lane status (pending, running, completed, failed)
   - Progress (current task / total tasks)
   - Dependencies (if any)
   - Real-time updates

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

## Cleanup

After testing:
```bash
# Clean branches and worktrees
cursorflow clean branches --dry-run  # Preview
cursorflow clean branches            # Execute
cursorflow clean worktrees           # Clean worktrees
```

## Troubleshooting

### If cursor-agent is not found
```bash
npm install -g @cursor/agent
```

### If authentication fails
1. Open Cursor IDE
2. Sign in to your account
3. Verify AI features work in the IDE
4. Run `cursorflow doctor` to check

### If worktree creation fails
Make sure you're in a Git repository with at least one commit:
```bash
git log --oneline -1
```

### If branch conflicts occur
```bash
cursorflow doctor --tasks-dir _cursorflow/tasks/demo-test/
```

## Notes

- These tasks run in parallel (no dependencies)
- Each task creates its own isolated branch
- AI code review is enabled by default
- All operations are Git-safe (branches only, no main changes)
- Logs are preserved for inspection

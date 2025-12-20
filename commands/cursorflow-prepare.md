# CursorFlow Prepare

## Overview
Prepare task files for a new feature by gathering requirements and generating lane-specific JSON files.

## Required references
- Package docs: `node_modules/@litmers/cursorflow-orchestrator/docs/GUIDE.md`
- Model list: run `cursorflow models --list` in the terminal

## Steps

1. **Collect feature information**

   Confirm the following details with the requester:
   ```
   📋 Task Preparation Info
   =======================

   1. Feature name: [e.g., SchemaUpdate, AdminDashboard]
   2. Number of lanes: [e.g., 3]
   3. Work per lane:
      - Lane 1: [description]
      - Lane 2: [description]
      - ...
   4. Need dependency changes? [Y/N]
   5. Existing task to reference (optional): [path or N]
   ```

2. **Create the task folder**
   ```bash
   # Timestamp-based folder name (YYMMDDHHMM - 10 digits)
   TIMESTAMP=$(date +%y%m%d%H%M)
   FEATURE_NAME="<user input>"
   TASK_DIR="_cursorflow/tasks/${TIMESTAMP}_${FEATURE_NAME}"

   mkdir -p "$TASK_DIR"
   ```

3. **Task JSON template**

   Create one JSON file per lane using this structure:
   ```json
   {
     "repository": "https://github.com/org/repo",
     "baseBranch": "main",
     "branchPrefix": "<feature>/<lane>-",
     "executor": "cursor-agent",
     "autoCreatePr": false,
     "allowDependencyChange": false,
     "lockfileReadOnly": true,
     "pollInterval": 60,

     "laneNumber": 1,
     "devPort": 3001,

     "enableReview": true,
     "reviewModel": "sonnet-4.5-thinking",
     "maxReviewIterations": 3,

     "tasks": [
       {
         "name": "plan",
         "model": "opus-4.5-thinking",
         "acceptanceCriteria": [
           "Plan document created"
         ],
         "prompt": "..."
       }
     ]
   }
   ```

4. **Model selection guide**

   | Model | Purpose | Notes |
   |------|------|------|
   | `sonnet-4.5` | General implementation, fast work | Most versatile |
   | `sonnet-4.5-thinking` | Code review, deeper reasoning | Thinking model |
   | `opus-4.5` | Complex tasks, high quality | Advanced |
   | `opus-4.5-thinking` | Architecture design | Premium |
   | `gpt-5.2` | General tasks | OpenAI |
   | `gpt-5.2-high` | Advanced reasoning | High performance |

5. **Verify the output**
   ```
   ✅ Task preparation complete
   ===========================

   Folder: _cursorflow/tasks/<timestamp>_<feature>/
   Files created:
     - 01-<lane1>.json
     - 02-<lane2>.json
     - ...
     - README.md

   Run with:
     cursorflow run _cursorflow/tasks/<timestamp>_<feature>/
   ```

## Examples

### Single-lane task
```bash
cursorflow prepare MyFeature --lanes 1
```

### Multi-lane task
```bash
cursorflow prepare AdminDashboard --lanes 5
```

### Using a custom template
```bash
cursorflow prepare MyFeature --template ./my-template.json
```

## Checklist
- [ ] Is the feature name clear?
- [ ] Is the work for each lane defined?
- [ ] Is the model selection appropriate?
- [ ] Have dependency changes been confirmed?
- [ ] Are the acceptance criteria clear?
- [ ] Have the generated files been reviewed?

## Notes
1. **Model names**: Use only valid models (check with the `models` command).
2. **Paths**: Always create tasks under `_cursorflow/tasks/`.
3. **Branch prefix**: Make it unique to avoid collisions.
4. **devPort**: Use unique ports per lane (3001, 3002, ...).

## Next steps
1. Tailor the generated JSON files to the project.
2. Write detailed prompts.
3. Run the tasks with `cursorflow run`.

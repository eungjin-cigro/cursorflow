# CursorFlow Run

## Overview

Execute AI agent orchestration using Flow configurations. CursorFlow uses a DAG (Directed Acyclic Graph) scheduler to handle task dependencies and automatic branch merging.

## Workflow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ 1. Create Flow  │ ──▶ │ 2. Add Tasks    │ ──▶ │ 3. Validate     │ ──▶ │ 4. Run          │
│ (new)           │     │ (add)           │     │ (doctor)        │     │ (run)           │
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Usage

```bash
cursorflow run <flow-name> [options]
cursorflow run <flow-path> [options]
```

### Quick Start

```bash
# Step 1: Create flow and lanes
cursorflow new AddAPI --lanes "backend,frontend"

# Step 2: Add tasks to lanes
cursorflow add AddAPI backend \
  --task "name=implement|prompt=Create REST API for users"

cursorflow add AddAPI frontend \
  --task "name=ui|prompt=Create frontend UI" \
  --after "backend:implement"

# Step 3: Validate configuration
cursorflow doctor AddAPI

# Step 4: Run
cursorflow run AddAPI
```

## How It Works

1. **Load**: Read all JSON files from the flow directory (excluding `flow.meta.json`)
2. **Validate**: Check `tasks` array, required fields (`name`, `prompt`)
3. **Resolve**: Build execution order from `dependsOn` dependencies
4. **Execute**:
   - Start lanes with no dependencies in parallel
   - When a task completes, unlock dependent tasks
   - **Dependent tasks auto-merge predecessor branches before starting**
5. **Monitor**: Heartbeat logs every 30 seconds

## Options

| Option | Description |
|--------|-------------|
| `<flow-name>` | Flow name (e.g., `AddAPI`) |
| `<flow-path>` | Flow directory path (e.g., `_cursorflow/flows/001_AddAPI`) |
| `--max-concurrent <num>` | Limit concurrent lane execution |
| `--executor <type>` | `cursor-agent` (default) or `cloud` |
| `--skip-doctor` | Skip environment checks (not recommended) |
| `--no-git` | Skip Git operations (worktree, commits, push) |
| `--dry-run` | Show execution plan without running |

## Execution Flow

### Single Lane

```bash
cursorflow new SimpleFix --lanes "main"
cursorflow add SimpleFix main --task "name=fix|prompt=Fix the bug"
cursorflow run SimpleFix
```

```
┌─────────────────────────────────────────────────────────┐
│  main                                                   │
│  ┌─────────┐                                            │
│  │   fix   │ → AI executes → Complete                   │
│  └─────────┘                                            │
└─────────────────────────────────────────────────────────┘
```

### Multiple Tasks in Lane

```bash
cursorflow add Feature api \
  --task "name=plan|prompt=Create plan" \
  --task "name=implement|prompt=Build feature"
```

```
┌─────────────────────────────────────────────────────────┐
│  api                                                    │
│  ┌────┐     ┌─────────┐                                 │
│  │plan│ ──▶ │implement│ → Complete                      │
│  └────┘     └─────────┘                                 │
└─────────────────────────────────────────────────────────┘
```

### Sequential Lanes (with dependencies)

```bash
cursorflow new FullStack --lanes "backend,api,frontend"

cursorflow add FullStack backend --task "name=db|prompt=Setup database"
cursorflow add FullStack api --task "name=impl|prompt=Create API" --after "backend"
cursorflow add FullStack frontend --task "name=ui|prompt=Create UI" --after "api"
```

```
┌───────────┐     ┌───────────┐     ┌───────────┐
│  backend  │ ──▶ │    api    │ ──▶ │ frontend  │
│   (db)    │     │  (impl)   │     │   (ui)    │
└───────────┘     └───────────┘     └───────────┘
                       │                 │
                   merges            merges
                   backend          backend,api
```

### Parallel Lanes

```bash
cursorflow new FrontBack --lanes "frontend,backend"

cursorflow add FrontBack frontend --task "name=ui|prompt=Create UI"
cursorflow add FrontBack backend --task "name=api|prompt=Create API"
```

```
┌───────────┐
│ frontend  │  (UI)
└───────────┘
              ─── both run in parallel
┌───────────┐
│  backend  │  (API)
└───────────┘
```

## Log Format

Logs use the format `[L{n}-T{t}-{lanename}]`:
- `L{n}`: Lane number (1-indexed)
- `T{t}`: Task number (1-indexed)
- `{lanename}`: First 10 characters of lane name

Example: `[L1-T2-backend]` = Lane 1, Task 2, lane name "backend"

## Monitoring During Execution

```bash
# In another terminal
cursorflow monitor latest

# Or specify the run directory
cursorflow monitor _cursorflow/logs/runs/run-xxxxx
```

The monitor shows:
- Lane status (pending, running, completed, failed)
- Current task within each lane
- Dependency graph and progress
- Real-time log streaming

## Troubleshooting

### Validation Errors

```
Task N missing required "name" field
```
→ Ensure every task has both `name` and `prompt` fields

```
Invalid task name: "my task"
```
→ Task names can only contain alphanumeric characters, `-`, and `_`

### Dependency Issues

```
Circular dependency detected
```
→ Check your `dependsOn` fields for cycles (A→B, B→A)

### Lane Stuck

If a lane stops responding:

1. Check the agent window in Cursor IDE
2. Use `cursorflow signal <lane-name> --message "continue"` to nudge
3. Or use `cursorflow resume --all` to resume

## Best Practices

1. **Always Validate First**: Run `cursorflow doctor <flow-name>` before `run`
2. **Start Small**: Test with a single lane before scaling up
3. **Use `--dry-run`**: Preview execution plan before committing
4. **Monitor Actively**: Keep `cursorflow monitor` running in a separate terminal
5. **Plan Dependencies**: Draw out the DAG before running complex workflows

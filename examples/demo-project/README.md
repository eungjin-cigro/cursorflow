# CursorFlow Demo Project

A complete example project demonstrating CursorFlow's capabilities with real LLM execution.

## 🎯 Purpose

This demo project shows how to use CursorFlow to orchestrate parallel AI tasks, including:
- Task creation and configuration
- Git worktree management
- LLM agent execution
- AI code review
- Real-time monitoring
- Complete log capture

## 🚀 Alternative: Use Prepare Command

Instead of copying pre-made task files, you can generate tasks using the `prepare` command:

```bash
# Simple preset (implement → test)
cursorflow prepare Utils --preset simple --prompt "Create utility module with capitalize, sum, unique functions"

# Or complex preset (plan → implement → test)
cursorflow prepare UtilsProject --preset complex --prompt "Build a utility module with comprehensive tests"
```

## 📦 Setup

### 1. Prerequisites

- **Node.js** >= 18.0.0
- **Git** with worktree support
- **cursor-agent** CLI: `npm install -g @cursor/agent`
- **Cursor IDE** with valid authentication

### 2. Initialize Your Project

```bash
# Create a new project
mkdir my-cursorflow-test
cd my-cursorflow-test
git init
git config user.email "you@example.com"
git config user.name "Your Name"

# Create initial files
echo '{"name":"my-test","version":"1.0.0"}' > package.json
echo "# My Test Project" > README.md
git add .
git commit -m "Initial commit"

# Rename branch to main (if needed)
git branch -m main
```

### 3. Initialize CursorFlow

```bash
npm install -g @litmers/cursorflow-orchestrator
cursorflow init
```

### 4. Copy Demo Tasks (Option A) or Generate (Option B)

**Option A: Copy pre-made tasks**
```bash
cp -r examples/demo-project/_cursorflow/tasks/demo-test your-project/_cursorflow/tasks/
```

**Option B: Generate with prepare command**
```bash
cursorflow prepare DemoUtils --preset simple --prompt "Create src/utils.js with capitalize, sum, unique functions"
```

## 🚀 Running the Demo

### 1. Validate Configuration
```bash
cursorflow doctor --tasks-dir _cursorflow/tasks/demo-test/
```

### 2. Run the Tasks
```bash
cursorflow run _cursorflow/tasks/demo-test/
```

### 3. Monitor in Real-Time
```bash
# Interactive dashboard (recommended)
cursorflow monitor latest

# Or watch mode in separate terminal
cursorflow monitor --watch --interval 2
```

## 📋 Demo Tasks

This demo includes 2 tasks that run in parallel:

### Task 1: Create Utils (`01-create-utils.json`)
- **Goal**: Create `src/utils.js` with utility functions
- **Functions**: capitalize, sum, unique
- **Model**: Sonnet 4.5
- **Review**: Enabled (sonnet-4.5-thinking)
- **Time**: ~1-2 minutes

### Task 2: Add Tests (`02-add-tests.json`)
- **Goal**: Create `src/utils.test.js` with simple tests
- **Tests**: Manual console.log tests for all utils
- **Model**: Sonnet 4.5
- **Review**: Enabled (sonnet-4.5-thinking)
- **Time**: ~1-2 minutes

## 📊 Expected Results

### 1. Source Files
```
src/
├── utils.js          # Created by Task 1
└── utils.test.js     # Created by Task 2
```

### 2. Git Branches
```bash
git branch | grep cursorflow
# cursorflow/demo-utils-*
# cursorflow/demo-tests-*
```

### 3. Logs
```
_cursorflow/logs/runs/run-XXXXX/
└── lanes/
    ├── 01-create-utils/
    │   ├── state.json
    │   ├── conversation.jsonl
    │   └── terminal.log
    └── 02-add-tests/
        ├── state.json
        ├── conversation.jsonl
        └── terminal.log
```

### 4. Monitor Output
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Run: run-1234567890123
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Lane             Status            Progress  Tasks
───────────────  ────────────────  ────────  ──────────
01-create-utils  ✅ completed      100%      1/1
02-add-tests     ✅ completed      100%      1/1
```

## 🔍 Inspecting Results

```bash
# View conversation logs
cat _cursorflow/logs/runs/run-*/lanes/01-create-utils/conversation.jsonl

# View terminal output
cat _cursorflow/logs/runs/run-*/lanes/01-create-utils/terminal.log

# View lane state
cat _cursorflow/logs/runs/run-*/lanes/01-create-utils/state.json

# View branch changes
git diff main cursorflow/demo-utils-*
```

## 🧹 Cleanup

```bash
# Using cursorflow clean
cursorflow clean branches --dry-run  # Preview
cursorflow clean branches            # Execute
cursorflow clean worktrees           # Clean worktrees

# Or manually
git worktree list | grep cursorflow | awk '{print $1}' | xargs -I {} git worktree remove {} --force
git branch | grep cursorflow | xargs -I {} git branch -D {}
```

## 🐛 Troubleshooting

### Authentication Failed
```bash
cursorflow doctor
```
Then follow the suggestions.

### cursor-agent Not Found
```bash
npm install -g @cursor/agent
```

### Timeout Errors
- Check internet connection
- Verify Cursor IDE is signed in
- Check if firewall/VPN is blocking

### Worktree Creation Failed
```bash
git log --oneline -1  # Ensure at least one commit
git branch            # Check current branch
```

### Branch Conflicts
```bash
cursorflow doctor --tasks-dir _cursorflow/tasks/demo-test/
cursorflow clean branches
```

## 📖 Learn More

- **CursorFlow Documentation**: [Main README](../../README.md)
- **Prepare Command**: [cursorflow-prepare.md](../../commands/cursorflow-prepare.md)
- **Monitor Command**: [cursorflow-monitor.md](../../commands/cursorflow-monitor.md)

## 💡 Next Steps

After running this demo:

1. **Examine the logs** to understand execution flow
2. **Check the branches** to see what the LLM created
3. **Try `cursorflow prepare`** to generate your own tasks
4. **Create complex workflows** with dependencies using `--sequential`
5. **Explore presets**: `complex` for planning, `simple` for quick fixes

## ⏱️ Timing

- Setup: ~5 minutes
- Task execution: ~2-4 minutes
- Total: ~10 minutes

## ⚠️ Notes

- Real LLM API calls will be made
- Small API usage will occur (~2-4 requests with review)
- Internet connection required
- Cursor authentication required

Happy testing! 🚀

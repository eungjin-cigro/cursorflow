# CursorFlow Demo Project

A complete example project demonstrating CursorFlow's capabilities with real LLM execution.

## 🎯 Purpose

This demo project shows how to use CursorFlow to orchestrate parallel AI tasks, including:
- Task creation and configuration
- Git worktree management
- LLM agent execution
- Real-time monitoring
- Complete log capture

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
# Install cursorflow globally (if not already)
npm install -g @litmers/cursorflow-orchestrator

# Initialize in your project
cursorflow init
```

### 4. Copy Demo Tasks

Copy the `_cursorflow/tasks/demo-test/` directory from this example to your project:

```bash
# From the cursorflow repository
cp -r examples/demo-project/_cursorflow/tasks/demo-test your-project/_cursorflow/tasks/
```

## 🚀 Running the Demo

### Run the Tasks

```bash
cursorflow run _cursorflow/tasks/demo-test/
```

### Monitor in Real-Time

In a separate terminal:

```bash
# Single check
cursorflow monitor

# Watch mode (updates every 2 seconds)
cursorflow monitor --watch --interval 2
```

## 📋 Demo Tasks

This demo includes 2 tasks that run in parallel:

### Task 1: Create Utils (`01-create-utils.json`)
- **Goal**: Create `src/utils.js` with utility functions
- **Functions**: capitalize, sum, unique
- **Model**: Sonnet 4.5
- **Time**: ~1-2 minutes

### Task 2: Add Tests (`02-add-tests.json`)
- **Goal**: Create `src/utils.test.js` with simple tests
- **Tests**: Manual console.log tests for all utils
- **Model**: Sonnet 4.5
- **Time**: ~1-2 minutes

## 📊 Expected Results

After completion, you'll see:

### 1. Source Files
```
src/
├── utils.js          # Created by Task 1
└── utils.test.js     # Created by Task 2
```

### 2. Git Branches
```bash
git branch | grep cursorflow
# cursorflow/demo-XXXXX--01-create-utils
# cursorflow/demo-XXXXX--02-add-tests
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

### View Conversation Logs
```bash
cat _cursorflow/logs/runs/run-*/lanes/01-create-utils/conversation.jsonl
```

### View Terminal Output
```bash
cat _cursorflow/logs/runs/run-*/lanes/01-create-utils/terminal.log
```

### View Lane State
```bash
cat _cursorflow/logs/runs/run-*/lanes/01-create-utils/state.json
```

### View Branch Changes
```bash
# List branches
git branch | grep cursorflow

# View commits
git log cursorflow/demo-XXXXX--01-create-utils

# View diff
git diff main cursorflow/demo-XXXXX--01-create-utils
```

## 🧹 Cleanup

After testing, clean up the worktrees and branches:

```bash
# Remove worktrees
git worktree list | grep cursorflow | awk '{print $1}' | xargs -I {} git worktree remove {} --force

# Delete branches
git branch | grep cursorflow | xargs -I {} git branch -D {}
```

Or use the clean command (if available):

```bash
cursorflow clean branches --all
cursorflow clean worktrees --all
```

## 🐛 Troubleshooting

### Authentication Failed
```
Error: Cursor authentication failed
```

**Solution**:
1. Open Cursor IDE
2. Sign in to your account
3. Verify AI features work
4. Run `node test-auth.js` to check authentication

### cursor-agent Not Found
```
Error: cursor-agent CLI not found
```

**Solution**:
```bash
npm install -g @cursor/agent
```

### Timeout Errors
```
Error: cursor-agent timed out
```

**Solution**:
- Check internet connection
- Verify Cursor IDE is signed in
- Check if firewall/VPN is blocking

### Worktree Creation Failed
```
Error: failed to create worktree
```

**Solution**:
- Ensure you have at least one commit: `git log`
- Check you're on the main branch: `git branch`

## 📖 Learn More

- **CursorFlow Documentation**: [Main README](../../README.md)
- **Task Configuration**: See task JSON files for structure
- **Configuration Options**: Check `cursorflow.config.js`

## 💡 Next Steps

After running this demo:

1. **Examine the logs** to understand execution flow
2. **Check the branches** to see what the LLM created
3. **Modify prompts** to test different scenarios
4. **Create your own tasks** for real projects
5. **Explore parallel execution** with more complex workflows

## ⏱️ Timing

- Setup: ~5 minutes
- Task execution: ~2-4 minutes
- Total: ~10 minutes

## ⚠️ Notes

- Real LLM API calls will be made
- Small API usage will occur (~2 requests)
- Internet connection required
- Cursor authentication required

Happy testing! 🚀


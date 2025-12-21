# CursorFlow Examples

This directory contains example projects and configurations to help you get started with CursorFlow.

## 🚀 Quick Start with Prepare Command

The easiest way to create tasks is using the `cursorflow prepare` command with preset templates:

```bash
# Initialize your project
cd your-project
cursorflow init

# Simple single-task (just --prompt)
cursorflow prepare QuickFix --prompt "Fix the typo in README.md"

# Simple preset (implement → test)
cursorflow prepare BugFix --preset simple --prompt "Fix login validation bug"

# Complex preset (plan → implement → test)
cursorflow prepare AuthSystem --preset complex --prompt "Build JWT authentication"

# Multiple parallel lanes with dependencies
cursorflow prepare FullStack --lanes 3 --sequential --preset complex \
  --prompt "Build your layer"
```

## 📋 Preset Templates

| Preset | Tasks | Best For |
|--------|-------|----------|
| *(none)* | implement | Quick fixes, simple changes |
| `simple` | implement → test | Bug fixes, small features |
| `complex` | plan → implement → test | Large features requiring planning |
| `merge` | merge → test | Integration of dependent lanes |

### Complex Preset with Plan Document

The `complex` preset creates a plan document that subsequent tasks reference:

```bash
cursorflow prepare Feature --preset complex --prompt "Build user dashboard"
```

This generates:
- **plan** task: Saves implementation plan to `_cursorflow/PLAN_lane-{N}.md`
- **implement** task: Reads plan and implements
- **test** task: Refers to plan for test coverage

## 📁 Available Examples

### 1. Demo Project (`demo-project/`)

A complete demonstration of CursorFlow's core features with pre-made task files.

**What it includes:**
- 2 parallel tasks (create utils + add tests)
- Real LLM execution with Claude/Sonnet
- Complete documentation
- Expected time: ~2-4 minutes

**Best for:**
- First-time users
- Understanding task JSON structure
- Testing your setup

**Quick start:**
```bash
cd your-project
cursorflow init
cp -r path/to/cursorflow/examples/demo-project/_cursorflow/tasks/demo-test _cursorflow/tasks/
cursorflow run _cursorflow/tasks/demo-test/
```

## 🎯 Common Workflows

### 1. Simple Bug Fix

```bash
cursorflow prepare FixLoginBug --preset simple \
  --prompt "Fix the null pointer exception in auth.ts line 42"

cursorflow doctor --tasks-dir _cursorflow/tasks/*_FixLoginBug
cursorflow run _cursorflow/tasks/*_FixLoginBug
```

### 2. Complex Feature

```bash
cursorflow prepare UserDashboard --preset complex \
  --prompt "Build a user dashboard with profile, settings, and activity feed"

cursorflow doctor --tasks-dir _cursorflow/tasks/*_UserDashboard
cursorflow run _cursorflow/tasks/*_UserDashboard
```

### 3. Multi-Lane Full Stack Feature

```bash
# Create 3 lanes: Backend API → Frontend UI → Integration
cursorflow prepare FullStack --lanes 3 --sequential --preset complex \
  --prompt "Build your layer of the authentication feature"

# Add tasks to specific lanes if needed
cursorflow prepare --add-task _cursorflow/tasks/*_FullStack/01-lane-1.json \
  --task "verify|sonnet-4.5|Double-check all API endpoints|All endpoints work"

cursorflow doctor --tasks-dir _cursorflow/tasks/*_FullStack
cursorflow run _cursorflow/tasks/*_FullStack
cursorflow monitor latest
```

### 4. Adding Integration Lane

```bash
# Add a merge/integration lane to existing tasks
cursorflow prepare --add-lane _cursorflow/tasks/*_FullStack \
  --depends-on "01-lane-1,02-lane-2,03-lane-3"
```

## 📚 Example Structure

Each example includes:

- **Task configurations** (`*.json`) - Defines what the AI will do
- **README.md** - Detailed instructions and explanations
- **Expected results** - What you should see after running

## 🔍 What's in a Task File?

```json
{
  "baseBranch": "main",
  "branchPrefix": "feature/lane-1-",
  "timeout": 300000,
  "enableReview": true,
  "reviewModel": "sonnet-4.5-thinking",
  "tasks": [
    {
      "name": "implement",
      "model": "sonnet-4.5",
      "prompt": "Detailed instructions for the AI...",
      "acceptanceCriteria": [
        "Code complete",
        "No build errors",
        "Tests pass"
      ]
    }
  ]
}
```

## 🚀 Prerequisites

Before running examples:

1. **Install CursorFlow**
   ```bash
   npm install -g @litmers/cursorflow-orchestrator
   ```

2. **Install cursor-agent**
   ```bash
   npm install -g @cursor/agent
   ```

3. **Authenticate Cursor**
   - Open Cursor IDE
   - Sign in to your account
   - Verify AI features work

4. **Check environment**
   ```bash
   cursorflow doctor
   ```

## 💡 Tips

- **Start with `prepare`** - Generate tasks instead of writing JSON manually
- **Use presets** - `complex` for features, `simple` for bug fixes
- **Validate first** - Always run `cursorflow doctor` before `run`
- **Monitor execution** - Use `cursorflow monitor latest` for real-time progress
- **Check logs** - Inspect `_cursorflow/logs/` after execution
- **Clean up** - Use `cursorflow clean` to remove worktrees and branches

## 📖 Learn More

- **Main Documentation**: [README.md](../README.md)
- **Prepare Command**: [cursorflow-prepare.md](../commands/cursorflow-prepare.md)
- **Run Command**: [cursorflow-run.md](../commands/cursorflow-run.md)
- **Monitor Command**: [cursorflow-monitor.md](../commands/cursorflow-monitor.md)

## 🐛 Troubleshooting

If you encounter issues:

1. Run `cursorflow doctor` to check your environment
2. Check prerequisites are installed
3. Verify Cursor authentication
4. Ensure you're in a Git repository with at least one commit
5. See example README for specific troubleshooting

## 📝 Notes

- Examples use real LLM API calls
- Small API usage will occur
- Internet connection required
- Cursor subscription required

Happy learning! 🎉

# CursorFlow Examples

This directory contains example projects and configurations to help you get started with CursorFlow.

## 📁 Available Examples

### 1. Demo Project (`demo-project/`)

A complete demonstration of CursorFlow's core features.

**What it includes:**
- 2 parallel tasks (create utils + add tests)
- Real LLM execution with Claude 3.5 Sonnet
- Complete documentation
- Expected time: ~2-4 minutes

**Best for:**
- First-time users
- Understanding the basics
- Testing your setup

**Quick start:**
```bash
# See demo-project/README.md for detailed instructions
cd your-project
cursorflow init
cp -r path/to/cursorflow/examples/demo-project/_cursorflow/tasks/demo-test _cursorflow/tasks/
cursorflow run _cursorflow/tasks/demo-test/
```

## 🎯 How to Use Examples

### Option 1: Copy to Your Project

1. Initialize CursorFlow in your project:
   ```bash
   cd your-project
   cursorflow init
   ```

2. Copy example tasks:
   ```bash
   cp -r examples/demo-project/_cursorflow/tasks/demo-test _cursorflow/tasks/
   ```

3. Run the example:
   ```bash
   cursorflow run _cursorflow/tasks/demo-test/
   ```

### Option 2: Use as Reference

Browse the example files to understand:
- Task JSON structure
- Prompt engineering best practices
- Configuration options
- Expected outcomes

## 📚 Example Structure

Each example includes:

- **Task configurations** (`*.json`) - Defines what the AI will do
- **README.md** - Detailed instructions and explanations
- **Expected results** - What you should see after running

## 🔍 What's in a Task File?

```json
{
  "baseBranch": "main",
  "branchPrefix": "cursorflow/demo-",
  "executor": "cursor-agent",
  "dependencyPolicy": {
    "allowDependencyChange": false,
    "lockfileReadOnly": true
  },
  "tasks": [
    {
      "name": "task-name",
      "model": "claude-3.5-sonnet",
      "prompt": "Detailed instructions for the AI..."
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

4. **Check authentication** (optional)
   ```bash
   node test-auth.js
   ```

## 💡 Tips

- **Start with demo-project** - It's the simplest example
- **Monitor execution** - Use `cursorflow monitor --watch` to see real-time progress
- **Check logs** - Inspect `_cursorflow/logs/` after execution
- **Experiment** - Modify prompts to test different scenarios
- **Clean up** - Remove worktrees and branches after testing

## 📖 Learn More

- **Main Documentation**: [README.md](../README.md)
- **Configuration Guide**: Check `cursorflow.config.js` in your project
- **Task Format**: See individual example task files
- **Monitoring**: [Monitor Command](../commands/cursorflow-monitor.md)

## 🐛 Troubleshooting

If you encounter issues:

1. Check prerequisites are installed
2. Verify Cursor authentication
3. Ensure you're in a Git repository
4. Check you have at least one commit
5. See example README for specific troubleshooting

## 🤝 Contributing Examples

Have a useful example? Contributions are welcome!

Please include:
- Complete task configurations
- Detailed README
- Expected results documentation
- Troubleshooting tips

## 📝 Notes

- Examples use real LLM API calls
- Small API usage will occur
- Internet connection required
- Make sure you have Cursor subscription active

Happy learning! 🎉


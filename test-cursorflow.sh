#!/bin/bash
# Quick test runner for CursorFlow
# This script helps quickly test CursorFlow with the demo project

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEMO_PROJECT="$SCRIPT_DIR/test-projects/demo-project"

if [ ! -d "$DEMO_PROJECT" ]; then
  echo "❌ Demo project not found at: $DEMO_PROJECT"
  exit 1
fi

cd "$DEMO_PROJECT"

case "${1:-help}" in
  run)
    echo "🚀 Running CursorFlow demo test..."
    ./run-demo.sh run
    ;;
    
  monitor)
    echo "📡 Monitoring CursorFlow execution..."
    ./run-demo.sh monitor
    ;;
    
  watch)
    echo "📡 Starting real-time monitoring..."
    ./run-demo.sh watch
    ;;
    
  clean)
    echo "🧹 Cleaning up test artifacts..."
    ./run-demo.sh clean
    ;;
    
  setup)
    echo "⚙️  Setting up demo project..."
    cd "$DEMO_PROJECT"
    
    # Check cursor-agent
    if ! command -v cursor-agent &> /dev/null; then
      echo "⚠️  cursor-agent not found"
      echo "   Install with: npm install -g @cursor/agent"
      exit 1
    fi
    
    echo "✅ cursor-agent found"
    
    # Check git
    if [ ! -d .git ]; then
      echo "❌ Not a git repository"
      exit 1
    fi
    
    echo "✅ Git repository OK"
    
    # Check CursorFlow init
    if [ ! -f cursorflow.config.js ]; then
      echo "❌ CursorFlow not initialized"
      exit 1
    fi
    
    echo "✅ CursorFlow configured"
    
    echo ""
    echo "🎉 Demo project is ready!"
    echo ""
    echo "Next steps:"
    echo "  1. Run: ./test-cursorflow.sh run"
    echo "  2. Monitor: ./test-cursorflow.sh watch"
    echo ""
    ;;
    
  help|*)
    cat << 'EOF'
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🧪 CursorFlow Test Runner
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Usage: ./test-cursorflow.sh [command]

Commands:
  setup    - Check prerequisites and verify setup
  run      - Run the demo test with real LLM execution
  monitor  - Check current execution status (single check)
  watch    - Monitor execution in real-time (updates every 2s)
  clean    - Clean up worktrees and branches after testing
  help     - Show this help message

Examples:
  ./test-cursorflow.sh setup   # Verify everything is ready
  ./test-cursorflow.sh run     # Start the demo
  ./test-cursorflow.sh watch   # Monitor in real-time
  ./test-cursorflow.sh clean   # Clean up after testing

Demo Project:
  Location: test-projects/demo-project/
  Tasks: 2 simple tasks to test orchestration
  Time: ~2-4 minutes total

What Gets Tested:
  ✓ Task orchestration with parallel lanes
  ✓ Git worktree creation and management
  ✓ LLM agent execution (cursor-agent + Claude)
  ✓ Real-time monitoring and status reporting
  ✓ Log capture (conversation + terminal output)
  ✓ Branch creation and commits

Prerequisites:
  • cursor-agent CLI installed
  • Valid Cursor API key
  • Git repository with at least one commit

For detailed documentation, see:
  test-projects/demo-project/README.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
    ;;
esac


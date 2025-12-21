#!/bin/bash
#
# Simple Real Logging Test
# This test runs cursor-agent directly and verifies log capture
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "🧪 Simple Cursor-Agent Logging Test"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check cursor-agent
if ! command -v cursor-agent &> /dev/null; then
    echo "❌ cursor-agent not found"
    exit 1
fi

cd "$PROJECT_ROOT"

# Build
echo "Building..."
npm run build > /dev/null 2>&1

# Setup test dir
TEST_DIR="$PROJECT_ROOT/_test-logs"
rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR"

# Create a very simple task
cat > "$TEST_DIR/task.json" << 'EOF'
{
  "baseBranch": "main",
  "branchPrefix": "test/log-",
  "timeout": 30000,
  "tasks": [
    {
      "name": "echo-test",
      "prompt": "Say 'test complete' and nothing else.",
      "model": "sonnet-4.5"
    }
  ]
}
EOF

# Run with node directly
echo ""
echo "Running cursor-agent via runner..."
echo ""

LANE_DIR="$TEST_DIR/lane"
mkdir -p "$LANE_DIR"

# Run runner.js directly
timeout 60 node dist/core/runner.js "$TEST_DIR/task.json" \
  --run-dir "$LANE_DIR" \
  --executor cursor-agent \
  --start-index 0 || true

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 Log Files Created:"
echo ""

ls -la "$LANE_DIR"/*.log "$LANE_DIR"/*.jsonl 2>/dev/null || echo "No log files found"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📝 terminal.log content:"
echo ""

if [ -f "$LANE_DIR/terminal.log" ]; then
    head -50 "$LANE_DIR/terminal.log"
else
    echo "No terminal.log"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📝 terminal.jsonl (first 3 entries):"
echo ""

if [ -f "$LANE_DIR/terminal.jsonl" ]; then
    head -3 "$LANE_DIR/terminal.jsonl"
else
    echo "No terminal.jsonl"
fi

# Cleanup git branches
git branch -D test/log-* 2>/dev/null || true
git worktree remove _cursorflow/worktrees/test/log-* --force 2>/dev/null || true

echo ""
echo "✅ Test finished"


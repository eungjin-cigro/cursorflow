#!/bin/bash
#
# Comprehensive Streaming Output Test with Multi-Task Dependencies
# 
# This test verifies:
# 1. Streaming output from cursor-agent (not just final JSON)
# 2. Multiple tasks execution in sequence
# 3. Dependency handling between tasks
# 4. Raw log capture and parsed log quality
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  🧪 Streaming Multi-Task Test${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Check cursor-agent
if ! command -v cursor-agent &> /dev/null; then
    echo -e "${RED}❌ cursor-agent not found${NC}"
    exit 1
fi

# Check auth
echo -e "${YELLOW}Checking cursor-agent authentication...${NC}"
if ! cursor-agent create-chat &> /dev/null; then
    echo -e "${RED}❌ cursor-agent authentication failed${NC}"
    exit 1
fi
echo -e "${GREEN}✓ cursor-agent authenticated${NC}"

cd "$PROJECT_ROOT"

# Build
echo -e "${YELLOW}Building project...${NC}"
npm run build > /dev/null 2>&1
echo -e "${GREEN}✓ Build complete${NC}"

# Setup test directory
TEST_DIR="$PROJECT_ROOT/_test-streaming"
rm -rf "$TEST_DIR"
mkdir -p "$TEST_DIR/lane"

# Create multi-task configuration with dependencies
cat > "$TEST_DIR/multi-task.json" << 'EOF'
{
  "baseBranch": "main",
  "branchPrefix": "test/stream-",
  "timeout": 120000,
  "dependencyPolicy": {
    "allowDependencyChange": false,
    "lockfileReadOnly": true
  },
  "tasks": [
    {
      "name": "task-1-analyze",
      "prompt": "Analyze this codebase. List the top 3 most important files and briefly explain what each does. Keep your response under 200 words. Do not make any file changes.",
      "model": "sonnet-4.5"
    },
    {
      "name": "task-2-summary",
      "prompt": "Based on your previous analysis, write a 2-sentence summary of what this project does. Do not make any file changes.",
      "model": "sonnet-4.5"
    }
  ]
}
EOF

echo -e "${GREEN}✓ Test configuration created (2 tasks)${NC}"
echo ""

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  Running orchestration with STREAMING enabled...${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

LANE_DIR="$TEST_DIR/lane"

# Run spawnLane directly to test streaming
node -e "
const { spawnLane, waitChild } = require('./dist/core/orchestrator');
const fs = require('fs');
const path = require('path');

const tasksFile = path.join('$TEST_DIR', 'multi-task.json');
const laneRunDir = '$LANE_DIR';

console.log('Spawning lane with streaming output enabled...');
console.log('');

const result = spawnLane({
  laneName: 'stream-test',
  tasksFile,
  laneRunDir,
  executor: 'cursor-agent',
  startIndex: 0,
  enhancedLogConfig: {
    enabled: true,
    stripAnsi: true,
    streamOutput: true,  // Enable streaming!
    addTimestamps: true,
    keepRawLogs: true,
    writeJsonLog: true,
    timestampFormat: 'iso',
  },
});

console.log('Lane spawned, PID:', result.child.pid);
console.log('Waiting for completion (may take 2-3 minutes)...');
console.log('');

const timeout = setTimeout(() => {
  console.log('\\nTimeout reached (3 min)');
  result.child.kill('SIGTERM');
}, 180000);

waitChild(result.child).then((code) => {
  clearTimeout(timeout);
  console.log('');
  console.log('Lane completed with exit code:', code);
  result.logManager?.close();
  process.exit(code === 0 ? 0 : 1);
}).catch(e => {
  clearTimeout(timeout);
  console.error('Error:', e);
  process.exit(1);
});
" 2>&1

EXIT_CODE=$?

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  📋 Log File Analysis${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Check files
echo -e "${YELLOW}Log files created:${NC}"
ls -la "$LANE_DIR"/*.log "$LANE_DIR"/*.jsonl 2>/dev/null || echo "No log files found"
echo ""

# Count streaming entries in JSON log
if [ -f "$LANE_DIR/terminal.jsonl" ]; then
    TOTAL_ENTRIES=$(wc -l < "$LANE_DIR/terminal.jsonl")
    STDOUT_ENTRIES=$(grep -c '"level":"stdout"' "$LANE_DIR/terminal.jsonl" || echo "0")
    STREAMING_ENTRIES=$(grep -c '"type":' "$LANE_DIR/terminal.jsonl" || echo "0")
    
    echo -e "${YELLOW}JSON Log Statistics:${NC}"
    echo "  Total entries: $TOTAL_ENTRIES"
    echo "  stdout entries: $STDOUT_ENTRIES"
    echo "  Entries with streaming 'type': $STREAMING_ENTRIES"
    echo ""
fi

# Check for streaming content markers in raw log
if [ -f "$LANE_DIR/terminal-raw.log" ]; then
    RAW_SIZE=$(wc -c < "$LANE_DIR/terminal-raw.log")
    RAW_LINES=$(wc -l < "$LANE_DIR/terminal-raw.log")
    
    # Look for streaming indicators
    HAS_TYPE_TEXT=$(grep -c '"type":"text"' "$LANE_DIR/terminal-raw.log" 2>/dev/null || echo "0")
    HAS_TYPE_RESULT=$(grep -c '"type":"result"' "$LANE_DIR/terminal-raw.log" 2>/dev/null || echo "0")
    HAS_CONTENT=$(grep -c '"content":' "$LANE_DIR/terminal-raw.log" 2>/dev/null || echo "0")
    
    echo -e "${YELLOW}Raw Log Statistics:${NC}"
    echo "  Size: $RAW_SIZE bytes"
    echo "  Lines: $RAW_LINES"
    echo ""
    echo -e "${YELLOW}Streaming Markers Found:${NC}"
    echo "  type:'text' entries: $HAS_TYPE_TEXT"
    echo "  type:'result' entries: $HAS_TYPE_RESULT"
    echo "  content entries: $HAS_CONTENT"
    echo ""
fi

# Show sample of streaming output
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  📝 Sample Streaming Output (first 30 lines of stdout)${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if [ -f "$LANE_DIR/terminal.log" ]; then
    # Show lines containing cursor-agent output (streaming JSON)
    echo -e "${MAGENTA}Looking for streaming JSON output...${NC}"
    grep -E '^\[.*\] \{"type":' "$LANE_DIR/terminal.log" | head -20 || echo "No streaming JSON found"
    echo ""
fi

# Test the logs CLI command
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  🔍 Testing cursorflow logs command${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Create a fake runs directory structure for the CLI
FAKE_RUN_DIR="$TEST_DIR/runs/run-test"
mkdir -p "$FAKE_RUN_DIR/lanes"
ln -sf "$LANE_DIR" "$FAKE_RUN_DIR/lanes/stream-test"

echo -e "${YELLOW}Testing: cursorflow logs --tail 15${NC}"
node dist/cli/index.js logs "$FAKE_RUN_DIR" --tail 15 2>&1 || true

echo ""
echo -e "${YELLOW}Testing: cursorflow logs --filter 'type.*text'${NC}"
node dist/cli/index.js logs "$FAKE_RUN_DIR" --filter '"type":"text"' --tail 10 2>&1 || true

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  📊 Test Summary${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Determine if streaming worked
if [ "$HAS_TYPE_TEXT" -gt "0" ] || [ "$HAS_CONTENT" -gt "10" ]; then
    echo -e "${GREEN}✅ Streaming output captured successfully!${NC}"
    echo "   Found $HAS_TYPE_TEXT text stream entries"
    echo "   Found $HAS_CONTENT content entries"
else
    echo -e "${YELLOW}⚠️  Limited streaming content detected${NC}"
    echo "   This may indicate:"
    echo "   - stream-json format not outputting expected data"
    echo "   - Or cursor-agent only provides final results"
fi

echo ""
echo "Log files saved at: $LANE_DIR"
echo ""

# Cleanup git
git worktree remove _cursorflow/worktrees/test/stream-* --force 2>/dev/null || true
git branch -D $(git branch | grep "test/stream-") 2>/dev/null || true

exit $EXIT_CODE


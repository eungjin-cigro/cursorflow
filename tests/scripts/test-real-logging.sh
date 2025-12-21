#!/bin/bash
#
# Real Integration Test for Enhanced Logging
# 
# This script runs an actual cursor-agent task and verifies that:
# 1. terminal.log is created with clean output
# 2. terminal-raw.log contains raw output
# 3. terminal.jsonl has structured entries
# 4. ANSI codes are properly stripped in clean log
# 5. Timestamps are added correctly
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  🧪 Real Integration Test for Enhanced Logging${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Check if cursor-agent is available
if ! command -v cursor-agent &> /dev/null; then
    echo -e "${RED}❌ cursor-agent not found. Please install it first.${NC}"
    echo "   npm install -g @anthropic-ai/claude-code"
    exit 1
fi

# Check cursor-agent auth
echo -e "${YELLOW}Checking cursor-agent authentication...${NC}"
if ! cursor-agent create-chat &> /dev/null; then
    echo -e "${RED}❌ cursor-agent authentication failed.${NC}"
    echo "   Please sign in to Cursor IDE first."
    exit 1
fi
echo -e "${GREEN}✓ cursor-agent authenticated${NC}"

# Setup test directory
TEST_DIR="$PROJECT_ROOT/_cursorflow/test-real-logging"
TASKS_DIR="$TEST_DIR/tasks"
LOGS_DIR="$TEST_DIR/logs"

echo ""
echo -e "${YELLOW}Setting up test environment...${NC}"

# Clean previous test
rm -rf "$TEST_DIR"
mkdir -p "$TASKS_DIR"
mkdir -p "$LOGS_DIR"

# Create a simple test task
# This task should complete quickly (just echo something)
cat > "$TASKS_DIR/logging-test.json" << 'EOF'
{
  "baseBranch": "main",
  "branchPrefix": "test/logging-",
  "timeout": 60000,
  "dependencyPolicy": {
    "allowDependencyChange": false,
    "lockfileReadOnly": true
  },
  "tasks": [
    {
      "name": "simple-echo",
      "prompt": "Please just respond with 'Hello from cursor-agent! The logging test is working.' and nothing else. Do not make any file changes.",
      "model": "sonnet-4.5"
    }
  ]
}
EOF

echo -e "${GREEN}✓ Test task created${NC}"

# Build the project
echo ""
echo -e "${YELLOW}Building project...${NC}"
cd "$PROJECT_ROOT"
npm run build > /dev/null 2>&1
echo -e "${GREEN}✓ Build complete${NC}"

# Run the orchestrator with enhanced logging
echo ""
echo -e "${YELLOW}Running orchestration with enhanced logging...${NC}"
echo -e "${CYAN}This will execute cursor-agent - please wait...${NC}"
echo ""

# Run orchestrator
RUN_DIR="$LOGS_DIR/runs/run-$(date +%s)"
mkdir -p "$RUN_DIR/lanes/logging-test"

# Use node directly to run with enhanced logging config
node -e "
const { spawnLane, waitChild } = require('./dist/core/orchestrator');
const path = require('path');
const fs = require('fs');

const tasksFile = '$TASKS_DIR/logging-test.json';
const laneRunDir = '$RUN_DIR/lanes/logging-test';

console.log('Starting lane with enhanced logging...');

const result = spawnLane({
  laneName: 'logging-test',
  tasksFile: tasksFile,
  laneRunDir: laneRunDir,
  executor: 'cursor-agent',
  startIndex: 0,
  enhancedLogConfig: {
    enabled: true,
    stripAnsi: true,
    addTimestamps: true,
    keepRawLogs: true,
    writeJsonLog: true,
    timestampFormat: 'iso',
  },
});

console.log('Lane spawned, waiting for completion...');
console.log('PID:', result.child.pid);

// Set timeout
const timeout = setTimeout(() => {
  console.log('Timeout reached, killing process...');
  result.child.kill('SIGTERM');
}, 120000); // 2 minute timeout

waitChild(result.child).then((exitCode) => {
  clearTimeout(timeout);
  console.log('');
  console.log('Lane completed with exit code:', exitCode);
  
  // Close log manager
  if (result.logManager) {
    result.logManager.close();
  }
  
  process.exit(exitCode === 0 ? 0 : 1);
}).catch((err) => {
  clearTimeout(timeout);
  console.error('Error:', err);
  process.exit(1);
});
"

EXIT_CODE=$?

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  📋 Verifying Log Files${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

LANE_DIR="$RUN_DIR/lanes/logging-test"
ERRORS=0

# Check terminal.log
if [ -f "$LANE_DIR/terminal.log" ]; then
    SIZE=$(wc -c < "$LANE_DIR/terminal.log")
    echo -e "${GREEN}✓ terminal.log exists (${SIZE} bytes)${NC}"
    
    # Check for ANSI codes in clean log (should NOT be there)
    if grep -qP '\x1b\[' "$LANE_DIR/terminal.log" 2>/dev/null; then
        echo -e "${RED}  ❌ ANSI codes found in clean log (should be stripped)${NC}"
        ERRORS=$((ERRORS + 1))
    else
        echo -e "${GREEN}  ✓ No ANSI codes in clean log${NC}"
    fi
    
    # Check for timestamps
    if grep -qE '\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}' "$LANE_DIR/terminal.log"; then
        echo -e "${GREEN}  ✓ Timestamps present${NC}"
    else
        echo -e "${YELLOW}  ⚠ No ISO timestamps found${NC}"
    fi
    
    # Check for session header
    if grep -q "CursorFlow Session Log" "$LANE_DIR/terminal.log"; then
        echo -e "${GREEN}  ✓ Session header present${NC}"
    else
        echo -e "${RED}  ❌ Session header missing${NC}"
        ERRORS=$((ERRORS + 1))
    fi
else
    echo -e "${RED}❌ terminal.log NOT found${NC}"
    ERRORS=$((ERRORS + 1))
fi

# Check terminal-raw.log
if [ -f "$LANE_DIR/terminal-raw.log" ]; then
    SIZE=$(wc -c < "$LANE_DIR/terminal-raw.log")
    echo -e "${GREEN}✓ terminal-raw.log exists (${SIZE} bytes)${NC}"
else
    echo -e "${RED}❌ terminal-raw.log NOT found${NC}"
    ERRORS=$((ERRORS + 1))
fi

# Check terminal.jsonl
if [ -f "$LANE_DIR/terminal.jsonl" ]; then
    SIZE=$(wc -c < "$LANE_DIR/terminal.jsonl")
    ENTRIES=$(wc -l < "$LANE_DIR/terminal.jsonl")
    echo -e "${GREEN}✓ terminal.jsonl exists (${SIZE} bytes, ${ENTRIES} entries)${NC}"
    
    # Check JSON validity
    if head -1 "$LANE_DIR/terminal.jsonl" | jq . > /dev/null 2>&1; then
        echo -e "${GREEN}  ✓ Valid JSON format${NC}"
    else
        echo -e "${RED}  ❌ Invalid JSON format${NC}"
        ERRORS=$((ERRORS + 1))
    fi
    
    # Check for required fields
    if head -1 "$LANE_DIR/terminal.jsonl" | jq -e '.timestamp and .level and .message' > /dev/null 2>&1; then
        echo -e "${GREEN}  ✓ Required fields present (timestamp, level, message)${NC}"
    else
        echo -e "${RED}  ❌ Missing required fields${NC}"
        ERRORS=$((ERRORS + 1))
    fi
else
    echo -e "${RED}❌ terminal.jsonl NOT found${NC}"
    ERRORS=$((ERRORS + 1))
fi

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  📝 Log Content Preview${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo -e "${YELLOW}terminal.log (first 30 lines):${NC}"
echo "─────────────────────────────────────────────────────────"
if [ -f "$LANE_DIR/terminal.log" ]; then
    head -30 "$LANE_DIR/terminal.log"
fi
echo "─────────────────────────────────────────────────────────"

echo ""
echo -e "${YELLOW}terminal.jsonl (first 5 entries):${NC}"
echo "─────────────────────────────────────────────────────────"
if [ -f "$LANE_DIR/terminal.jsonl" ]; then
    head -5 "$LANE_DIR/terminal.jsonl" | jq -c '.'
fi
echo "─────────────────────────────────────────────────────────"

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Test the logs CLI command
echo ""
echo -e "${YELLOW}Testing 'cursorflow logs' command...${NC}"
echo ""

node dist/cli/index.js logs "$RUN_DIR" 2>&1 || true

echo ""
node dist/cli/index.js logs "$RUN_DIR" --lane logging-test --tail 20 2>&1 || true

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  📊 Test Summary${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

if [ $ERRORS -eq 0 ] && [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed!${NC}"
    echo ""
    echo "Log files are at: $LANE_DIR"
    exit 0
elif [ $EXIT_CODE -ne 0 ]; then
    echo -e "${YELLOW}⚠️  cursor-agent execution had issues (exit code: $EXIT_CODE)${NC}"
    echo -e "${YELLOW}   This might be expected if auth or network issues occurred.${NC}"
    echo -e "${YELLOW}   Check if log files were still created correctly.${NC}"
    echo ""
    echo "Log files are at: $LANE_DIR"
    exit 1
else
    echo -e "${RED}❌ $ERRORS error(s) found in logging verification${NC}"
    echo ""
    echo "Log files are at: $LANE_DIR"
    exit 1
fi


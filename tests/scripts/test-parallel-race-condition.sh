#!/bin/bash
# tests/scripts/test-parallel-race-condition.sh
# 
# Test for parallel worktree race condition

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_ROOT="$PROJECT_ROOT/_race_test"
CLI_BIN="$PROJECT_ROOT/dist/cli/index.js"

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  🧪 Parallel Race Condition Test${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Setup Directories
echo -e "${YELLOW}Setting up temporary repository at $TEST_ROOT...${NC}"
rm -rf "$TEST_ROOT"
mkdir -p "$TEST_ROOT"
cd "$TEST_ROOT"

# Init Git
git init > /dev/null
echo "# Race Test Project" > README.md
cat > package.json << 'EOF'
{
  "name": "race-test-project",
  "version": "1.0.0"
}
EOF
touch .cursorignore
git add README.md package.json .cursorignore
git commit -m "initial commit" > /dev/null
git branch -m main > /dev/null 2>&1 || true

# Init CursorFlow
shopt -s expand_aliases
alias cursorflow="node $CLI_BIN"
cursorflow init --yes > /dev/null

# Define 2 Parallel Lanes
echo -e "${YELLOW}Defining 2 parallel lanes with no dependencies...${NC}"
mkdir -p _cursorflow/tasks

cat > _cursorflow/tasks/lane-A.json << 'EOF'
{
  "name": "lane-A",
  "tasks": [
    {
      "name": "task-A",
      "prompt": "Create file-A.txt",
      "model": "sonnet-4.5"
    }
  ],
  "dependencyPolicy": { "allowDependencyChange": false, "lockfileReadOnly": true }
}
EOF

cat > _cursorflow/tasks/lane-B.json << 'EOF'
{
  "name": "lane-B",
  "tasks": [
    {
      "name": "task-B",
      "prompt": "Create file-B.txt",
      "model": "sonnet-4.5"
    }
  ],
  "dependencyPolicy": { "allowDependencyChange": false, "lockfileReadOnly": true }
}
EOF

# Run Orchestration with max-concurrent 2
echo -e "${YELLOW}Running orchestration with --max-concurrent 2...${NC}"
RUN_EXIT_CODE=0
# We use --dry-run or mock the execution if we don't want to actually call cursor-agent
# But the user wants to see it fail like in real life.
# The error happens during worktree creation which is BEFORE cursor-agent call.
# So even with a failing agent, we should see the worktree conflict if it exists.

cursorflow run _cursorflow/tasks --skip-doctor --max-concurrent 2 || RUN_EXIT_CODE=$?

if [ $RUN_EXIT_CODE -ne 0 ]; then
    echo -e "${RED}❌ Orchestration FAILED with exit code $RUN_EXIT_CODE${NC}"
    # Check logs for "already exists" error
    if grep -r "already exists" _cursorflow/logs/runs/latest/lanes/ 2>/dev/null; then
        echo -e "${RED}🚨 Found 'already exists' error in logs! Race condition confirmed.${NC}"
    fi
else
    echo -e "${GREEN}✓ Orchestration finished successfully${NC}"
fi

# Cleanup
# rm -rf "$TEST_ROOT"


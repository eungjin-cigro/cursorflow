#!/bin/bash
# tests/scripts/test-comprehensive-lifecycle.sh
# 
# Comprehensive Lifecycle Integration Test for CursorFlow
# Based on docs/test-plans/comprehensive-lifecycle-test.md
#
# This script performs a real-world test by:
# 1. Creating a temporary Git repository
# 2. Initializing CursorFlow
# 3. Defining a complex lane graph (Sequential, Parallel, Failing)
# 4. Running orchestration with background monitoring
# 5. Verifying results, logs, and Git history
# 6. Testing resumption (optional/next step)
# 7. Cleaning up all resources

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Parse arguments
CLEANUP=true
NO_GIT=false
VERBOSE=false
for arg in "$@"; do
    if [ "$arg" == "--no-cleanup" ]; then
        CLEANUP=false
    fi
    if [ "$arg" == "--no-git" ]; then
        NO_GIT=true
    fi
    if [ "$arg" == "--verbose" ]; then
        VERBOSE=true
    fi
done

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  🧪 Comprehensive Lifecycle Integration Test${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Prerequisites Check
echo -e "${YELLOW}Checking prerequisites...${NC}"
if ! command -v cursor-agent &> /dev/null; then
    echo -e "${RED}❌ cursor-agent CLI not found. Please install it first.${NC}"
    exit 1
fi

if ! cursor-agent create-chat &> /dev/null; then
    echo -e "${RED}❌ cursor-agent authentication failed.${NC}"
    echo "   Please sign in to Cursor IDE first."
    exit 1
fi
echo -e "${GREEN}✓ Prerequisites OK${NC}"

# Setup Directories
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_ROOT="$PROJECT_ROOT/_comprehensive_test"
CLI_BIN="$PROJECT_ROOT/dist/cli/index.js"

echo -e "${YELLOW}Setting up temporary repository at $TEST_ROOT...${NC}"
rm -rf "$TEST_ROOT"
mkdir -p "$TEST_ROOT"
cd "$TEST_ROOT"

# Init Git
git init > /dev/null
echo "# Comprehensive Test Project" > README.md

# Dummy package.json
cat > package.json << 'EOF'
{
  "name": "comprehensive-test-project",
  "version": "1.0.0"
}
EOF

touch .cursorignore
git add README.md package.json .cursorignore
git commit -m "initial commit" > /dev/null
git branch -m main > /dev/null 2>&1 || true

git config user.email "test@cursorflow.com"
git config user.name "CursorFlow Comprehensive Test"

echo -e "${GREEN}✓ Git repository initialized${NC}"

# Build CursorFlow
echo -e "${YELLOW}Building CursorFlow...${NC}"
cd "$PROJECT_ROOT"
npm run build > /dev/null
cd "$TEST_ROOT"
echo -e "${GREEN}✓ Build complete${NC}"

# Create an alias for cursorflow
shopt -s expand_aliases
alias cursorflow="node $CLI_BIN"

# Init CursorFlow
echo -e "${YELLOW}Initializing CursorFlow...${NC}"
cursorflow init --yes > /dev/null
echo -e "${GREEN}✓ CursorFlow initialized${NC}"

# Phase 1: Validation (Doctor Check)
echo -e "${YELLOW}Phase 1: Validation tests...${NC}"

# 1. Circular Dependencies
echo -e "${YELLOW}Testing Doctor with circular dependencies...${NC}"
mkdir -p _cursorflow/temp_validation
cat > _cursorflow/temp_validation/lane-cycle-1.json << 'EOF'
{ "name": "lane-cycle-1", "dependsOn": ["lane-cycle-2"], "tasks": [{ "name": "t1", "prompt": "..." }], "dependencyPolicy": { "allowDependencyChange": false, "lockfileReadOnly": false } }
EOF
cat > _cursorflow/temp_validation/lane-cycle-2.json << 'EOF'
{ "name": "lane-cycle-2", "dependsOn": ["lane-cycle-1"], "tasks": [{ "name": "t1", "prompt": "..." }], "dependencyPolicy": { "allowDependencyChange": false, "lockfileReadOnly": false } }
EOF

if cursorflow doctor --tasks-dir _cursorflow/temp_validation 2>&1 | grep -q "Circular dependency detected"; then
    echo -e "${GREEN}✓ Doctor correctly detected circular dependency${NC}"
else
    echo -e "${RED}❌ Doctor FAILED to detect circular dependency${NC}"
fi

# 2. Duplicate Task Names
echo -e "${YELLOW}Testing Doctor with duplicate task names...${NC}"
cat > _cursorflow/temp_validation/lane-dupe.json << 'EOF'
{ 
  "name": "lane-dupe", 
  "tasks": [
    { "name": "same-name", "prompt": "..." },
    { "name": "same-name", "prompt": "..." }
  ],
  "dependencyPolicy": { "allowDependencyChange": false, "lockfileReadOnly": false }
}
EOF

if cursorflow doctor --tasks-dir _cursorflow/temp_validation 2>&1 | grep -q "Duplicate task name"; then
    echo -e "${GREEN}✓ Doctor correctly detected duplicate task names${NC}"
else
    echo -e "${RED}❌ Doctor FAILED to detect duplicate task names${NC}"
fi

# 3. Duplicate Pipeline Branch
echo -e "${YELLOW}Testing Doctor with duplicate pipeline branches...${NC}"
cat > _cursorflow/temp_validation/lane-pipe-1.json << 'EOF'
{ "name": "lane-pipe-1", "pipelineBranch": "collision-branch", "tasks": [{ "name": "t1", "prompt": "..." }], "dependencyPolicy": { "allowDependencyChange": false, "lockfileReadOnly": false } }
EOF
cat > _cursorflow/temp_validation/lane-pipe-2.json << 'EOF'
{ "name": "lane-pipe-2", "pipelineBranch": "collision-branch", "tasks": [{ "name": "t1", "prompt": "..." }], "dependencyPolicy": { "allowDependencyChange": false, "lockfileReadOnly": false } }
EOF

if cursorflow doctor --tasks-dir _cursorflow/temp_validation 2>&1 | grep -q "Pipeline branch collision"; then
    echo -e "${GREEN}✓ Doctor correctly detected pipeline branch collision${NC}"
else
    echo -e "${RED}❌ Doctor FAILED to detect pipeline branch collision${NC}"
fi

rm -rf _cursorflow/temp_validation
echo -e "${GREEN}✓ Phase 1 validation tests complete${NC}"

# Define Tasks (Phase 2)
echo -e "${YELLOW}Phase 2: Defining comprehensive task graph...${NC}"
mkdir -p _cursorflow/tasks

# Lane A: Independent
cat > _cursorflow/tasks/lane-a.json << 'EOF'
{
  "name": "lane-a",
  "tasks": [
    {
      "name": "task-a1",
      "prompt": "Create 'lane-a.txt' with content 'LANE_A_DATA'. Commit it.",
      "model": "sonnet-4.5"
    }
  ]
}
EOF

# Lane B: Depends on Lane A
cat > _cursorflow/tasks/lane-b.json << 'EOF'
{
  "name": "lane-b",
  "dependsOn": ["lane-a"],
  "tasks": [
    {
      "name": "task-b1",
      "prompt": "Read 'lane-a.txt'. Create 'lane-b.txt' with content 'LANE_B_DATA derived from ' + content of lane-a.txt. Commit it.",
      "model": "sonnet-4.5"
    }
  ]
}
EOF

# Lane C: Depends on Lane B
cat > _cursorflow/tasks/lane-c.json << 'EOF'
{
  "name": "lane-c",
  "dependsOn": ["lane-b"],
  "tasks": [
    {
      "name": "task-c1",
      "prompt": "Read 'lane-b.txt'. Create 'lane-c.txt' with content 'LANE_C_DATA derived from ' + content of lane-b.txt. Commit it.",
      "model": "sonnet-4.5"
    }
  ]
}
EOF

# Lane D: Independent (Parallel with A/B/C)
cat > _cursorflow/tasks/lane-d.json << 'EOF'
{
  "name": "lane-d",
  "tasks": [
    {
      "name": "task-d1",
      "prompt": "Create 'lane-d.txt' with content 'LANE_D_DATA'. Commit it.",
      "model": "sonnet-4.5"
    }
  ]
}
EOF

# Lane E: Designed to fail (Negative Case)
cat > _cursorflow/tasks/lane-e.json << 'EOF'
{
  "name": "lane-e",
  "tasks": [
    {
      "name": "failing-task",
      "prompt": "This task should fail due to timeout.",
      "timeout": 5000
    }
  ]
}
EOF

# Lane F: Dependency Change (Policy Test)
cat > _cursorflow/tasks/lane-f.json << 'EOF'
{
  "name": "lane-f",
  "tasks": [
    {
      "name": "change-dep",
      "prompt": "We need to add a new dependency 'lodash'. Please request a dependency change.",
      "model": "sonnet-4.5"
    }
  ],
  "dependencyPolicy": {
    "allowDependencyChange": false,
    "lockfileReadOnly": true
  }
}
EOF

echo -e "${GREEN}✓ Task graph defined (Lanes A, B, C, D, E, F)${NC}"

# Run Orchestration (Phase 2 & 3)
echo -e "${YELLOW}Running orchestration with background monitoring...${NC}"
MONITOR_LOG="monitor.log"
touch "$MONITOR_LOG"

# Start monitor in background
(
  while true; do
    cursorflow monitor >> "$MONITOR_LOG" 2>&1
    sleep 5
  done
) &
MONITOR_PID=$!

# Run the main orchestration
RUN_EXIT_CODE=0
if [ "$NO_GIT" == "true" ]; then
    cursorflow run _cursorflow/tasks --skip-doctor --no-git || RUN_EXIT_CODE=$?
else
    cursorflow run _cursorflow/tasks --skip-doctor || RUN_EXIT_CODE=$?
fi

# Stop monitor
kill $MONITOR_PID 2>/dev/null || true
echo -e "${GREEN}✓ Orchestration finished (Exit code: $RUN_EXIT_CODE)${NC}"

# Verify Results (Phase 4)
echo -e "${YELLOW}Verifying results and assertions...${NC}"

# 1. Check for expected files in successful lanes
if [ "$NO_GIT" == "true" ]; then
    WORKDIR=$(find _cursorflow/workdir -type d -mindepth 1 | head -n 1 || echo ".")
    echo -e "Checking workdir: $WORKDIR"
    [ -f "$WORKDIR/lane-a.txt" ] && echo -e "${GREEN}✓ lane-a.txt found${NC}" || echo -e "${RED}❌ lane-a.txt missing${NC}"
    [ -f "$WORKDIR/lane-b.txt" ] && echo -e "${GREEN}✓ lane-b.txt found${NC}" || echo -e "${RED}❌ lane-b.txt missing${NC}"
    [ -f "$WORKDIR/lane-c.txt" ] && echo -e "${GREEN}✓ lane-c.txt found${NC}" || echo -e "${RED}❌ lane-c.txt missing${NC}"
    [ -f "$WORKDIR/lane-d.txt" ] && echo -e "${GREEN}✓ lane-d.txt found${NC}" || echo -e "${RED}❌ lane-d.txt missing${NC}"
else
    # Check Lane C branch for full sequential path
    LANEC_BRANCH=$(git branch --list 'cursorflow/lane-c*' | head -n 1 | xargs)
    if [ -n "$LANEC_BRANCH" ]; then
        git checkout "$LANEC_BRANCH" > /dev/null 2>&1
        [ -f "lane-a.txt" ] && [ -f "lane-b.txt" ] && [ -f "lane-c.txt" ] && echo -e "${GREEN}✓ Lane C branch contains all sequential files${NC}" || echo -e "${RED}❌ Lane C branch missing files${NC}"
        git checkout main > /dev/null 2>&1
    else
        echo -e "${RED}❌ Lane C branch not found${NC}"
    fi

    # Check Lane D branch
    LANED_BRANCH=$(git branch --list 'cursorflow/lane-d*' | head -n 1 | xargs)
    if [ -n "$LANED_BRANCH" ]; then
        git checkout "$LANED_BRANCH" > /dev/null 2>&1
        [ -f "lane-d.txt" ] && echo -e "${GREEN}✓ Lane D branch contains lane-d.txt${NC}" || echo -e "${RED}❌ Lane D branch missing lane-d.txt${NC}"
        git checkout main > /dev/null 2>&1
    fi
fi

# 2. Verify Monitor Log (Phase 3)
if [ -s "$MONITOR_LOG" ]; then
    echo -e "${GREEN}✓ Monitor log captured data${NC}"
    if grep -q "lane-a" "$MONITOR_LOG" && grep -q "lane-b" "$MONITOR_LOG"; then
        echo -e "${GREEN}✓ Monitor log correctly tracked lanes${NC}"
    else
        echo -e "${YELLOW}⚠️  Monitor log missing some lane information${NC}"
    fi
else
    echo -e "${RED}❌ Monitor log is empty${NC}"
fi

# 3. Verify Error Simulation (Phase 2 Negative)
# Lane E should have failed.
RUN_LOGS=$(ls -d _cursorflow/logs/runs/run-* 2>/dev/null | sort -r | head -n 1)
if [ -n "$RUN_LOGS" ]; then
    LANEE_LOG="$RUN_LOGS/lanes/lane-e/terminal-readable.log"
    if [ -f "$LANEE_LOG" ]; then
        echo -e "${GREEN}✓ Lane E (failing) log exists${NC}"
        # Depending on how the agent fails, we might see error messages
    else
        echo -e "${YELLOW}⚠️  Lane E log not found (might not have started or failed early)${NC}"
    fi
fi

# 4. Assertions Engine - Deep Log Check (Phase 4)
echo -e "${YELLOW}Running deep log assertions...${NC}"
if [ -n "$RUN_LOGS" ]; then
    # Lane A
    LANE_A_LOG="$RUN_LOGS/lanes/lane-a/terminal-readable.log"
    if [ -f "$LANE_A_LOG" ]; then
        if grep -q "LANE_A_DATA" "$LANE_A_LOG"; then
            echo -e "${GREEN}✓ Lane A log contains 'LANE_A_DATA'${NC}"
        fi
    fi

    # Lane B
    LANE_B_LOG="$RUN_LOGS/lanes/lane-b/terminal-readable.log"
    if [ -f "$LANE_B_LOG" ]; then
        if grep -q "LANE_A_DATA" "$LANE_B_LOG"; then
            echo -e "${GREEN}✓ Lane B log contains 'LANE_A_DATA' (cross-lane context)${NC}"
        fi
        if grep -q "LANE_B_DATA" "$LANE_B_LOG"; then
            echo -e "${GREEN}✓ Lane B log contains 'LANE_B_DATA'${NC}"
        fi
    fi

    # Lane E
    LANE_E_LOG="$RUN_LOGS/lanes/lane-e/terminal-readable.log"
    if [ -f "$LANE_E_LOG" ]; then
        if grep -q "timed out" "$LANE_E_LOG" || grep -i "error" "$LANE_E_LOG" || [ $RUN_EXIT_CODE -ne 0 ]; then
            echo -e "${GREEN}✓ Lane E correctly identified as failure/timeout${NC}"
        fi
    fi

    # Lane F (Policy Test)
    LANE_F_LOG="$RUN_LOGS/lanes/lane-f/terminal-readable.log"
    if [ -f "$LANE_F_LOG" ]; then
        if grep -q "blocked" "$LANE_F_LOG" || grep -q "DEPENDENCY_CHANGE_REQUIRED" "$LANE_F_LOG" || grep -q "exit=2" "$LANE_F_LOG"; then
            echo -e "${GREEN}✓ Lane F correctly blocked by dependency policy${NC}"
        fi
    fi
fi

# 5. Git History Assertions (Phase 4)
if [ "$NO_GIT" != "true" ]; then
    echo -e "${YELLOW}Verifying Git history...${NC}"
    # Check if we have commits for tasks
    COMMITS=$(git log --oneline | wc -l)
    if [ "$COMMITS" -gt 1 ]; then
        echo -e "${GREEN}✓ Git history contains task commits ($COMMITS total)${NC}"
    else
        echo -e "${RED}❌ Git history is missing task commits${NC}"
    fi
fi

# Phase 3: Resumption (Phase 3)
echo -e "${YELLOW}Phase 3: Resumption test...${NC}"

# Check if Lane E failed as expected
if [ $RUN_EXIT_CODE -ne 0 ]; then
    echo -e "${GREEN}✓ Orchestration failed as expected (Lane E timeout)${NC}"
    
    # Fix Lane E
    echo -e "${YELLOW}Fixing Lane E for resumption...${NC}"
    cat > _cursorflow/tasks/lane-e.json << 'EOF'
{
  "name": "lane-e",
  "tasks": [
    {
      "name": "fixed-task",
      "prompt": "Create 'lane-e-fixed.txt' with content 'FIXED'. Commit it."
    }
  ]
}
EOF

    # Resume
    echo -e "${YELLOW}Running cursorflow resume --all...${NC}"
    cursorflow resume --all --skip-doctor
    
    # Verify Lane E fixed
    if [ "$NO_GIT" == "true" ]; then
        [ -f "$WORKDIR/lane-e-fixed.txt" ] && echo -e "${GREEN}✓ Lane E resumed and finished (lane-e-fixed.txt found)${NC}" || echo -e "${RED}❌ Lane E resumption failed${NC}"
    else
        LANEE_BRANCH=$(git branch --list 'cursorflow/lane-e*' | head -n 1 | xargs)
        if [ -n "$LANEE_BRANCH" ]; then
            git checkout "$LANEE_BRANCH" > /dev/null 2>&1
            [ -f "lane-e-fixed.txt" ] && echo -e "${GREEN}✓ Lane E resumed and finished (lane-e-fixed.txt found on branch)${NC}" || echo -e "${RED}❌ Lane E resumption failed on branch${NC}"
            git checkout main > /dev/null 2>&1
        fi
    fi
else
    echo -e "${RED}❌ Orchestration did NOT fail, Lane E might have unexpectedly succeeded${NC}"
fi

# Cleanup (Phase 5)
if [ "$CLEANUP" = "true" ]; then
    echo -e "${YELLOW}Cleaning up...${NC}"
    cursorflow clean all --include-latest --force > /dev/null 2>&1 || true
    cd "$PROJECT_ROOT"
    rm -rf "$TEST_ROOT"
    echo -e "${GREEN}✓ Cleanup complete${NC}"
fi

echo -e "${GREEN}✅ Comprehensive lifecycle test completed!${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"


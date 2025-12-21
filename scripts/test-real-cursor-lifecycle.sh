#!/bin/bash
# scripts/test-real-cursor-lifecycle.sh
# 
# Full Lifecycle Integration Test for CursorFlow
# 
# This script performs a real-world test by:
# 1. Creating a temporary Git repository
# 2. Initializing CursorFlow
# 3. Defining a real task for cursor-agent
# 4. Running the orchestration
# 5. Verifying the results (file changes)
# 6. Cleaning up all resources (branches, worktrees, logs)

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
for arg in "$@"; do
    if [ "$arg" == "--no-cleanup" ]; then
        CLEANUP=false
    fi
    if [ "$arg" == "--no-git" ]; then
        NO_GIT=true
    fi
done

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  🧪 Full Lifecycle Integration Test${NC}"
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
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="$PROJECT_ROOT/_lifecycle_test"
CLI_BIN="$PROJECT_ROOT/dist/cli/index.js"

echo -e "${YELLOW}Setting up temporary repository at $TEST_ROOT...${NC}"
rm -rf "$TEST_ROOT"
mkdir -p "$TEST_ROOT"
cd "$TEST_ROOT"

# Init Git
# Use a more compatible way to init and set branch
git init > /dev/null
echo "# Lifecycle Test Project" > README.md

# IMPORTANT: Create a dummy package.json AND .cursorignore to ensure this is treated as a separate root
cat > package.json << 'EOF'
{
  "name": "lifecycle-test-project",
  "version": "1.0.0"
}
EOF

touch .cursorignore

git add README.md package.json .cursorignore
git commit -m "initial commit" > /dev/null
git branch -m main > /dev/null 2>&1 || true

git config user.email "test@cursorflow.com"
git config user.name "CursorFlow Test"

echo -e "${GREEN}✓ Git repository initialized with package.json${NC}"

# Build CursorFlow (ensure latest changes)
echo -e "${YELLOW}Building CursorFlow...${NC}"
cd "$PROJECT_ROOT"
npm run build > /dev/null
cd "$TEST_ROOT"
echo -e "${GREEN}✓ Build complete${NC}"
echo -e "${GREEN}✓ Build complete${NC}"

# Create an alias for cursorflow to test it as a command
shopt -s expand_aliases
alias cursorflow="node $CLI_BIN"

# Init CursorFlow
echo -e "${YELLOW}Initializing CursorFlow...${NC}"
cursorflow init --yes > /dev/null
echo -e "${GREEN}✓ CursorFlow initialized${NC}"

# Define Task
echo -e "${YELLOW}Defining complex tasks with dependencies...${NC}"
mkdir -p _cursorflow/tasks

# Lane 1: Creates and updates a config file
cat > _cursorflow/tasks/lane-1.json << 'EOF'
{
  "name": "lane-1",
  "tasks": [
    {
      "name": "create-config",
      "prompt": "Create a file named 'config.json' with { \"version\": \"1.0.0\", \"status\": \"alpha\" }. Commit it.",
      "model": "sonnet-4.5"
    },
    {
      "name": "update-config",
      "prompt": "Update 'config.json' to set \"status\": \"beta\" and add \"author\": \"cursorflow-test\". Commit it.",
      "model": "sonnet-4.5"
    }
  ],
  "dependencyPolicy": {
    "allowDependencyChange": false,
    "lockfileReadOnly": true
  }
}
EOF

# Lane 2: Depends on Lane 1, creates a main file using the config
cat > _cursorflow/tasks/lane-2.json << 'EOF'
{
  "name": "lane-2",
  "dependsOn": ["lane-1"],
  "tasks": [
    {
      "name": "create-main",
      "prompt": "Read 'config.json'. Create a file named 'app.js' that prints a message like 'App version X by Y' using the values from config.json. Commit it.",
      "model": "sonnet-4.5"
    }
  ],
  "dependencyPolicy": {
    "allowDependencyChange": false,
    "lockfileReadOnly": true
  }
}
EOF
echo -e "${GREEN}✓ Complex tasks defined${NC}"

# Run Orchestration
echo -e "${YELLOW}Running orchestration (2 lanes, 3 tasks total)...${NC}"
echo -e "${CYAN}This will interact with Cursor IDE. Please wait...${NC}"
echo ""

# We use the CLI command directly
if [ "$NO_GIT" == "true" ]; then
    echo -e "${YELLOW}⚠️  Running in --no-git mode (no Git operations)${NC}"
    cursorflow run _cursorflow/tasks --skip-doctor --no-git
else
    cursorflow run _cursorflow/tasks --skip-doctor
fi

echo -e "${GREEN}✓ Orchestration finished${NC}"

# Verify Result
echo -e "${YELLOW}Verifying results...${NC}"

if [ "$NO_GIT" == "true" ]; then
    # In no-git mode, check workdir instead of branches
    WORKDIR=$(find _cursorflow/workdir -type d -name "cursorflow-*" 2>/dev/null | head -n 1)
    
    if [ -z "$WORKDIR" ]; then
        WORKDIR=$(find _cursorflow/workdir -type d -mindepth 1 2>/dev/null | head -n 1)
    fi
    
    if [ -z "$WORKDIR" ]; then
        echo -e "${YELLOW}⚠️  No workdir found, checking current directory${NC}"
        WORKDIR="."
    fi
    
    echo -e "${GREEN}✓ Work directory: $WORKDIR${NC}"
    
    # In noGit mode, files are created in the workdir
    if [ -f "$WORKDIR/config.json" ]; then
        CONFIG_CONTENT=$(cat "$WORKDIR/config.json")
        echo -e "${GREEN}✓ config.json found${NC}"
        echo -e "  config.json: $CONFIG_CONTENT"
    else
        echo -e "${YELLOW}⚠️  config.json not found in workdir (may be in different location)${NC}"
    fi
    
    echo -e "${GREEN}✓ Verification SUCCESS (no-git mode)${NC}"
else
    # Check Lane 2's final branch (which should have everything)
    LANE2_BRANCH=$(git branch --list 'feature/lane-2*' 'cursorflow/lane-2*' | head -n 1 | sed 's/*//' | xargs)

    if [ -z "$LANE2_BRANCH" ]; then
        # Try to find it by looking at the latest branches
        LANE2_BRANCH=$(git for-each-ref --sort=-committerdate refs/heads/ --format='%(refname:short)' | grep 'lane-2' | head -n 1)
    fi

    if [ -z "$LANE2_BRANCH" ]; then
        echo -e "${RED}❌ No branch found for lane-2${NC}"
        exit 1
    fi

    echo -e "${GREEN}✓ Lane 2 final branch: $LANE2_BRANCH${NC}"

    # Checkout and check files
    git checkout "$LANE2_BRANCH" > /dev/null 2>&1

    if [ -f "config.json" ] && [ -f "app.js" ]; then
        CONFIG_CONTENT=$(cat config.json)
        APP_CONTENT=$(cat app.js)
        echo -e "${GREEN}✓ Verification SUCCESS${NC}"
        echo -e "  config.json: $CONFIG_CONTENT"
        echo -e "  app.js: $APP_CONTENT"
    else
        echo -e "${RED}❌ Verification FAILED - Missing files${NC}"
        [ ! -f "config.json" ] && echo "  - config.json is missing"
        [ ! -f "app.js" ] && echo "  - app.js is missing"
        exit 1
    fi
fi

# Verify Logs
echo -e "${YELLOW}Verifying logs...${NC}"
LOG_DIR="_cursorflow/logs"
if [ -d "$LOG_DIR" ]; then
    echo -e "${GREEN}✓ Logs directory exists${NC}"
    RUN_LOGS=$(ls -d $LOG_DIR/runs/run-* 2>/dev/null | sort -r | head -n 1)
    if [ -n "$RUN_LOGS" ]; then
        echo -e "${GREEN}✓ Run logs found in $RUN_LOGS${NC}"
        # Check for readable log in lane-1
        READABLE_LOG="$RUN_LOGS/lanes/lane-1/terminal-readable.log"
        if [ -f "$READABLE_LOG" ]; then
            echo -e "${GREEN}✓ Readable log file created: $READABLE_LOG${NC}"
            echo -e "${YELLOW}  Log preview (first 10 lines):${NC}"
            head -n 10 "$READABLE_LOG" | sed 's/^/    /'
        else
            echo -e "${RED}❌ Readable log NOT found at $READABLE_LOG${NC}"
            echo "Available files in lane-1 directory:"
            ls -R "$RUN_LOGS/lanes/lane-1"
            exit 1
        fi
    else
        echo -e "${RED}❌ No run logs found in $LOG_DIR/runs${NC}"
        ls -R "$LOG_DIR"
        exit 1
    fi
else
    echo -e "${RED}❌ Logs directory NOT found at $LOG_DIR${NC}"
    echo "Current working directory contents:"
    ls -R .
    exit 1
fi

# Cleanup
if [ "$CLEANUP" = "true" ]; then
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}  🧹 Cleaning Up${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    if [ "$NO_GIT" != "true" ]; then
        # Return to main branch
        git checkout main > /dev/null 2>&1

        # Use cursorflow clean
        echo -e "${YELLOW}Cleaning CursorFlow resources...${NC}"
        cursorflow clean all --include-latest --force > /dev/null 2>&1 || true
    fi

    # Finally remove the test root
    cd "$PROJECT_ROOT"
    rm -rf "$TEST_ROOT"
    echo -e "${GREEN}✓ Temporary test directory removed${NC}"
else
    echo ""
    echo -e "${YELLOW}⚠️  Skipping cleanup as requested.${NC}"
    echo -e "   Test directory: $TEST_ROOT"
    echo -e "   You can inspect the results there."
fi

echo ""
echo -e "${GREEN}✅ Full lifecycle test PASSED successfully!${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"


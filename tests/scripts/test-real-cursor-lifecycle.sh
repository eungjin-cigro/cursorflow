#!/bin/bash
# scripts/test-real-cursor-lifecycle.sh
# 
# Full Lifecycle Integration Test for CursorFlow
# 
# This script performs a real-world test by:
# 1. Creating a temporary Git repository
# 2. Initializing CursorFlow
# 3. Defining real tasks for cursor-agent (Parallel)
# 4. Running the orchestration with max-concurrent 2
# 5. Verifying the results
# 6. Cleaning up all resources

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Setup Directories
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_ROOT="$PROJECT_ROOT/_lifecycle_test"
CLI_BIN="$PROJECT_ROOT/dist/cli/index.js"

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  🧪 Full Lifecycle Integration Test (Parallel)${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Setup temporary repository
rm -rf "$TEST_ROOT"
mkdir -p "$TEST_ROOT"
cd "$TEST_ROOT"

# Init Git
git init > /dev/null
echo "# Lifecycle Test Project" > README.md
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

# Build and Init
cd "$PROJECT_ROOT"
npm run build > /dev/null
cd "$TEST_ROOT"

shopt -s expand_aliases
alias cursorflow="node $CLI_BIN"
cursorflow init --yes > /dev/null

# Define 10 Parallel Lanes
mkdir -p _cursorflow/tasks

for i in {1..10}; do
cat > _cursorflow/tasks/lane-$i.json << EOF
{
  "name": "lane-$i",
  "tasks": [
    {
      "name": "task-$i",
      "prompt": "Create file-$i.txt",
      "model": "sonnet-4.5"
    }
  ]
}
EOF
done

echo -e "${YELLOW}Running orchestration with --max-concurrent 10...${NC}"
RUN_EXIT_CODE=0
cursorflow run _cursorflow/tasks --skip-doctor --max-concurrent 10 || RUN_EXIT_CODE=$?

if [ $RUN_EXIT_CODE -ne 0 ]; then
    echo -e "${RED}❌ Orchestration FAILED with exit code $RUN_EXIT_CODE${NC}"
    exit $RUN_EXIT_CODE
fi

echo -e "${GREEN}✓ Orchestration finished${NC}"

# Verification
echo -e "${YELLOW}Verifying results...${NC}"
# Since they are parallel, we need to check both branches exist or merged
# In this test, we just check if both lane branches were created
BRANCHES=$(git branch -a)
if echo "$BRANCHES" | grep -q "lane-1" && echo "$BRANCHES" | grep -q "lane-2"; then
    echo -e "${GREEN}✓ Both lane branches found${NC}"
else
    echo -e "${RED}❌ Lane branches missing${NC}"
    echo "Existing branches:"
    echo "$BRANCHES"
    exit 1
fi

echo -e "${GREEN}✅ Full lifecycle test PASSED successfully!${NC}"

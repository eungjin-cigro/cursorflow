#!/bin/bash
# tests/scripts/test-templates.sh
# 
# Test template loading features

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_ROOT="$PROJECT_ROOT/_template_test"
CLI_BIN="$PROJECT_ROOT/dist/cli/index.js"

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  🧪 Template Loading Test${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Setup Directories
echo -e "${YELLOW}Setting up temporary repository at $TEST_ROOT...${NC}"
rm -rf "$TEST_ROOT"
mkdir -p "$TEST_ROOT"
cd "$TEST_ROOT"

# Init Git
git init > /dev/null
echo "# Template Test Project" > README.md
cat > package.json << 'EOF'
{
  "name": "template-test-project",
  "version": "1.0.0"
}
EOF
git add README.md package.json
git commit -m "initial commit" > /dev/null

# Build CursorFlow
echo -e "${YELLOW}Building CursorFlow...${NC}"
cd "$PROJECT_ROOT"
npm run build > /dev/null
cd "$TEST_ROOT"

shopt -s expand_aliases
alias cursorflow="node $CLI_BIN"

# 1. Test local template file
echo -e "${YELLOW}Testing local template file...${NC}"
cat > my-template.json << 'EOF'
{
  "name": "local-custom",
  "tasks": [
    { "name": "custom-task", "prompt": "Custom prompt for {{featureName}}" }
  ]
}
EOF

rm -rf _cursorflow/tasks/
cursorflow prepare LocalTest --template my-template.json --force > /dev/null
TASK_FILE=$(find _cursorflow/tasks/*/01-lane-1.json)
if [ -f "$TASK_FILE" ] && grep -q "Custom prompt for LocalTest" "$TASK_FILE"; then
    echo -e "${GREEN}✓ Local template file SUCCESS${NC}"
else
    echo -e "${RED}❌ Local template file FAILED${NC}"
    [ ! -f "$TASK_FILE" ] && echo "  - Task file not found"
    [ -f "$TASK_FILE" ] && echo "  - Content: $(cat $TASK_FILE)"
    exit 1
fi

# 2. Test built-in template name
echo -e "${YELLOW}Testing built-in template name...${NC}"
rm -rf _cursorflow/tasks/
cursorflow prepare BuiltInTest --template basic --force > /dev/null
TASK_FILE=$(find _cursorflow/tasks/*/01-lane-1.json)
if [ -f "$TASK_FILE" ] && grep -q "Analyze requirements for BuiltInTest" "$TASK_FILE"; then
    echo -e "${GREEN}✓ Built-in template SUCCESS${NC}"
else
    echo -e "${RED}❌ Built-in template FAILED${NC}"
    [ ! -f "$TASK_FILE" ] && echo "  - Task file not found"
    [ -f "$TASK_FILE" ] && echo "  - Content: $(cat $TASK_FILE)"
    exit 1
fi

echo -e "${GREEN}✅ All template tests PASSED!${NC}"


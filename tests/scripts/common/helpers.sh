#!/bin/bash
# tests/scripts/common/helpers.sh
#
# Shared utility functions for all test modules
#

# Strict mode
set -o pipefail

# Colors
export RED='\033[0;31m'
export GREEN='\033[0;32m'
export YELLOW='\033[1;33m'
export CYAN='\033[0;36m'
export MAGENTA='\033[0;35m'
export BLUE='\033[0;34m'
export BOLD='\033[1m'
export DIM='\033[2m'
export NC='\033[0m' # No Color

# Paths
export SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PROJECT_ROOT="$(cd "$SCRIPTS_DIR/../.." && pwd)"
export CLI_BIN="$PROJECT_ROOT/dist/cli/index.js"

# Test counters
export TESTS_PASSED=0
export TESTS_FAILED=0
export TESTS_SKIPPED=0
export CURRENT_MODULE=""

# ============================================================================
# Logging Functions
# ============================================================================

log_header() {
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}  $1${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

log_module() {
    CURRENT_MODULE="$1"
    echo ""
    echo -e "${BLUE}╔══════════════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║${NC} ${BOLD}📦 Module: $1${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

log_phase() {
    echo ""
    echo -e "${MAGENTA}┌──────────────────────────────────────────────────────────────────────────────┐${NC}"
    echo -e "${MAGENTA}│${NC} ${BOLD}$1${NC}"
    echo -e "${MAGENTA}└──────────────────────────────────────────────────────────────────────────────┘${NC}"
    echo ""
}

log_test() {
    echo -e "${DIM}  ├─ Testing: $1...${NC}"
}

log_success() {
    echo -e "${GREEN}  │  ✓ $1${NC}"
}

log_fail() {
    echo -e "${RED}  │  ✗ $1${NC}"
}

log_warn() {
    echo -e "${YELLOW}  │  ⚠ $1${NC}"
}

log_skip() {
    echo -e "${DIM}  │  ○ SKIP: $1${NC}"
}

log_info() {
    echo -e "${DIM}  │  ℹ $1${NC}"
}

# ============================================================================
# Test Recording Functions
# ============================================================================

record_pass() {
    TESTS_PASSED=$((TESTS_PASSED + 1))
    log_success "$1"
}

record_fail() {
    TESTS_FAILED=$((TESTS_FAILED + 1))
    log_fail "$1"
}

record_skip() {
    TESTS_SKIPPED=$((TESTS_SKIPPED + 1))
    log_skip "$1"
}

# ============================================================================
# Test Assertions
# ============================================================================

assert_eq() {
    local expected="$1"
    local actual="$2"
    local msg="${3:-Values should be equal}"
    if [ "$expected" = "$actual" ]; then
        record_pass "$msg"
        return 0
    else
        record_fail "$msg (expected: '$expected', got: '$actual')"
        return 1
    fi
}

assert_contains() {
    local haystack="$1"
    local needle="$2"
    local msg="${3:-Should contain expected string}"
    if echo "$haystack" | grep -q "$needle"; then
        record_pass "$msg"
        return 0
    else
        record_fail "$msg (expected to contain: '$needle')"
        return 1
    fi
}

assert_not_contains() {
    local haystack="$1"
    local needle="$2"
    local msg="${3:-Should not contain string}"
    if ! echo "$haystack" | grep -q "$needle"; then
        record_pass "$msg"
        return 0
    else
        record_fail "$msg (should not contain: '$needle')"
        return 1
    fi
}

assert_file_exists() {
    local file="$1"
    local msg="${2:-File should exist}"
    if [ -f "$file" ]; then
        record_pass "$msg"
        return 0
    else
        record_fail "$msg ($file not found)"
        return 1
    fi
}

assert_dir_exists() {
    local dir="$1"
    local msg="${2:-Directory should exist}"
    if [ -d "$dir" ]; then
        record_pass "$msg"
        return 0
    else
        record_fail "$msg ($dir not found)"
        return 1
    fi
}

assert_exit_code() {
    local expected="$1"
    local actual="$2"
    local msg="${3:-Exit code should match}"
    if [ "$expected" -eq "$actual" ]; then
        record_pass "$msg"
        return 0
    else
        record_fail "$msg (expected exit $expected, got $actual)"
        return 1
    fi
}

assert_command_succeeds() {
    local msg="$1"
    shift
    if "$@" > /dev/null 2>&1; then
        record_pass "$msg"
        return 0
    else
        record_fail "$msg"
        return 1
    fi
}

assert_command_fails() {
    local msg="$1"
    shift
    if ! "$@" > /dev/null 2>&1; then
        record_pass "$msg"
        return 0
    else
        record_fail "$msg (should have failed)"
        return 1
    fi
}

# ============================================================================
# Environment Setup
# ============================================================================

setup_test_repo() {
    local test_root="${1:-$PROJECT_ROOT/_test_tmp}"
    
    rm -rf "$test_root"
    mkdir -p "$test_root"
    cd "$test_root"
    
    # Init Git
    git init > /dev/null 2>&1
    git config user.email "test@cursorflow.com"
    git config user.name "CursorFlow Test"
    
    echo "# CursorFlow Test Project" > README.md
    cat > package.json << 'EOF'
{
  "name": "cursorflow-test-project",
  "version": "1.0.0"
}
EOF
    touch .cursorignore
    
    git add README.md package.json .cursorignore
    git commit -m "initial commit" > /dev/null 2>&1
    git branch -m main > /dev/null 2>&1 || true
    
    # Add dummy origin remote for doctor checks
    git remote add origin https://github.com/cursorflow/test-repo.git > /dev/null 2>&1
    
    echo "$test_root"
}

cleanup_test_repo() {
    local test_root="${1:-$PROJECT_ROOT/_test_tmp}"
    
    # Clean up worktrees first
    if [ -d "$test_root" ]; then
        cd "$test_root"
        git worktree list --porcelain 2>/dev/null | grep "^worktree" | grep -v "$test_root\$" | cut -d' ' -f2 | while read wt; do
            git worktree remove "$wt" --force 2>/dev/null || true
        done
    fi
    
    rm -rf "$test_root"
}

# ============================================================================
# CursorFlow Wrapper
# ============================================================================

# Run cursorflow command and capture output/exit code without exiting on error
cursorflow_run() {
    local exit_code=0
    local output
    output=$(node "$CLI_BIN" "$@" 2>&1) || exit_code=$?
    echo "$output"
    return $exit_code
}

# Run cursorflow and capture both stdout and exit code
cursorflow_out() {
    set +e
    node "$CLI_BIN" "$@" 2>&1
    local exit_code=$?
    set -e
    return $exit_code
}

# Check if cursor-agent is available
check_cursor_agent() {
    if command -v cursor-agent &> /dev/null; then
        return 0
    else
        return 1
    fi
}

# Check if cursor-agent is authenticated
check_cursor_agent_auth() {
    if cursor-agent create-chat &> /dev/null; then
        return 0
    else
        return 1
    fi
}

# ============================================================================
# Summary Functions
# ============================================================================

print_module_summary() {
    local module_name="${1:-$CURRENT_MODULE}"
    local total=$((TESTS_PASSED + TESTS_FAILED + TESTS_SKIPPED))
    
    echo ""
    echo -e "${DIM}  ────────────────────────────────────────────────────────────${NC}"
    echo -e "  ${BOLD}Module Summary:${NC} $module_name"
    echo -e "  ${GREEN}Passed: $TESTS_PASSED${NC} | ${RED}Failed: $TESTS_FAILED${NC} | ${DIM}Skipped: $TESTS_SKIPPED${NC} | Total: $total"
    echo ""
    
    if [ $TESTS_FAILED -gt 0 ]; then
        return 1
    fi
    return 0
}

print_final_summary() {
    local total=$((TESTS_PASSED + TESTS_FAILED + TESTS_SKIPPED))
    
    echo ""
    log_header "🏁 Final Test Results"
    echo -e "  ${GREEN}✓ Passed:  $TESTS_PASSED${NC}"
    echo -e "  ${RED}✗ Failed:  $TESTS_FAILED${NC}"
    echo -e "  ${DIM}○ Skipped: $TESTS_SKIPPED${NC}"
    echo -e "  ${BOLD}─────────────${NC}"
    echo -e "  ${BOLD}Total:     $total${NC}"
    echo ""
    
    if [ $TESTS_FAILED -gt 0 ]; then
        echo -e "${RED}❌ Some tests FAILED!${NC}"
        return 1
    else
        echo -e "${GREEN}✅ All tests PASSED!${NC}"
        return 0
    fi
}

reset_counters() {
    TESTS_PASSED=0
    TESTS_FAILED=0
    TESTS_SKIPPED=0
}

# ============================================================================
# Build Check
# ============================================================================

ensure_build() {
    if [ ! -f "$CLI_BIN" ]; then
        echo -e "${YELLOW}Building CursorFlow...${NC}"
        cd "$PROJECT_ROOT"
        npm run build > /dev/null 2>&1
        cd - > /dev/null
    fi
}

# Export functions
export -f log_header log_module log_phase log_test log_success log_fail log_warn log_skip log_info
export -f record_pass record_fail record_skip
export -f assert_eq assert_contains assert_not_contains assert_file_exists assert_dir_exists assert_exit_code
export -f assert_command_succeeds assert_command_fails
export -f setup_test_repo cleanup_test_repo
export -f cursorflow_run cursorflow_out check_cursor_agent check_cursor_agent_auth
export -f print_module_summary print_final_summary reset_counters ensure_build


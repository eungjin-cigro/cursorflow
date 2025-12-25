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

# Git Mock Server
export GIT_MOCK_SERVER_PORT="${GIT_MOCK_SERVER_PORT:-8174}"
export GIT_MOCK_SERVER_ROOT=""
export GIT_MOCK_SERVER_PID=""

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
# Git Mock Server Functions
# ============================================================================

# Start git-http-mock-server for testing git operations
# Usage: start_git_mock_server "/path/to/bare/repos"
start_git_mock_server() {
    local repos_dir="$1"
    
    if [ -z "$repos_dir" ]; then
        echo "Error: repos_dir required for start_git_mock_server" >&2
        return 1
    fi
    
    # Create repos directory if it doesn't exist
    mkdir -p "$repos_dir"
    GIT_MOCK_SERVER_ROOT="$repos_dir"
    
    # Check if git-http-mock-server is available
    local mock_server_bin="$PROJECT_ROOT/node_modules/.bin/git-http-mock-server"
    if [ ! -f "$mock_server_bin" ]; then
        echo "Warning: git-http-mock-server not found at $mock_server_bin" >&2
        return 1
    fi
    
    # Start the mock server in background using daemon mode
    cd "$repos_dir"
    GIT_HTTP_MOCK_SERVER_PORT="$GIT_MOCK_SERVER_PORT" "$mock_server_bin" start > /dev/null 2>&1
    local start_result=$?
    
    if [ $start_result -ne 0 ]; then
        echo "Warning: git-http-mock-server start command failed" >&2
        cd - > /dev/null 2>&1 || true
        return 1
    fi
    
    # Wait for server to be ready by checking if port is listening
    local max_attempts=20
    local attempt=0
    while [ $attempt -lt $max_attempts ]; do
        # Check if port is listening using ss (more reliable on WSL2)
        if ss -tln 2>/dev/null | grep -q ":$GIT_MOCK_SERVER_PORT " || \
           netstat -tln 2>/dev/null | grep -q ":$GIT_MOCK_SERVER_PORT "; then
            # Give server a moment to fully initialize
            sleep 0.5
            break
        fi
        sleep 0.3
        attempt=$((attempt + 1))
    done
    
    cd - > /dev/null 2>&1 || true
    
    if [ $attempt -eq $max_attempts ]; then
        echo "Warning: Git mock server failed to start (timeout)" >&2
        return 1
    fi
    
    return 0
}

# Stop git-http-mock-server
stop_git_mock_server() {
    if [ -n "$GIT_MOCK_SERVER_ROOT" ] && [ -d "$GIT_MOCK_SERVER_ROOT" ]; then
        local mock_server_bin="$PROJECT_ROOT/node_modules/.bin/git-http-mock-server"
        if [ -f "$mock_server_bin" ]; then
            cd "$GIT_MOCK_SERVER_ROOT"
            "$mock_server_bin" stop > /dev/null 2>&1 || true
            cd - > /dev/null
        fi
        
        # Also try to kill by port if daemon stop didn't work
        local pid=$(lsof -ti:$GIT_MOCK_SERVER_PORT 2>/dev/null || true)
        if [ -n "$pid" ]; then
            kill $pid 2>/dev/null || true
        fi
    fi
    GIT_MOCK_SERVER_ROOT=""
}

# Create a bare git repository for mock server
# Usage: create_bare_repo "/path/to/repos" "repo-name"
create_bare_repo() {
    local repos_dir="$1"
    local repo_name="$2"
    
    mkdir -p "$repos_dir"
    local bare_repo="$repos_dir/${repo_name}.git"
    
    # Create bare repo
    git init --bare "$bare_repo" > /dev/null 2>&1
    
    # Enable push for the bare repo
    cd "$bare_repo"
    git config receive.denyCurrentBranch ignore
    cd - > /dev/null
    
    echo "$bare_repo"
}

# Get mock server URL for a repo
# Usage: get_mock_repo_url "repo-name"
get_mock_repo_url() {
    local repo_name="$1"
    echo "http://localhost:$GIT_MOCK_SERVER_PORT/${repo_name}.git"
}

# ============================================================================
# Environment Setup
# ============================================================================

# Setup test repo with local bare git repository
# This creates a working repo and a bare repo that can be used with file:// URL
setup_test_repo() {
    local test_root="${1:-$PROJECT_ROOT/_test_tmp}"
    local use_local_remote="${2:-true}"
    
    rm -rf "$test_root"
    mkdir -p "$test_root"
    
    local repos_dir="$test_root/__bare_repos__"
    local work_dir="$test_root/work"
    
    mkdir -p "$work_dir"
    cd "$work_dir"
    
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
    
    if [ "$use_local_remote" = "true" ]; then
        # Create bare repo for local git operations
        create_bare_repo "$repos_dir" "test-repo" > /dev/null
        
        # Use local file:// URL for remote
        git remote add origin "file://$repos_dir/test-repo.git" > /dev/null 2>&1
        
        # Push initial content to local bare repo
        git push -u origin main > /dev/null 2>&1 || true
    else
        # Use dummy remote (for tests that don't need real git operations)
        git remote add origin https://github.com/cursorflow/test-repo.git > /dev/null 2>&1
    fi
    
    echo "$work_dir"
}

cleanup_test_repo() {
    local test_root="${1:-$PROJECT_ROOT/_test_tmp}"
    
    # Determine actual root (might be work dir or parent)
    local actual_root="$test_root"
    if [[ "$test_root" == */work ]]; then
        actual_root="${test_root%/work}"
    fi
    
    # Clean up worktrees
    if [ -d "$test_root" ]; then
        cd "$test_root"
        git worktree list --porcelain 2>/dev/null | grep "^worktree" | grep -v "$test_root\$" | cut -d' ' -f2 | while read wt; do
            git worktree remove "$wt" --force 2>/dev/null || true
        done
        cd - > /dev/null 2>&1 || true
    fi
    
    rm -rf "$actual_root"
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
export -f start_git_mock_server stop_git_mock_server create_bare_repo get_mock_repo_url
export -f setup_test_repo cleanup_test_repo
export -f cursorflow_run cursorflow_out check_cursor_agent check_cursor_agent_auth
export -f print_module_summary print_final_summary reset_counters ensure_build


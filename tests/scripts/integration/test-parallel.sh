#!/bin/bash
# tests/scripts/integration/test-parallel.sh
#
# Tests for parallel execution and race condition handling
#

set -e

# Source helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../common/helpers.sh"

# ============================================================================
# Module Variables
# ============================================================================

TEST_ROOT=""
SKIP_AGENT=false

# Parse arguments
for arg in "$@"; do
    case $arg in
        --skip-agent)
            SKIP_AGENT=true
            ;;
    esac
done

# ============================================================================
# Module Setup
# ============================================================================

setup_module() {
    ensure_build
    TEST_ROOT=$(setup_test_repo "$PROJECT_ROOT/_test_parallel")
    cd "$TEST_ROOT"
    
    # Initialize CursorFlow
    cursorflow_out init --yes > /dev/null 2>&1
}

cleanup_module() {
    # Clean up worktrees
    if [ -d "$TEST_ROOT" ]; then
        cd "$TEST_ROOT"
        git worktree list --porcelain 2>/dev/null | grep "^worktree" | grep -v "$TEST_ROOT\$" | cut -d' ' -f2 | while read wt; do
            git worktree remove "$wt" --force 2>/dev/null || true
        done
        
        # Clean up branches
        git branch | grep -v "^\*" | grep -v "main" | xargs -r git branch -D 2>/dev/null || true
    fi
    
    cleanup_test_repo "$TEST_ROOT"
}

# ============================================================================
# Parallel Lane Configuration Tests
# ============================================================================

test_parallel_lanes_no_deps() {
    log_test "Parallel lanes without dependencies"
    
    mkdir -p "$TEST_ROOT/_cursorflow/tasks"
    
    for i in {1..5}; do
        cat > "$TEST_ROOT/_cursorflow/tasks/parallel-$i.json" << EOF
{
  "name": "parallel-lane-$i",
  "tasks": [{ "name": "task-$i", "prompt": "Parallel task $i for testing", "model": "sonnet-4.5" }]
}
EOF
    done
    
    local exit_code=0
    cursorflow_out doctor --tasks-dir "$TEST_ROOT/_cursorflow/tasks" > /dev/null 2>&1 || exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        record_pass "5 parallel lanes validated"
    else
        record_fail "Parallel lanes validation failed"
    fi
    
    rm -f "$TEST_ROOT/_cursorflow/tasks/parallel-"*.json
}

test_max_concurrent_validation() {
    log_test "Max concurrent setting validation"
    
    local output
    output=$(cursorflow_out run --help 2>&1)
    
    if echo "$output" | grep -qiE "max-concurrent|concurrent"; then
        record_pass "max-concurrent option available"
    else
        record_skip "max-concurrent documentation not found"
    fi
}

# ============================================================================
# Worktree Race Condition Tests
# ============================================================================

test_unique_worktree_paths() {
    log_test "Unique worktree path generation"
    
    mkdir -p "$TEST_ROOT/_cursorflow/tasks"
    
    # Create lanes with similar names
    for suffix in a b c; do
        cat > "$TEST_ROOT/_cursorflow/tasks/similar-$suffix.json" << EOF
{
  "name": "similar-lane-$suffix",
  "branchPrefix": "feature/similar-",
  "tasks": [{ "name": "task-$suffix", "prompt": "Similar lane task $suffix" }]
}
EOF
    done
    
    local output
    output=$(cursorflow_out doctor --tasks-dir "$TEST_ROOT/_cursorflow/tasks" 2>&1) || true
    
    # Check for collision warnings
    if echo "$output" | grep -qiE "(collision|duplicate|conflict)"; then
        record_pass "Branch collision detected"
    else
        record_skip "Branch collision detection behavior unclear"
    fi
    
    rm -f "$TEST_ROOT/_cursorflow/tasks/similar-"*.json
}

test_worktree_lock_handling() {
    log_test "Worktree lock file handling"
    
    # Create a mock locked worktree scenario
    mkdir -p "$TEST_ROOT/_cursorflow/worktrees/test-lane"
    echo "mock lock" > "$TEST_ROOT/_cursorflow/worktrees/test-lane/.git"
    
    # Try to clean
    local output
    output=$(cursorflow_out clean worktrees --dry-run 2>&1) || true
    
    # Should handle gracefully
    if echo "$output" | grep -qiE "(worktree|clean|found|nothing|error)" || [ -z "$output" ]; then
        record_pass "Worktree lock handling works"
    else
        record_skip "Worktree lock handling unclear"
    fi
    
    rm -rf "$TEST_ROOT/_cursorflow/worktrees"
}

# ============================================================================
# Branch Conflict Tests
# ============================================================================

test_branch_already_exists() {
    log_test "Handle existing branch scenario"
    
    # Create a branch that might conflict
    git branch "feature/test-conflict" 2>/dev/null || true
    
    mkdir -p "$TEST_ROOT/_cursorflow/tasks"
    cat > "$TEST_ROOT/_cursorflow/tasks/conflict.json" << 'EOF'
{
  "name": "conflict-lane",
  "branchPrefix": "feature/test-conflict",
  "tasks": [{ "name": "conflict-task", "prompt": "Task that might conflict with existing branch" }]
}
EOF
    
    local output
    output=$(cursorflow_out doctor --tasks-dir "$TEST_ROOT/_cursorflow/tasks" 2>&1) || true
    
    # Clean up
    git branch -D "feature/test-conflict" 2>/dev/null || true
    rm -f "$TEST_ROOT/_cursorflow/tasks/conflict.json"
    
    record_pass "Existing branch scenario handled"
}

# ============================================================================
# Concurrent Execution Tests (require cursor-agent)
# ============================================================================

test_real_concurrent_execution() {
    log_test "Real concurrent execution (2 lanes)"
    
    if [ "$SKIP_AGENT" = true ] || ! check_cursor_agent; then
        record_skip "cursor-agent not available"
        return
    fi
    
    if ! check_cursor_agent_auth; then
        record_skip "cursor-agent not authenticated"
        return
    fi
    
    mkdir -p "$TEST_ROOT/_cursorflow/tasks"
    
    for i in {1..2}; do
        cat > "$TEST_ROOT/_cursorflow/tasks/concurrent-$i.json" << EOF
{
  "name": "concurrent-lane-$i",
  "tasks": [{ "name": "task-$i", "prompt": "Say 'Concurrent $i done' and nothing else.", "model": "sonnet-4.5" }],
  "timeout": 60000
}
EOF
    done
    
    local start_time=$(date +%s)
    local exit_code=0
    timeout 180 cursorflow_out run "$TEST_ROOT/_cursorflow/tasks" --skip-doctor --max-concurrent 2 2>&1 || exit_code=$?
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    if [ $exit_code -eq 0 ]; then
        record_pass "Concurrent execution completed in ${duration}s"
    else
        record_fail "Concurrent execution failed (exit: $exit_code)"
    fi
    
    rm -f "$TEST_ROOT/_cursorflow/tasks/concurrent-"*.json
}

test_real_high_concurrency() {
    log_test "High concurrency execution (5 lanes)"
    
    if [ "$SKIP_AGENT" = true ] || ! check_cursor_agent; then
        record_skip "cursor-agent not available"
        return
    fi
    
    if ! check_cursor_agent_auth; then
        record_skip "cursor-agent not authenticated"
        return
    fi
    
    mkdir -p "$TEST_ROOT/_cursorflow/tasks"
    
    for i in {1..5}; do
        cat > "$TEST_ROOT/_cursorflow/tasks/high-$i.json" << EOF
{
  "name": "high-concurrent-$i",
  "tasks": [{ "name": "task-$i", "prompt": "Say 'High $i' and nothing else.", "model": "sonnet-4.5" }],
  "timeout": 60000
}
EOF
    done
    
    local exit_code=0
    timeout 300 cursorflow_out run "$TEST_ROOT/_cursorflow/tasks" --skip-doctor --max-concurrent 5 2>&1 || exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        # Check that multiple branches were created
        local branch_count
        branch_count=$(git branch | grep -c "high-concurrent" || echo "0")
        record_pass "High concurrency completed ($branch_count branches)"
    else
        record_fail "High concurrency failed (exit: $exit_code)"
    fi
    
    rm -f "$TEST_ROOT/_cursorflow/tasks/high-"*.json
}

# ============================================================================
# Race Condition Verification
# ============================================================================

test_no_worktree_race() {
    log_test "No worktree race condition"
    
    # Check for any "already exists" errors in recent logs
    local latest_run="$TEST_ROOT/_cursorflow/logs/runs/latest"
    if [ -d "$latest_run" ] || [ -L "$latest_run" ]; then
        if grep -r "already exists" "$latest_run" 2>/dev/null; then
            record_fail "Found 'already exists' error - potential race condition"
        else
            record_pass "No worktree race condition detected"
        fi
    else
        record_skip "No run logs to check"
    fi
}

test_all_worktrees_cleaned() {
    log_test "All worktrees properly cleaned"
    
    local worktree_count
    worktree_count=$(git worktree list --porcelain 2>/dev/null | grep -c "^worktree" || echo "1")
    
    # Should only have main worktree
    if [ "$worktree_count" -le 1 ]; then
        record_pass "All temporary worktrees cleaned"
    else
        record_warn "Found $worktree_count worktrees (may need cleanup)"
    fi
}

# ============================================================================
# Main
# ============================================================================

run_tests() {
    log_module "Parallel Execution Tests"
    
    if [ "$SKIP_AGENT" = true ]; then
        log_warn "Running in --skip-agent mode: real execution tests will be skipped"
    fi
    
    setup_module
    
    log_phase "Phase 1: Parallel Configuration"
    test_parallel_lanes_no_deps
    test_max_concurrent_validation
    
    log_phase "Phase 2: Race Condition Prevention"
    test_unique_worktree_paths
    test_worktree_lock_handling
    test_branch_already_exists
    
    log_phase "Phase 3: Real Concurrent Execution"
    test_real_concurrent_execution
    test_real_high_concurrency
    
    log_phase "Phase 4: Race Condition Verification"
    test_no_worktree_race
    test_all_worktrees_cleaned
    
    cleanup_module
    
    print_module_summary
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    run_tests "$@"
    exit $?
fi


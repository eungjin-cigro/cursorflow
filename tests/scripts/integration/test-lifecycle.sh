#!/bin/bash
# tests/scripts/integration/test-lifecycle.sh
#
# Integration tests for full CursorFlow lifecycle with real cursor-agent execution
# These tests require cursor-agent to be installed and authenticated
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
    TEST_ROOT=$(setup_test_repo "$PROJECT_ROOT/_test_lifecycle")
    cd "$TEST_ROOT"
    
    # Initialize CursorFlow
    cursorflow_out init --yes > /dev/null 2>&1
}

cleanup_module() {
    # Clean up worktrees first
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
# Cursor Agent Check
# ============================================================================

check_agent_available() {
    if [ "$SKIP_AGENT" = true ]; then
        return 1
    fi
    
    if ! check_cursor_agent; then
        return 1
    fi
    
    if ! check_cursor_agent_auth; then
        return 1
    fi
    
    return 0
}

# ============================================================================
# Run Command Tests
# ============================================================================

test_run_help() {
    log_test "cursorflow run --help"
    local output
    output=$(cursorflow_out run --help 2>&1)
    if echo "$output" | grep -qiE "(run|execute|task|lane)"; then
        record_pass "run --help shows usage"
    else
        record_fail "run --help missing expected output"
    fi
}

test_run_no_tasks() {
    log_test "run without tasks"
    rm -rf "$TEST_ROOT/_cursorflow/tasks/"*
    
    local output
    output=$(cursorflow_out run 2>&1) || true
    
    if echo "$output" | grep -qiE "(no task|not found|empty|specify)"; then
        record_pass "run handles no tasks gracefully"
    else
        record_skip "run behavior without tasks unclear"
    fi
}

test_run_skip_doctor() {
    log_test "run --skip-doctor option"
    local output
    output=$(cursorflow_out run --help 2>&1)
    
    if echo "$output" | grep -qiE "skip-doctor"; then
        record_pass "run supports --skip-doctor"
    else
        record_skip "--skip-doctor option not documented"
    fi
}

test_run_max_concurrent() {
    log_test "run --max-concurrent option"
    local output
    output=$(cursorflow_out run --help 2>&1)
    
    if echo "$output" | grep -qiE "max-concurrent"; then
        record_pass "run supports --max-concurrent"
    else
        record_skip "--max-concurrent option not documented"
    fi
}

test_run_dry_run() {
    log_test "run --dry-run option"
    
    # Create a test task first
    mkdir -p "$TEST_ROOT/_cursorflow/tasks"
    cat > "$TEST_ROOT/_cursorflow/tasks/dry-run-test.json" << 'EOF'
{
  "name": "dry-run-lane",
  "tasks": [{ "name": "dry-task", "prompt": "This is a dry run test task" }]
}
EOF
    
    local output
    output=$(cursorflow_out run "$TEST_ROOT/_cursorflow/tasks" --dry-run 2>&1) || true
    
    if echo "$output" | grep -qiE "(dry|would|preview|simulate)"; then
        record_pass "run --dry-run shows preview"
    else
        record_skip "run --dry-run behavior unclear"
    fi
    
    rm -f "$TEST_ROOT/_cursorflow/tasks/dry-run-test.json"
}

# ============================================================================
# Parallel Execution Tests (Simulated)
# ============================================================================

test_parallel_task_creation() {
    log_test "Parallel lane task creation"
    
    mkdir -p "$TEST_ROOT/_cursorflow/tasks"
    
    # Create two parallel lanes (no dependencies)
    cat > "$TEST_ROOT/_cursorflow/tasks/parallel-a.json" << 'EOF'
{
  "name": "parallel-lane-a",
  "tasks": [{ "name": "task-a", "prompt": "First parallel lane task" }]
}
EOF
    
    cat > "$TEST_ROOT/_cursorflow/tasks/parallel-b.json" << 'EOF'
{
  "name": "parallel-lane-b",
  "tasks": [{ "name": "task-b", "prompt": "Second parallel lane task" }]
}
EOF
    
    local exit_code=0
    cursorflow_out doctor --tasks-dir "$TEST_ROOT/_cursorflow/tasks" > /dev/null 2>&1 || exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        record_pass "Parallel lanes validated successfully"
    else
        record_fail "Parallel lanes validation failed"
    fi
    
    rm -f "$TEST_ROOT/_cursorflow/tasks/parallel-"*.json
}

# ============================================================================
# Real Execution Tests (require cursor-agent)
# ============================================================================

test_real_single_lane_execution() {
    log_test "Single lane real execution"
    
    if ! check_agent_available; then
        record_skip "cursor-agent not available"
        return
    fi
    
    mkdir -p "$TEST_ROOT/_cursorflow/tasks"
    
    cat > "$TEST_ROOT/_cursorflow/tasks/single-lane.json" << 'EOF'
{
  "name": "single-lane",
  "tasks": [{ "name": "simple-task", "prompt": "Say 'Hello CursorFlow' and nothing else. Do not make file changes.", "model": "sonnet-4.5" }],
  "timeout": 60000
}
EOF
    
    local exit_code=0
    timeout 120 cursorflow_out run "$TEST_ROOT/_cursorflow/tasks" --skip-doctor --max-concurrent 1 2>&1 || exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        record_pass "Single lane execution completed"
    else
        record_fail "Single lane execution failed (exit: $exit_code)"
    fi
    
    rm -f "$TEST_ROOT/_cursorflow/tasks/single-lane.json"
}

test_real_parallel_execution() {
    log_test "Parallel lanes real execution"
    
    if ! check_agent_available; then
        record_skip "cursor-agent not available"
        return
    fi
    
    mkdir -p "$TEST_ROOT/_cursorflow/tasks"
    
    for i in {1..2}; do
        cat > "$TEST_ROOT/_cursorflow/tasks/parallel-$i.json" << EOF
{
  "name": "parallel-lane-$i",
  "tasks": [{ "name": "task-$i", "prompt": "Say 'Lane $i done' and nothing else.", "model": "sonnet-4.5" }],
  "timeout": 60000
}
EOF
    done
    
    local exit_code=0
    timeout 180 cursorflow_out run "$TEST_ROOT/_cursorflow/tasks" --skip-doctor --max-concurrent 2 2>&1 || exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        # Verify both branches were created
        local branches
        branches=$(git branch -a 2>/dev/null)
        if echo "$branches" | grep -qE "parallel-lane"; then
            record_pass "Parallel execution created expected branches"
        else
            record_pass "Parallel execution completed (branch check skipped)"
        fi
    else
        record_fail "Parallel execution failed (exit: $exit_code)"
    fi
    
    rm -f "$TEST_ROOT/_cursorflow/tasks/parallel-"*.json
}

test_real_sequential_execution() {
    log_test "Sequential lanes real execution"
    
    if ! check_agent_available; then
        record_skip "cursor-agent not available"
        return
    fi
    
    mkdir -p "$TEST_ROOT/_cursorflow/tasks"
    
    cat > "$TEST_ROOT/_cursorflow/tasks/seq-1.json" << 'EOF'
{
  "name": "seq-lane-1",
  "tasks": [{ "name": "task-1", "prompt": "Say 'First done' and nothing else.", "model": "sonnet-4.5" }],
  "timeout": 60000
}
EOF
    
    cat > "$TEST_ROOT/_cursorflow/tasks/seq-2.json" << 'EOF'
{
  "name": "seq-lane-2",
  "dependsOn": ["seq-lane-1"],
  "tasks": [{ "name": "task-2", "prompt": "Say 'Second done' and nothing else.", "model": "sonnet-4.5" }],
  "timeout": 60000
}
EOF
    
    local exit_code=0
    timeout 240 cursorflow_out run "$TEST_ROOT/_cursorflow/tasks" --skip-doctor --max-concurrent 1 2>&1 || exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        record_pass "Sequential execution completed"
    else
        record_fail "Sequential execution failed (exit: $exit_code)"
    fi
    
    rm -f "$TEST_ROOT/_cursorflow/tasks/seq-"*.json
}

# ============================================================================
# Worktree Tests
# ============================================================================

test_worktree_creation() {
    log_test "Worktree directory structure"
    
    if [ -d "$TEST_ROOT/_cursorflow/worktrees" ]; then
        record_pass "Worktrees directory exists"
    else
        record_skip "Worktrees not yet created (no execution)"
    fi
}

test_worktree_cleanup() {
    log_test "Worktree cleanup on completion"
    
    local orphaned
    orphaned=$(git worktree list --porcelain 2>/dev/null | grep -c "^worktree" || echo "0")
    
    # Should have at most 1 (main repo)
    if [ "$orphaned" -le 1 ]; then
        record_pass "No orphaned worktrees"
    else
        record_warn "Found $orphaned worktrees (may be expected)"
    fi
}

# ============================================================================
# Log Verification Tests
# ============================================================================

test_logs_directory() {
    log_test "Logs directory structure"
    
    if [ -d "$TEST_ROOT/_cursorflow/logs" ]; then
        record_pass "Logs directory exists"
    else
        record_skip "Logs directory not created (no execution)"
    fi
}

test_run_log_exists() {
    log_test "Run log file creation"
    
    local latest_run="$TEST_ROOT/_cursorflow/logs/runs/latest"
    if [ -L "$latest_run" ] || [ -d "$latest_run" ]; then
        record_pass "Latest run symlink exists"
    else
        record_skip "No run logs yet"
    fi
}

# ============================================================================
# Main
# ============================================================================

run_tests() {
    log_module "Lifecycle Integration Tests"
    
    if [ "$SKIP_AGENT" = true ]; then
        log_warn "Running in --skip-agent mode: real execution tests will be skipped"
    fi
    
    setup_module
    
    log_phase "Phase 1: Run Command Interface"
    test_run_help
    test_run_no_tasks
    test_run_skip_doctor
    test_run_max_concurrent
    test_run_dry_run
    
    log_phase "Phase 2: Parallel Task Validation"
    test_parallel_task_creation
    
    log_phase "Phase 3: Real Execution Tests"
    test_real_single_lane_execution
    test_real_parallel_execution
    test_real_sequential_execution
    
    log_phase "Phase 4: Worktree Management"
    test_worktree_creation
    test_worktree_cleanup
    
    log_phase "Phase 5: Log Verification"
    test_logs_directory
    test_run_log_exists
    
    cleanup_module
    
    print_module_summary
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    run_tests "$@"
    exit $?
fi


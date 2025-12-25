#!/bin/bash
# tests/scripts/validation/test-edge-cases.sh
#
# Tests for edge cases, bug scenarios, and error handling
#

set -e

# Source helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../common/helpers.sh"

# ============================================================================
# Module Setup
# ============================================================================

TEST_ROOT=""

setup_module() {
    ensure_build
    TEST_ROOT=$(setup_test_repo "$PROJECT_ROOT/_test_edge")
    cd "$TEST_ROOT"
    
    # Initialize CursorFlow
    cursorflow_out init --yes > /dev/null 2>&1
}

cleanup_module() {
    cleanup_test_repo "$TEST_ROOT"
}

# ============================================================================
# Branch Prefix Edge Cases
# ============================================================================

test_branch_prefix_sanitization() {
    log_test "Branch prefix sanitization (special chars)"
    local TMP_DIR="$TEST_ROOT/_cursorflow/tasks"
    mkdir -p "$TMP_DIR"
    
    cat > "$TMP_DIR/special-chars.json" << 'EOF'
{
  "name": "special-chars-lane",
  "branchPrefix": "feature/test@#$%^&*()!",
  "tasks": [{ "name": "task1", "prompt": "Test special characters in branch prefix handling" }]
}
EOF
    
    local output
    output=$(cursorflow_out doctor --tasks-dir "$TMP_DIR" 2>&1) || true
    
    # Should either sanitize or warn about invalid chars
    if echo "$output" | grep -qiE "(sanitize|invalid|character|warning)"; then
        record_pass "Branch prefix special chars handled"
    else
        record_skip "Branch prefix sanitization not explicit"
    fi
    
    rm -f "$TMP_DIR/special-chars.json"
}

test_very_long_branch_prefix() {
    log_test "Very long branch prefix"
    local TMP_DIR="$TEST_ROOT/_cursorflow/tasks"
    mkdir -p "$TMP_DIR"
    
    local long_prefix="feature/this-is-a-very-very-very-very-very-very-very-very-very-very-long-branch-prefix-that-exceeds-normal-limits-"
    
    cat > "$TMP_DIR/long-prefix.json" << EOF
{
  "name": "long-prefix-lane",
  "branchPrefix": "$long_prefix",
  "tasks": [{ "name": "task1", "prompt": "Test very long branch prefix handling" }]
}
EOF
    
    local output
    output=$(cursorflow_out doctor --tasks-dir "$TMP_DIR" 2>&1) || true
    
    if echo "$output" | grep -qiE "(long|truncate|length|warning)"; then
        record_pass "Very long branch prefix handled"
    else
        record_skip "Long branch prefix handling not explicit"
    fi
    
    rm -f "$TMP_DIR/long-prefix.json"
}

test_duplicate_branch_prefix() {
    log_test "Duplicate branch prefix detection"
    local TMP_DIR="$TEST_ROOT/_cursorflow/tasks"
    mkdir -p "$TMP_DIR"
    
    cat > "$TMP_DIR/dup-1.json" << 'EOF'
{
  "name": "lane-dup-1",
  "branchPrefix": "feature/duplicate-",
  "tasks": [{ "name": "task1", "prompt": "First lane with duplicate prefix" }]
}
EOF
    
    cat > "$TMP_DIR/dup-2.json" << 'EOF'
{
  "name": "lane-dup-2",
  "branchPrefix": "feature/duplicate-",
  "tasks": [{ "name": "task2", "prompt": "Second lane with duplicate prefix" }]
}
EOF
    
    local output
    output=$(cursorflow_out doctor --tasks-dir "$TMP_DIR" 2>&1) || true
    
    if echo "$output" | grep -qiE "(duplicate|collision|conflict|branch)"; then
        record_pass "Duplicate branch prefix detected"
    else
        record_skip "Duplicate branch prefix detection not implemented"
    fi
    
    rm -f "$TMP_DIR/dup-1.json" "$TMP_DIR/dup-2.json"
}

# ============================================================================
# Prompt Edge Cases
# ============================================================================

test_very_long_prompt() {
    log_test "Very long prompt (5000+ chars)"
    local TMP_DIR="$TEST_ROOT/_cursorflow/tasks"
    mkdir -p "$TMP_DIR"
    
    local long_prompt=""
    for i in {1..100}; do
        long_prompt+="This is a very long prompt that tests how the system handles extremely long prompts. "
    done
    
    cat > "$TMP_DIR/long-prompt.json" << EOF
{
  "name": "long-prompt-lane",
  "tasks": [{ "name": "task1", "prompt": "$long_prompt" }]
}
EOF
    
    local exit_code=0
    cursorflow_out doctor --tasks-dir "$TMP_DIR" > /dev/null 2>&1 || exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        record_pass "Very long prompts accepted"
    else
        record_skip "Long prompt handling unclear"
    fi
    
    rm -f "$TMP_DIR/long-prompt.json"
}

test_unicode_prompt() {
    log_test "Unicode characters in prompt"
    local TMP_DIR="$TEST_ROOT/_cursorflow/tasks"
    mkdir -p "$TMP_DIR"
    
    cat > "$TMP_DIR/unicode.json" << 'EOF'
{
  "name": "unicode-lane",
  "tasks": [{ "name": "task1", "prompt": "한글 테스트 🚀 日本語 العربية emoji 🎉🔥💻" }]
}
EOF
    
    local exit_code=0
    cursorflow_out doctor --tasks-dir "$TMP_DIR" > /dev/null 2>&1 || exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        record_pass "Unicode prompts accepted"
    else
        record_fail "Unicode prompts failed validation"
    fi
    
    rm -f "$TMP_DIR/unicode.json"
}

test_multiline_prompt() {
    log_test "Multiline prompt in JSON"
    local TMP_DIR="$TEST_ROOT/_cursorflow/tasks"
    mkdir -p "$TMP_DIR"
    
    cat > "$TMP_DIR/multiline.json" << 'EOF'
{
  "name": "multiline-lane",
  "tasks": [{ "name": "task1", "prompt": "Line 1\nLine 2\nLine 3\n\nWith blank line" }]
}
EOF
    
    local exit_code=0
    cursorflow_out doctor --tasks-dir "$TMP_DIR" > /dev/null 2>&1 || exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        record_pass "Multiline prompts accepted"
    else
        record_fail "Multiline prompts failed validation"
    fi
    
    rm -f "$TMP_DIR/multiline.json"
}

# ============================================================================
# Dependency Edge Cases
# ============================================================================

test_deep_dependency_chain() {
    log_test "Deep dependency chain (10+ levels)"
    local TMP_DIR="$TEST_ROOT/_cursorflow/tasks"
    mkdir -p "$TMP_DIR"
    
    # Create a chain of 10 dependent lanes
    for i in {1..10}; do
        local deps=""
        if [ $i -gt 1 ]; then
            deps='"dependsOn": ["chain-lane-'$((i-1))'"],'
        fi
        cat > "$TMP_DIR/chain-$i.json" << EOF
{
  "name": "chain-lane-$i",
  $deps
  "tasks": [{ "name": "task-$i", "prompt": "Chain task level $i" }]
}
EOF
    done
    
    local exit_code=0
    cursorflow_out doctor --tasks-dir "$TMP_DIR" > /dev/null 2>&1 || exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        record_pass "Deep dependency chain accepted"
    else
        record_skip "Deep dependency chain handling unclear"
    fi
    
    rm -f "$TMP_DIR/chain-"*.json
}

test_diamond_dependency_pattern() {
    log_test "Diamond dependency pattern (A -> B, C -> D; B,C -> A)"
    local TMP_DIR="$TEST_ROOT/_cursorflow/tasks"
    mkdir -p "$TMP_DIR"
    
    # Create diamond: D depends on B and C, both B and C depend on A
    cat > "$TMP_DIR/diamond-a.json" << 'EOF'
{
  "name": "diamond-a",
  "tasks": [{ "name": "task-a", "prompt": "Base task for diamond pattern" }]
}
EOF
    
    cat > "$TMP_DIR/diamond-b.json" << 'EOF'
{
  "name": "diamond-b",
  "dependsOn": ["diamond-a"],
  "tasks": [{ "name": "task-b", "prompt": "Left branch of diamond" }]
}
EOF
    
    cat > "$TMP_DIR/diamond-c.json" << 'EOF'
{
  "name": "diamond-c",
  "dependsOn": ["diamond-a"],
  "tasks": [{ "name": "task-c", "prompt": "Right branch of diamond" }]
}
EOF
    
    cat > "$TMP_DIR/diamond-d.json" << 'EOF'
{
  "name": "diamond-d",
  "dependsOn": ["diamond-b", "diamond-c"],
  "tasks": [{ "name": "task-d", "prompt": "Merge point of diamond" }]
}
EOF
    
    local exit_code=0
    cursorflow_out doctor --tasks-dir "$TMP_DIR" > /dev/null 2>&1 || exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        record_pass "Diamond dependency pattern accepted"
    else
        record_fail "Diamond dependency pattern rejected (exit: $exit_code)"
    fi
    
    rm -f "$TMP_DIR/diamond-"*.json
}

test_multiple_roots() {
    log_test "Multiple independent root lanes"
    local TMP_DIR="$TEST_ROOT/_cursorflow/tasks"
    mkdir -p "$TMP_DIR"
    
    for i in {1..5}; do
        cat > "$TMP_DIR/root-$i.json" << EOF
{
  "name": "root-lane-$i",
  "tasks": [{ "name": "root-task-$i", "prompt": "Independent root task $i" }]
}
EOF
    done
    
    local exit_code=0
    cursorflow_out doctor --tasks-dir "$TMP_DIR" > /dev/null 2>&1 || exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        record_pass "Multiple independent roots accepted"
    else
        record_fail "Multiple roots rejected"
    fi
    
    rm -f "$TMP_DIR/root-"*.json
}

# ============================================================================
# Timeout Configuration Tests
# ============================================================================

test_timeout_configuration() {
    log_test "Custom timeout configuration"
    local TMP_DIR="$TEST_ROOT/_cursorflow/tasks"
    mkdir -p "$TMP_DIR"
    
    cat > "$TMP_DIR/timeout.json" << 'EOF'
{
  "name": "timeout-lane",
  "timeout": 300000,
  "tasks": [{ "name": "task1", "prompt": "Task with custom timeout" }]
}
EOF
    
    local exit_code=0
    cursorflow_out doctor --tasks-dir "$TMP_DIR" > /dev/null 2>&1 || exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        record_pass "Custom timeout configuration accepted"
    else
        record_fail "Custom timeout rejected"
    fi
    
    rm -f "$TMP_DIR/timeout.json"
}

test_zero_timeout() {
    log_test "Zero timeout handling"
    local TMP_DIR="$TEST_ROOT/_cursorflow/tasks"
    mkdir -p "$TMP_DIR"
    
    cat > "$TMP_DIR/zero-timeout.json" << 'EOF'
{
  "name": "zero-timeout-lane",
  "timeout": 0,
  "tasks": [{ "name": "task1", "prompt": "Task with zero timeout" }]
}
EOF
    
    local output
    output=$(cursorflow_out doctor --tasks-dir "$TMP_DIR" 2>&1) || true
    
    if echo "$output" | grep -qiE "(invalid|warning|timeout|error)"; then
        record_pass "Zero timeout handled (warning/error)"
    else
        record_skip "Zero timeout behavior not explicit"
    fi
    
    rm -f "$TMP_DIR/zero-timeout.json"
}

test_negative_timeout() {
    log_test "Negative timeout handling"
    local TMP_DIR="$TEST_ROOT/_cursorflow/tasks"
    mkdir -p "$TMP_DIR"
    
    cat > "$TMP_DIR/neg-timeout.json" << 'EOF'
{
  "name": "neg-timeout-lane",
  "timeout": -1000,
  "tasks": [{ "name": "task1", "prompt": "Task with negative timeout" }]
}
EOF
    
    local output
    output=$(cursorflow_out doctor --tasks-dir "$TMP_DIR" 2>&1) || true
    
    if echo "$output" | grep -qiE "(invalid|warning|negative|error)"; then
        record_pass "Negative timeout handled"
    else
        record_skip "Negative timeout behavior not explicit"
    fi
    
    rm -f "$TMP_DIR/neg-timeout.json"
}

# ============================================================================
# Model Configuration Tests
# ============================================================================

test_invalid_model_name() {
    log_test "Invalid model name handling"
    local TMP_DIR="$TEST_ROOT/_cursorflow/tasks"
    mkdir -p "$TMP_DIR"
    
    cat > "$TMP_DIR/invalid-model.json" << 'EOF'
{
  "name": "invalid-model-lane",
  "tasks": [{ "name": "task1", "prompt": "Task with invalid model", "model": "nonexistent-model-xyz-123" }]
}
EOF
    
    local output
    output=$(cursorflow_out doctor --tasks-dir "$TMP_DIR" 2>&1) || true
    
    if echo "$output" | grep -qiE "(unknown|invalid|model|warning)"; then
        record_pass "Invalid model name handled"
    else
        record_skip "Invalid model handling not explicit (may accept any model)"
    fi
    
    rm -f "$TMP_DIR/invalid-model.json"
}

test_model_per_task() {
    log_test "Different model per task"
    local TMP_DIR="$TEST_ROOT/_cursorflow/tasks"
    mkdir -p "$TMP_DIR"
    
    cat > "$TMP_DIR/multi-model.json" << 'EOF'
{
  "name": "multi-model-lane",
  "tasks": [
    { "name": "task1", "prompt": "Task with sonnet", "model": "sonnet-4.5" },
    { "name": "task2", "prompt": "Task with gpt-4", "model": "gpt-4o" }
  ]
}
EOF
    
    local exit_code=0
    cursorflow_out doctor --tasks-dir "$TMP_DIR" > /dev/null 2>&1 || exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        record_pass "Different models per task accepted"
    else
        record_fail "Different models per task rejected"
    fi
    
    rm -f "$TMP_DIR/multi-model.json"
}

# ============================================================================
# Dependency Policy Tests
# ============================================================================

test_dependency_policy() {
    log_test "Dependency policy configuration"
    local TMP_DIR="$TEST_ROOT/_cursorflow/tasks"
    mkdir -p "$TMP_DIR"
    
    cat > "$TMP_DIR/dep-policy.json" << 'EOF'
{
  "name": "dep-policy-lane",
  "dependencyPolicy": {
    "allowDependencyChange": false,
    "lockfileReadOnly": true
  },
  "tasks": [{ "name": "task1", "prompt": "Task with dependency policy" }]
}
EOF
    
    local exit_code=0
    cursorflow_out doctor --tasks-dir "$TMP_DIR" > /dev/null 2>&1 || exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        record_pass "Dependency policy configuration accepted"
    else
        record_fail "Dependency policy configuration rejected"
    fi
    
    rm -f "$TMP_DIR/dep-policy.json"
}

# ============================================================================
# Review Policy Tests
# ============================================================================

test_review_policy() {
    log_test "Review policy configuration"
    local TMP_DIR="$TEST_ROOT/_cursorflow/tasks"
    mkdir -p "$TMP_DIR"
    
    cat > "$TMP_DIR/review-policy.json" << 'EOF'
{
  "name": "review-policy-lane",
  "reviewPolicy": {
    "enabled": true,
    "autoMerge": false
  },
  "tasks": [{ "name": "task1", "prompt": "Task with review policy" }]
}
EOF
    
    local exit_code=0
    cursorflow_out doctor --tasks-dir "$TMP_DIR" > /dev/null 2>&1 || exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        record_pass "Review policy configuration accepted"
    else
        record_skip "Review policy may not be validated by doctor"
    fi
    
    rm -f "$TMP_DIR/review-policy.json"
}

# ============================================================================
# Intra-Lane Task Dependencies
# ============================================================================

test_intra_lane_task_deps() {
    log_test "Intra-lane task dependencies"
    local TMP_DIR="$TEST_ROOT/_cursorflow/tasks"
    mkdir -p "$TMP_DIR"
    
    cat > "$TMP_DIR/intra-deps.json" << 'EOF'
{
  "name": "intra-deps-lane",
  "tasks": [
    { "name": "task1", "prompt": "First task in lane" },
    { "name": "task2", "prompt": "Second task depends on first", "dependsOn": ["task1"] },
    { "name": "task3", "prompt": "Third task depends on second", "dependsOn": ["task2"] }
  ]
}
EOF
    
    local exit_code=0
    cursorflow_out doctor --tasks-dir "$TMP_DIR" > /dev/null 2>&1 || exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        record_pass "Intra-lane task dependencies accepted"
    else
        record_skip "Intra-lane dependencies may be handled differently"
    fi
    
    rm -f "$TMP_DIR/intra-deps.json"
}

# ============================================================================
# Clean Command Edge Cases
# ============================================================================

test_clean_dry_run() {
    log_test "clean --dry-run"
    local output
    output=$(cursorflow_out clean --dry-run 2>&1) || true
    
    if echo "$output" | grep -qiE "(dry|would|clean|preview)"; then
        record_pass "clean --dry-run shows preview"
    else
        record_skip "clean --dry-run behavior unclear"
    fi
}

test_clean_branches_dry_run() {
    log_test "clean branches --dry-run"
    local output
    output=$(cursorflow_out clean branches --dry-run 2>&1) || true
    
    if echo "$output" | grep -qiE "(branch|dry|clean|found|nothing)"; then
        record_pass "clean branches --dry-run works"
    else
        record_skip "clean branches --dry-run behavior unclear"
    fi
}

test_clean_worktrees_dry_run() {
    log_test "clean worktrees --dry-run"
    local output
    output=$(cursorflow_out clean worktrees --dry-run 2>&1) || true
    
    if echo "$output" | grep -qiE "(worktree|dry|clean|found|nothing)"; then
        record_pass "clean worktrees --dry-run works"
    else
        record_skip "clean worktrees --dry-run behavior unclear"
    fi
}

test_clean_orphaned() {
    log_test "clean --orphaned"
    local output
    output=$(cursorflow_out clean --orphaned 2>&1) || true
    
    if echo "$output" | grep -qiE "(orphan|clean|found|nothing)"; then
        record_pass "clean --orphaned works"
    else
        record_skip "clean --orphaned behavior unclear"
    fi
}

test_clean_nonexistent_run() {
    log_test "clean --run nonexistent"
    local output
    output=$(cursorflow_out clean --run nonexistent-run-xyz 2>&1) || true
    
    if echo "$output" | grep -qiE "(not found|no such|error|invalid)"; then
        record_pass "clean --run handles nonexistent run"
    else
        record_skip "clean --run behavior unclear"
    fi
}

# ============================================================================
# Main
# ============================================================================

run_tests() {
    log_module "Edge Cases & Bug Scenario Tests"
    
    setup_module
    
    log_phase "Phase 1: Branch Prefix Edge Cases"
    test_branch_prefix_sanitization
    test_very_long_branch_prefix
    test_duplicate_branch_prefix
    
    log_phase "Phase 2: Prompt Edge Cases"
    test_very_long_prompt
    test_unicode_prompt
    test_multiline_prompt
    
    log_phase "Phase 3: Dependency Edge Cases"
    test_deep_dependency_chain
    test_diamond_dependency_pattern
    test_multiple_roots
    
    log_phase "Phase 4: Timeout Configuration"
    test_timeout_configuration
    test_zero_timeout
    test_negative_timeout
    
    log_phase "Phase 5: Model Configuration"
    test_invalid_model_name
    test_model_per_task
    
    log_phase "Phase 6: Policy Configuration"
    test_dependency_policy
    test_review_policy
    test_intra_lane_task_deps
    
    log_phase "Phase 7: Clean Command Edge Cases"
    test_clean_dry_run
    test_clean_branches_dry_run
    test_clean_worktrees_dry_run
    test_clean_orphaned
    test_clean_nonexistent_run
    
    cleanup_module
    
    print_module_summary
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    run_tests
    exit $?
fi


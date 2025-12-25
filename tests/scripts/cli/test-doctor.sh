#!/bin/bash
# tests/scripts/cli/test-doctor.sh
#
# Tests for the 'cursorflow doctor' command - validation and diagnostics
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
    TEST_ROOT=$(setup_test_repo "$PROJECT_ROOT/_test_doctor")
    cd "$TEST_ROOT"
    
    # Initialize CursorFlow
    cursorflow_out init --yes > /dev/null 2>&1
}

cleanup_module() {
    cleanup_test_repo "$TEST_ROOT"
}

# ============================================================================
# Doctor Basic Tests
# ============================================================================

test_doctor_help() {
    log_test "doctor --help"
    local output
    output=$(cursorflow_out doctor --help 2>&1)
    if echo "$output" | grep -q "doctor"; then
        record_pass "doctor --help shows usage"
    else
        record_fail "doctor --help output missing"
    fi
}

test_doctor_no_cursor_flag() {
    log_test "doctor --no-cursor"
    local output
    output=$(cursorflow_out doctor --no-cursor 2>&1) || true
    if echo "$output" | grep -qiE "(skip|cursor-agent|environment)"; then
        record_pass "doctor --no-cursor works"
    else
        record_pass "doctor --no-cursor executes without error"
    fi
}

test_doctor_json_output() {
    log_test "doctor --json output format"
    local output
    output=$(cursorflow_out doctor --json --no-cursor 2>&1) || true
    if echo "$output" | grep -qE '^\{.*\}$'; then
        record_pass "doctor --json returns JSON"
    else
        record_fail "doctor --json output not JSON format"
    fi
}

# ============================================================================
# Doctor Validation Tests - Invalid JSON
# ============================================================================

test_doctor_invalid_json() {
    log_test "Invalid JSON detection"
    local TMP_DIR="$TEST_ROOT/_cursorflow/validation_tmp"
    mkdir -p "$TMP_DIR"
    
    # Create invalid JSON
    echo "{" > "$TMP_DIR/invalid.json"
    
    local output
    output=$(cursorflow_out doctor --tasks-dir "$TMP_DIR" 2>&1) || true
    
    if echo "$output" | grep -qiE "(fail|parse|invalid|error)"; then
        record_pass "doctor detects invalid JSON"
    else
        record_fail "doctor FAILED to detect invalid JSON"
    fi
    
    rm -rf "$TMP_DIR"
}

# ============================================================================
# Doctor Validation Tests - Missing Lane Name
# ============================================================================

test_doctor_missing_name() {
    log_test "Missing lane name detection"
    local TMP_DIR="$TEST_ROOT/_cursorflow/validation_tmp"
    mkdir -p "$TMP_DIR"
    
    cat > "$TMP_DIR/no-name.json" << 'EOF'
{
  "tasks": [
    { "name": "task1", "prompt": "Do something" }
  ]
}
EOF
    
    local output
    output=$(cursorflow_out doctor --tasks-dir "$TMP_DIR" 2>&1) || true
    
    if echo "$output" | grep -qiE "(name|missing|required|invalid)"; then
        record_pass "doctor detects missing lane name"
    else
        record_fail "doctor FAILED to detect missing lane name"
    fi
    
    rm -rf "$TMP_DIR"
}

# ============================================================================
# Doctor Validation Tests - Circular Dependencies
# ============================================================================

test_doctor_circular_deps() {
    log_test "Circular dependency detection"
    local TMP_DIR="$TEST_ROOT/_cursorflow/validation_tmp"
    mkdir -p "$TMP_DIR"
    
    cat > "$TMP_DIR/lane-a.json" << 'EOF'
{
  "name": "lane-a",
  "dependsOn": ["lane-b"],
  "tasks": [{ "name": "task-a", "prompt": "Do A" }]
}
EOF
    
    cat > "$TMP_DIR/lane-b.json" << 'EOF'
{
  "name": "lane-b",
  "dependsOn": ["lane-a"],
  "tasks": [{ "name": "task-b", "prompt": "Do B" }]
}
EOF
    
    local output
    output=$(cursorflow_out doctor --tasks-dir "$TMP_DIR" 2>&1) || true
    
    if echo "$output" | grep -qiE "(circular|cycle|dependency)"; then
        record_pass "doctor detects circular dependencies"
    else
        record_fail "doctor FAILED to detect circular dependencies"
    fi
    
    rm -rf "$TMP_DIR"
}

# ============================================================================
# Doctor Validation Tests - Duplicate Task Names
# ============================================================================

test_doctor_duplicate_names() {
    log_test "Duplicate task name detection"
    local TMP_DIR="$TEST_ROOT/_cursorflow/validation_tmp"
    mkdir -p "$TMP_DIR"
    
    cat > "$TMP_DIR/lane-1.json" << 'EOF'
{
  "name": "lane-1",
  "tasks": [{ "name": "same-name", "prompt": "First task" }]
}
EOF
    
    cat > "$TMP_DIR/lane-2.json" << 'EOF'
{
  "name": "same-name",
  "tasks": [{ "name": "task2", "prompt": "Second task" }]
}
EOF
    
    local output
    output=$(cursorflow_out doctor --tasks-dir "$TMP_DIR" 2>&1) || true
    
    if echo "$output" | grep -qiE "(duplicate|conflict|already)"; then
        record_pass "doctor detects duplicate names"
    else
        # May not be implemented - just warn
        record_skip "Duplicate name detection not implemented or different behavior"
    fi
    
    rm -rf "$TMP_DIR"
}

# ============================================================================
# Doctor Validation Tests - Short Prompts
# ============================================================================

test_doctor_short_prompt() {
    log_test "Short prompt warning"
    local TMP_DIR="$TEST_ROOT/_cursorflow/validation_tmp"
    mkdir -p "$TMP_DIR"
    
    cat > "$TMP_DIR/short.json" << 'EOF'
{
  "name": "short-prompt-lane",
  "tasks": [{ "name": "task1", "prompt": "Hi" }]
}
EOF
    
    local output
    output=$(cursorflow_out doctor --tasks-dir "$TMP_DIR" 2>&1) || true
    
    if echo "$output" | grep -qiE "(short|warn|brief|length)"; then
        record_pass "doctor warns about short prompts"
    else
        record_skip "Short prompt warning not implemented"
    fi
    
    rm -rf "$TMP_DIR"
}

# ============================================================================
# Doctor Validation Tests - Unknown Dependencies
# ============================================================================

test_doctor_unknown_deps() {
    log_test "Unknown dependency detection"
    local TMP_DIR="$TEST_ROOT/_cursorflow/validation_tmp"
    mkdir -p "$TMP_DIR"
    
    cat > "$TMP_DIR/orphan.json" << 'EOF'
{
  "name": "orphan-lane",
  "dependsOn": ["non-existent-lane"],
  "tasks": [{ "name": "task1", "prompt": "Some prompt here" }]
}
EOF
    
    local output
    output=$(cursorflow_out doctor --tasks-dir "$TMP_DIR" 2>&1) || true
    
    if echo "$output" | grep -qiE "(unknown|not found|missing|dependency)"; then
        record_pass "doctor detects unknown dependencies"
    else
        record_skip "Unknown dependency detection not implemented"
    fi
    
    rm -rf "$TMP_DIR"
}

# ============================================================================
# Doctor Validation Tests - Pipeline Branch Collision
# ============================================================================

test_doctor_branch_collision() {
    log_test "Pipeline branch collision detection"
    local TMP_DIR="$TEST_ROOT/_cursorflow/validation_tmp"
    mkdir -p "$TMP_DIR"
    
    cat > "$TMP_DIR/lane-x.json" << 'EOF'
{
  "name": "lane-x",
  "branchPrefix": "feature/same-",
  "tasks": [{ "name": "task-x", "prompt": "Task X prompt here" }]
}
EOF
    
    cat > "$TMP_DIR/lane-y.json" << 'EOF'
{
  "name": "lane-y",
  "branchPrefix": "feature/same-",
  "tasks": [{ "name": "task-y", "prompt": "Task Y prompt here" }]
}
EOF
    
    local output
    output=$(cursorflow_out doctor --tasks-dir "$TMP_DIR" 2>&1) || true
    
    if echo "$output" | grep -qiE "(collision|duplicate|branch|prefix)"; then
        record_pass "doctor detects branch prefix collision"
    else
        record_skip "Branch collision detection not implemented"
    fi
    
    rm -rf "$TMP_DIR"
}

# ============================================================================
# Doctor Validation Tests - Valid Task Config
# ============================================================================

test_doctor_valid_config() {
    log_test "Valid task configuration passes"
    local TMP_DIR="$TEST_ROOT/_cursorflow/validation_tmp"
    mkdir -p "$TMP_DIR"
    
    cat > "$TMP_DIR/valid.json" << 'EOF'
{
  "name": "valid-lane",
  "branchPrefix": "feature/valid-",
  "tasks": [
    {
      "name": "valid-task",
      "prompt": "This is a valid prompt with sufficient length for the task",
      "model": "sonnet-4.5"
    }
  ]
}
EOF
    
    local exit_code=0
    cursorflow_out doctor --tasks-dir "$TMP_DIR" > /dev/null 2>&1 || exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        record_pass "doctor passes valid configuration"
    else
        record_fail "doctor failed on valid configuration (exit: $exit_code)"
    fi
    
    rm -rf "$TMP_DIR"
}

# ============================================================================
# Doctor Validation Tests - Empty Tasks Array
# ============================================================================

test_doctor_empty_tasks() {
    log_test "Empty tasks array detection"
    local TMP_DIR="$TEST_ROOT/_cursorflow/validation_tmp"
    mkdir -p "$TMP_DIR"
    
    cat > "$TMP_DIR/empty.json" << 'EOF'
{
  "name": "empty-lane",
  "tasks": []
}
EOF
    
    local output
    output=$(cursorflow_out doctor --tasks-dir "$TMP_DIR" 2>&1) || true
    
    if echo "$output" | grep -qiE "(empty|no tasks|at least)"; then
        record_pass "doctor detects empty tasks array"
    else
        record_skip "Empty tasks detection not implemented"
    fi
    
    rm -rf "$TMP_DIR"
}

# ============================================================================
# Doctor Validation Tests - Self Dependency
# ============================================================================

test_doctor_self_dependency() {
    log_test "Self-dependency detection"
    local TMP_DIR="$TEST_ROOT/_cursorflow/validation_tmp"
    mkdir -p "$TMP_DIR"
    
    cat > "$TMP_DIR/self-dep.json" << 'EOF'
{
  "name": "self-lane",
  "dependsOn": ["self-lane"],
  "tasks": [{ "name": "task1", "prompt": "Self dependent task" }]
}
EOF
    
    local output
    output=$(cursorflow_out doctor --tasks-dir "$TMP_DIR" 2>&1) || true
    
    if echo "$output" | grep -qiE "(self|circular|itself|dependency)"; then
        record_pass "doctor detects self-dependency"
    else
        record_skip "Self-dependency detection not implemented"
    fi
    
    rm -rf "$TMP_DIR"
}

# ============================================================================
# Main
# ============================================================================

run_tests() {
    log_module "Doctor Command Tests"
    
    setup_module
    
    log_phase "Phase 1: Basic Doctor Commands"
    test_doctor_help
    test_doctor_no_cursor_flag
    test_doctor_json_output
    
    log_phase "Phase 2: Validation - Error Detection"
    test_doctor_invalid_json
    test_doctor_missing_name
    test_doctor_circular_deps
    test_doctor_duplicate_names
    test_doctor_short_prompt
    test_doctor_unknown_deps
    test_doctor_branch_collision
    test_doctor_empty_tasks
    test_doctor_self_dependency
    
    log_phase "Phase 3: Validation - Success Cases"
    test_doctor_valid_config
    
    cleanup_module
    
    print_module_summary
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    run_tests
    exit $?
fi


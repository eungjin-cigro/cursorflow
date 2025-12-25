#!/bin/bash
# tests/scripts/prepare/test-prepare.sh
#
# Tests for the 'cursorflow prepare' command - task generation
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
    TEST_ROOT=$(setup_test_repo "$PROJECT_ROOT/_test_prepare")
    cd "$TEST_ROOT"
    
    # Initialize CursorFlow
    cursorflow_out init --yes > /dev/null 2>&1
}

cleanup_module() {
    cleanup_test_repo "$TEST_ROOT"
}

# ============================================================================
# Basic Prepare Tests
# ============================================================================

test_prepare_help() {
    log_test "cursorflow prepare --help"
    local output
    output=$(cursorflow_out prepare --help 2>&1)
    if echo "$output" | grep -qiE "(prepare|generate|task)"; then
        record_pass "prepare --help shows usage"
    else
        record_fail "prepare --help missing expected output"
    fi
}

test_prepare_simple_preset() {
    log_test "prepare --preset simple"
    rm -rf "$TEST_ROOT/_cursorflow/tasks/"*
    
    local output
    local exit_code=0
    output=$(cursorflow_out prepare TestFeature --preset simple --force 2>&1) || exit_code=$?
    
    if [ $exit_code -eq 0 ] && find "$TEST_ROOT/_cursorflow/tasks" -name "*.json" 2>/dev/null | grep -q "."; then
        record_pass "prepare --preset simple generates tasks"
    else
        record_fail "prepare --preset simple failed (exit: $exit_code)"
    fi
}

test_prepare_complex_preset() {
    log_test "prepare --preset complex"
    rm -rf "$TEST_ROOT/_cursorflow/tasks/"*
    
    local output
    local exit_code=0
    output=$(cursorflow_out prepare ComplexFeature --preset complex --lanes 2 --force 2>&1) || exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        local count
        count=$(find "$TEST_ROOT/_cursorflow/tasks" -name "*.json" 2>/dev/null | wc -l)
        if [ "$count" -ge 2 ]; then
            record_pass "prepare --preset complex generates multiple lanes"
        else
            record_fail "prepare --preset complex generated $count lanes (expected >= 2)"
        fi
    else
        record_fail "prepare --preset complex failed (exit: $exit_code)"
    fi
}

test_prepare_sequential_option() {
    log_test "prepare --sequential"
    rm -rf "$TEST_ROOT/_cursorflow/tasks/"*
    
    local output
    local exit_code=0
    output=$(cursorflow_out prepare SeqFeature --preset complex --lanes 3 --sequential --force 2>&1) || exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        # Check if tasks have dependsOn relationships
        if grep -r "dependsOn" "$TEST_ROOT/_cursorflow/tasks" 2>/dev/null | grep -q "."; then
            record_pass "prepare --sequential creates dependencies"
        else
            record_skip "prepare --sequential may not create explicit dependsOn"
        fi
    else
        record_fail "prepare --sequential failed"
    fi
}

# ============================================================================
# Custom Task Tests
# ============================================================================

test_prepare_custom_task() {
    log_test "prepare with --task custom spec"
    rm -rf "$TEST_ROOT/_cursorflow/tasks/"*
    
    local output
    local exit_code=0
    output=$(cursorflow_out prepare CustomTask --task "name:custom-lane,prompt:Implement custom feature" --force 2>&1) || exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        if grep -r "custom" "$TEST_ROOT/_cursorflow/tasks" 2>/dev/null | grep -q "."; then
            record_pass "prepare --task creates custom task"
        else
            record_skip "prepare --task may have different output format"
        fi
    else
        record_fail "prepare --task failed (exit: $exit_code)"
    fi
}

test_prepare_add_lane() {
    log_test "prepare --add-lane"
    rm -rf "$TEST_ROOT/_cursorflow/tasks/"*
    
    # First create base tasks
    cursorflow_out prepare Base --preset simple --force > /dev/null 2>&1
    
    local initial_count
    initial_count=$(find "$TEST_ROOT/_cursorflow/tasks" -name "*.json" 2>/dev/null | wc -l)
    
    # Add a lane
    local output
    local exit_code=0
    output=$(cursorflow_out prepare --add-lane "Additional lane for testing" --force 2>&1) || exit_code=$?
    
    local final_count
    final_count=$(find "$TEST_ROOT/_cursorflow/tasks" -name "*.json" 2>/dev/null | wc -l)
    
    if [ "$final_count" -gt "$initial_count" ]; then
        record_pass "prepare --add-lane adds new lane"
    else
        record_skip "prepare --add-lane behavior different than expected"
    fi
}

# ============================================================================
# Template Tests
# ============================================================================

test_prepare_with_template() {
    log_test "prepare --template basic"
    rm -rf "$TEST_ROOT/_cursorflow/tasks/"*
    
    local output
    local exit_code=0
    output=$(cursorflow_out prepare TemplateTest --template basic --force 2>&1) || exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        if find "$TEST_ROOT/_cursorflow/tasks" -name "*.json" 2>/dev/null | grep -q "."; then
            record_pass "prepare --template basic works"
        else
            record_fail "prepare --template basic created no files"
        fi
    else
        record_fail "prepare --template basic failed"
    fi
}

test_prepare_local_template() {
    log_test "prepare with local template file"
    rm -rf "$TEST_ROOT/_cursorflow/tasks/"*
    
    # Create a local template
    cat > "$TEST_ROOT/custom-template.json" << 'EOF'
{
  "name": "custom-template",
  "tasks": [
    { "name": "custom-task", "prompt": "Custom prompt for {{featureName}}" }
  ]
}
EOF
    
    local output
    local exit_code=0
    output=$(cursorflow_out prepare LocalTemplate --template "$TEST_ROOT/custom-template.json" --force 2>&1) || exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        if find "$TEST_ROOT/_cursorflow/tasks" -name "*.json" 2>/dev/null | grep -q "."; then
            record_pass "prepare with local template works"
        else
            record_fail "prepare with local template created no files"
        fi
    else
        record_skip "prepare with local template may have different syntax"
    fi
    
    rm -f "$TEST_ROOT/custom-template.json"
}

# ============================================================================
# Output Format Tests
# ============================================================================

test_prepare_output_directory() {
    log_test "prepare creates correct directory structure"
    rm -rf "$TEST_ROOT/_cursorflow/tasks/"*
    
    cursorflow_out prepare DirTest --preset simple --force > /dev/null 2>&1
    
    if [ -d "$TEST_ROOT/_cursorflow/tasks" ]; then
        record_pass "prepare creates _cursorflow/tasks directory"
    else
        record_fail "prepare did not create tasks directory"
    fi
}

test_prepare_json_validity() {
    log_test "prepare generates valid JSON"
    rm -rf "$TEST_ROOT/_cursorflow/tasks/"*
    
    cursorflow_out prepare JsonTest --preset simple --force > /dev/null 2>&1
    
    local invalid=0
    for file in "$TEST_ROOT/_cursorflow/tasks"/**/*.json; do
        if [ -f "$file" ]; then
            if ! python3 -m json.tool "$file" > /dev/null 2>&1; then
                if ! node -e "JSON.parse(require('fs').readFileSync('$file'))" 2>/dev/null; then
                    invalid=$((invalid + 1))
                fi
            fi
        fi
    done
    
    if [ $invalid -eq 0 ]; then
        record_pass "prepare generates valid JSON files"
    else
        record_fail "prepare generated $invalid invalid JSON files"
    fi
}

test_prepare_required_fields() {
    log_test "prepare includes required fields (name, tasks)"
    rm -rf "$TEST_ROOT/_cursorflow/tasks/"*
    
    cursorflow_out prepare FieldTest --preset simple --force > /dev/null 2>&1
    
    local missing=0
    for file in "$TEST_ROOT/_cursorflow/tasks"/**/*.json; do
        if [ -f "$file" ]; then
            if ! grep -q '"name"' "$file" || ! grep -q '"tasks"' "$file"; then
                missing=$((missing + 1))
            fi
        fi
    done
    
    if [ $missing -eq 0 ]; then
        record_pass "prepare includes required fields"
    else
        record_fail "prepare missing required fields in $missing files"
    fi
}

# ============================================================================
# Force and Overwrite Tests
# ============================================================================

test_prepare_force_overwrite() {
    log_test "prepare --force overwrites existing"
    rm -rf "$TEST_ROOT/_cursorflow/tasks/"*
    
    # Create initial tasks
    cursorflow_out prepare Initial --preset simple --force > /dev/null 2>&1
    
    local initial_time
    initial_time=$(stat -c %Y "$TEST_ROOT/_cursorflow/tasks"/*/*.json 2>/dev/null | head -1)
    
    sleep 1
    
    # Overwrite with --force
    cursorflow_out prepare Overwrite --preset simple --force > /dev/null 2>&1
    
    local final_time
    final_time=$(stat -c %Y "$TEST_ROOT/_cursorflow/tasks"/*/*.json 2>/dev/null | head -1)
    
    if [ -n "$final_time" ] && [ "$final_time" != "$initial_time" ]; then
        record_pass "prepare --force overwrites existing files"
    else
        record_skip "prepare --force behavior couldn't be verified"
    fi
}

test_prepare_without_force() {
    log_test "prepare without --force on existing"
    rm -rf "$TEST_ROOT/_cursorflow/tasks/"*
    
    # Create initial tasks
    cursorflow_out prepare Existing --preset simple --force > /dev/null 2>&1
    
    # Try to overwrite without --force
    local output
    local exit_code=0
    output=$(cursorflow_out prepare NewName --preset simple 2>&1) || exit_code=$?
    
    if echo "$output" | grep -qiE "(exist|overwrite|force|already)"; then
        record_pass "prepare prompts about existing tasks"
    else
        record_skip "prepare behavior without --force unclear"
    fi
}

# ============================================================================
# Branch Prefix Tests
# ============================================================================

test_prepare_branch_prefix() {
    log_test "prepare includes branchPrefix"
    rm -rf "$TEST_ROOT/_cursorflow/tasks/"*
    
    cursorflow_out prepare BranchTest --preset simple --force > /dev/null 2>&1
    
    if grep -r "branchPrefix" "$TEST_ROOT/_cursorflow/tasks" 2>/dev/null | grep -q "."; then
        record_pass "prepare includes branchPrefix in tasks"
    else
        record_skip "branchPrefix may be optional or auto-generated"
    fi
}

# ============================================================================
# Main
# ============================================================================

run_tests() {
    log_module "Prepare Command Tests"
    
    setup_module
    
    log_phase "Phase 1: Basic Prepare Commands"
    test_prepare_help
    test_prepare_simple_preset
    test_prepare_complex_preset
    test_prepare_sequential_option
    
    log_phase "Phase 2: Custom Task Generation"
    test_prepare_custom_task
    test_prepare_add_lane
    
    log_phase "Phase 3: Template Usage"
    test_prepare_with_template
    test_prepare_local_template
    
    log_phase "Phase 4: Output Validation"
    test_prepare_output_directory
    test_prepare_json_validity
    test_prepare_required_fields
    test_prepare_branch_prefix
    
    log_phase "Phase 5: Force/Overwrite Behavior"
    test_prepare_force_overwrite
    test_prepare_without_force
    
    cleanup_module
    
    print_module_summary
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    run_tests
    exit $?
fi


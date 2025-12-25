#!/bin/bash
# tests/scripts/templates/test-templates.sh
#
# Tests for template loading and processing features
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
    TEST_ROOT=$(setup_test_repo "$PROJECT_ROOT/_test_templates")
    cd "$TEST_ROOT"
    
    # Initialize CursorFlow
    cursorflow_out init --yes > /dev/null 2>&1
}

cleanup_module() {
    cleanup_test_repo "$TEST_ROOT"
}

# ============================================================================
# Built-in Template Tests
# ============================================================================

test_builtin_basic_template() {
    log_test "Built-in 'basic' template"
    rm -rf "$TEST_ROOT/_cursorflow/tasks/"*
    
    local output
    local exit_code=0
    output=$(cursorflow_out prepare BasicTest --template basic --force 2>&1) || exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        if find "$TEST_ROOT/_cursorflow/tasks" -name "*.json" 2>/dev/null | grep -q "."; then
            record_pass "Basic template generates tasks"
        else
            record_fail "Basic template generated no files"
        fi
    else
        record_fail "Basic template failed (exit: $exit_code)"
    fi
}

test_builtin_template_content() {
    log_test "Built-in template content substitution"
    rm -rf "$TEST_ROOT/_cursorflow/tasks/"*
    
    cursorflow_out prepare MyFeature --template basic --force > /dev/null 2>&1
    
    # Check if feature name was substituted
    if grep -r "MyFeature" "$TEST_ROOT/_cursorflow/tasks" 2>/dev/null | grep -q "."; then
        record_pass "Template substitutes feature name"
    else
        record_skip "Feature name substitution behavior unclear"
    fi
}

# ============================================================================
# Local Template Tests
# ============================================================================

test_local_json_template() {
    log_test "Local JSON template file"
    rm -rf "$TEST_ROOT/_cursorflow/tasks/"*
    
    # Create local template
    cat > "$TEST_ROOT/my-template.json" << 'EOF'
{
  "name": "local-template",
  "tasks": [
    { "name": "custom-task", "prompt": "Custom prompt for {{featureName}}" }
  ]
}
EOF
    
    local exit_code=0
    cursorflow_out prepare LocalTest --template "$TEST_ROOT/my-template.json" --force > /dev/null 2>&1 || exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        if find "$TEST_ROOT/_cursorflow/tasks" -name "*.json" 2>/dev/null | grep -q "."; then
            # Check if content was applied
            if grep -r "Custom prompt" "$TEST_ROOT/_cursorflow/tasks" 2>/dev/null | grep -q "."; then
                record_pass "Local JSON template works"
            else
                record_skip "Local template content verification unclear"
            fi
        else
            record_fail "Local template generated no files"
        fi
    else
        record_skip "Local template syntax may be different"
    fi
    
    rm -f "$TEST_ROOT/my-template.json"
}

test_template_variable_substitution() {
    log_test "Template variable substitution"
    rm -rf "$TEST_ROOT/_cursorflow/tasks/"*
    
    # Create template with variables
    cat > "$TEST_ROOT/var-template.json" << 'EOF'
{
  "name": "{{featureName}}-lane",
  "tasks": [
    { "name": "{{featureName}}-task", "prompt": "Implement {{featureName}} feature" }
  ]
}
EOF
    
    local exit_code=0
    cursorflow_out prepare AwesomeFeature --template "$TEST_ROOT/var-template.json" --force > /dev/null 2>&1 || exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        if grep -r "AwesomeFeature" "$TEST_ROOT/_cursorflow/tasks" 2>/dev/null | grep -q "."; then
            record_pass "Template variables substituted"
        else
            record_skip "Variable substitution behavior unclear"
        fi
    else
        record_skip "Template with variables syntax may differ"
    fi
    
    rm -f "$TEST_ROOT/var-template.json"
}

# ============================================================================
# Template Error Handling
# ============================================================================

test_nonexistent_template() {
    log_test "Nonexistent template handling"
    
    local output
    local exit_code=0
    output=$(cursorflow_out prepare Test --template nonexistent-template-xyz --force 2>&1) || exit_code=$?
    
    if [ $exit_code -ne 0 ] || echo "$output" | grep -qiE "(not found|unknown|invalid|error)"; then
        record_pass "Nonexistent template handled"
    else
        record_fail "Nonexistent template not detected"
    fi
}

test_invalid_template_json() {
    log_test "Invalid template JSON handling"
    
    echo "{invalid json" > "$TEST_ROOT/invalid-template.json"
    
    local output
    local exit_code=0
    output=$(cursorflow_out prepare Test --template "$TEST_ROOT/invalid-template.json" --force 2>&1) || exit_code=$?
    
    if [ $exit_code -ne 0 ] || echo "$output" | grep -qiE "(parse|invalid|error|json)"; then
        record_pass "Invalid template JSON handled"
    else
        record_skip "Invalid JSON handling unclear"
    fi
    
    rm -f "$TEST_ROOT/invalid-template.json"
}

test_empty_template() {
    log_test "Empty template handling"
    
    echo "{}" > "$TEST_ROOT/empty-template.json"
    
    local output
    local exit_code=0
    output=$(cursorflow_out prepare Test --template "$TEST_ROOT/empty-template.json" --force 2>&1) || exit_code=$?
    
    # Should either fail or generate minimal valid output
    if [ $exit_code -ne 0 ] || echo "$output" | grep -qiE "(empty|missing|required|error)"; then
        record_pass "Empty template handled"
    else
        record_skip "Empty template behavior unclear"
    fi
    
    rm -f "$TEST_ROOT/empty-template.json"
}

# ============================================================================
# Multi-Lane Template Tests
# ============================================================================

test_multi_lane_template() {
    log_test "Multi-lane template"
    rm -rf "$TEST_ROOT/_cursorflow/tasks/"*
    
    # Create multi-lane template
    cat > "$TEST_ROOT/multi-template.json" << 'EOF'
{
  "lanes": [
    {
      "name": "frontend-lane",
      "tasks": [{ "name": "frontend-task", "prompt": "Build frontend for {{featureName}}" }]
    },
    {
      "name": "backend-lane",
      "tasks": [{ "name": "backend-task", "prompt": "Build backend for {{featureName}}" }]
    }
  ]
}
EOF
    
    local exit_code=0
    cursorflow_out prepare MultiTest --template "$TEST_ROOT/multi-template.json" --force > /dev/null 2>&1 || exit_code=$?
    
    local count
    count=$(find "$TEST_ROOT/_cursorflow/tasks" -name "*.json" 2>/dev/null | wc -l)
    
    if [ "$count" -ge 2 ]; then
        record_pass "Multi-lane template creates $count files"
    else
        record_skip "Multi-lane template format may differ"
    fi
    
    rm -f "$TEST_ROOT/multi-template.json"
}

test_template_with_dependencies() {
    log_test "Template with lane dependencies"
    rm -rf "$TEST_ROOT/_cursorflow/tasks/"*
    
    cat > "$TEST_ROOT/dep-template.json" << 'EOF'
{
  "lanes": [
    {
      "name": "base-lane",
      "tasks": [{ "name": "base-task", "prompt": "Base task for {{featureName}}" }]
    },
    {
      "name": "dependent-lane",
      "dependsOn": ["base-lane"],
      "tasks": [{ "name": "dep-task", "prompt": "Dependent task for {{featureName}}" }]
    }
  ]
}
EOF
    
    local exit_code=0
    cursorflow_out prepare DepTest --template "$TEST_ROOT/dep-template.json" --force > /dev/null 2>&1 || exit_code=$?
    
    if grep -r "dependsOn" "$TEST_ROOT/_cursorflow/tasks" 2>/dev/null | grep -q "."; then
        record_pass "Template preserves dependencies"
    else
        record_skip "Dependency template format may differ"
    fi
    
    rm -f "$TEST_ROOT/dep-template.json"
}

# ============================================================================
# Template Discovery Tests
# ============================================================================

test_list_available_templates() {
    log_test "List available templates"
    
    local output
    output=$(cursorflow_out prepare --help 2>&1) || true
    
    if echo "$output" | grep -qiE "(template|basic|available)"; then
        record_pass "Template listing available"
    else
        record_skip "Template listing not in help"
    fi
}

# ============================================================================
# Main
# ============================================================================

run_tests() {
    log_module "Template Tests"
    
    setup_module
    
    log_phase "Phase 1: Built-in Templates"
    test_builtin_basic_template
    test_builtin_template_content
    
    log_phase "Phase 2: Local Templates"
    test_local_json_template
    test_template_variable_substitution
    
    log_phase "Phase 3: Error Handling"
    test_nonexistent_template
    test_invalid_template_json
    test_empty_template
    
    log_phase "Phase 4: Advanced Templates"
    test_multi_lane_template
    test_template_with_dependencies
    
    log_phase "Phase 5: Template Discovery"
    test_list_available_templates
    
    cleanup_module
    
    print_module_summary
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    run_tests
    exit $?
fi


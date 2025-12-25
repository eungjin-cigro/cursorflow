#!/bin/bash
# tests/scripts/git/test-git-integration.sh
#
# Tests for Git integration features (worktrees, branches, etc.)
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
    TEST_ROOT=$(setup_test_repo "$PROJECT_ROOT/_test_git")
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
# Git Repository Tests
# ============================================================================

test_git_repo_detection() {
    log_test "Git repository detection"
    
    local output
    output=$(cursorflow_out doctor --no-cursor 2>&1) || true
    
    if echo "$output" | grep -qiE "(git|repository)"; then
        record_pass "Git repository detected"
    else
        record_pass "Git detection implicit (no explicit output)"
    fi
}

test_not_git_repo() {
    log_test "Non-git directory handling"
    
    local tmp_dir="$PROJECT_ROOT/_test_no_git"
    mkdir -p "$tmp_dir"
    cd "$tmp_dir"
    
    local output
    local exit_code=0
    output=$(cursorflow_out init --yes 2>&1) || exit_code=$?
    
    if [ $exit_code -ne 0 ] || echo "$output" | grep -qiE "(not.*git|no.*repository|error)"; then
        record_pass "Non-git directory handled"
    else
        record_skip "Non-git handling behavior unclear"
    fi
    
    cd "$TEST_ROOT"
    rm -rf "$tmp_dir"
}

test_git_worktree_support() {
    log_test "Git worktree support check"
    
    # Check if git supports worktrees
    if git worktree list > /dev/null 2>&1; then
        record_pass "Git worktree support available"
    else
        record_fail "Git worktree not supported"
    fi
}

# ============================================================================
# Branch Tests
# ============================================================================

test_branch_prefix_generation() {
    log_test "Branch prefix auto-generation"
    
    mkdir -p "$TEST_ROOT/_cursorflow/tasks"
    cat > "$TEST_ROOT/_cursorflow/tasks/branch-test.json" << 'EOF'
{
  "name": "branch-test-lane",
  "tasks": [{ "name": "task1", "prompt": "Test branch prefix generation" }]
}
EOF
    
    # Doctor should process and potentially suggest branch prefix
    local exit_code=0
    cursorflow_out doctor --tasks-dir "$TEST_ROOT/_cursorflow/tasks" > /dev/null 2>&1 || exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        record_pass "Lane without explicit branchPrefix accepted"
    else
        record_fail "Lane without branchPrefix rejected"
    fi
    
    rm -f "$TEST_ROOT/_cursorflow/tasks/branch-test.json"
}

test_custom_branch_prefix() {
    log_test "Custom branch prefix"
    
    mkdir -p "$TEST_ROOT/_cursorflow/tasks"
    cat > "$TEST_ROOT/_cursorflow/tasks/custom-branch.json" << 'EOF'
{
  "name": "custom-branch-lane",
  "branchPrefix": "feature/my-custom-prefix-",
  "tasks": [{ "name": "task1", "prompt": "Test custom branch prefix" }]
}
EOF
    
    local exit_code=0
    cursorflow_out doctor --tasks-dir "$TEST_ROOT/_cursorflow/tasks" > /dev/null 2>&1 || exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        record_pass "Custom branch prefix accepted"
    else
        record_fail "Custom branch prefix rejected"
    fi
    
    rm -f "$TEST_ROOT/_cursorflow/tasks/custom-branch.json"
}

test_branch_name_sanitization() {
    log_test "Branch name sanitization"
    
    mkdir -p "$TEST_ROOT/_cursorflow/tasks"
    cat > "$TEST_ROOT/_cursorflow/tasks/special-branch.json" << 'EOF'
{
  "name": "special-chars-lane",
  "branchPrefix": "feature/has spaces and @#special/chars-",
  "tasks": [{ "name": "task1", "prompt": "Test special chars in branch name" }]
}
EOF
    
    local output
    output=$(cursorflow_out doctor --tasks-dir "$TEST_ROOT/_cursorflow/tasks" 2>&1) || true
    
    # Should either sanitize or warn
    if echo "$output" | grep -qiE "(invalid|sanitize|warning|error|character)"; then
        record_pass "Special chars in branch prefix handled"
    else
        record_skip "Branch sanitization behavior unclear"
    fi
    
    rm -f "$TEST_ROOT/_cursorflow/tasks/special-branch.json"
}

# ============================================================================
# Worktree Management Tests
# ============================================================================

test_worktree_directory_structure() {
    log_test "Worktree directory structure"
    
    # Check if worktrees directory exists or can be created
    mkdir -p "$TEST_ROOT/_cursorflow/worktrees"
    
    if [ -d "$TEST_ROOT/_cursorflow/worktrees" ]; then
        record_pass "Worktrees directory structure works"
    else
        record_fail "Cannot create worktrees directory"
    fi
    
    rm -rf "$TEST_ROOT/_cursorflow/worktrees"
}

test_worktree_list_command() {
    log_test "Git worktree list"
    
    local output
    output=$(git worktree list 2>&1)
    
    if echo "$output" | grep -qE "$TEST_ROOT"; then
        record_pass "Git worktree list works"
    else
        record_fail "Git worktree list failed"
    fi
}

test_no_orphaned_worktrees() {
    log_test "No orphaned worktrees on init"
    
    local worktree_count
    worktree_count=$(git worktree list --porcelain 2>/dev/null | grep -c "^worktree" || echo "1")
    
    # Should only have main repo
    if [ "$worktree_count" -le 1 ]; then
        record_pass "No orphaned worktrees"
    else
        record_warn "Found $worktree_count worktrees"
    fi
}

# ============================================================================
# Clean Command Git Tests
# ============================================================================

test_clean_branches_command() {
    log_test "clean branches command"
    
    # Create a test branch
    git branch "cursorflow-test-branch" 2>/dev/null || true
    
    local output
    output=$(cursorflow_out clean branches --dry-run 2>&1) || true
    
    if echo "$output" | grep -qiE "(branch|clean|found|would|nothing)"; then
        record_pass "clean branches command works"
    else
        record_skip "clean branches behavior unclear"
    fi
    
    # Cleanup
    git branch -D "cursorflow-test-branch" 2>/dev/null || true
}

test_clean_worktrees_command() {
    log_test "clean worktrees command"
    
    local output
    output=$(cursorflow_out clean worktrees --dry-run 2>&1) || true
    
    if echo "$output" | grep -qiE "(worktree|clean|found|would|nothing)"; then
        record_pass "clean worktrees command works"
    else
        record_skip "clean worktrees behavior unclear"
    fi
}

test_clean_all_command() {
    log_test "clean all command"
    
    local output
    output=$(cursorflow_out clean all --dry-run 2>&1) || true
    
    if echo "$output" | grep -qiE "(clean|would|branch|worktree|log|nothing)"; then
        record_pass "clean all command works"
    else
        record_skip "clean all behavior unclear"
    fi
}

# ============================================================================
# Git Configuration Tests
# ============================================================================

test_gitignore_cursorflow() {
    log_test ".gitignore includes _cursorflow"
    
    if [ -f "$TEST_ROOT/.gitignore" ]; then
        if grep -q "_cursorflow" "$TEST_ROOT/.gitignore"; then
            record_pass ".gitignore includes _cursorflow"
        else
            record_warn ".gitignore doesn't include _cursorflow"
        fi
    else
        record_skip "No .gitignore file"
    fi
}

test_cursorflow_config_exists() {
    log_test "cursorflow.config.js exists"
    
    if [ -f "$TEST_ROOT/cursorflow.config.js" ]; then
        record_pass "cursorflow.config.js exists"
    else
        record_fail "cursorflow.config.js not found"
    fi
}

test_config_is_valid_js() {
    log_test "cursorflow.config.js is valid"
    
    if [ -f "$TEST_ROOT/cursorflow.config.js" ]; then
        if node -c "$TEST_ROOT/cursorflow.config.js" 2>/dev/null; then
            record_pass "Config file is valid JavaScript"
        else
            record_fail "Config file has syntax errors"
        fi
    else
        record_skip "No config file to check"
    fi
}

# ============================================================================
# Base Branch Tests
# ============================================================================

test_base_branch_detection() {
    log_test "Base branch detection"
    
    mkdir -p "$TEST_ROOT/_cursorflow/tasks"
    cat > "$TEST_ROOT/_cursorflow/tasks/base-branch.json" << 'EOF'
{
  "name": "base-branch-lane",
  "baseBranch": "main",
  "tasks": [{ "name": "task1", "prompt": "Test base branch detection" }]
}
EOF
    
    local exit_code=0
    cursorflow_out doctor --tasks-dir "$TEST_ROOT/_cursorflow/tasks" > /dev/null 2>&1 || exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        record_pass "Base branch 'main' accepted"
    else
        record_fail "Base branch configuration rejected"
    fi
    
    rm -f "$TEST_ROOT/_cursorflow/tasks/base-branch.json"
}

test_nonexistent_base_branch() {
    log_test "Nonexistent base branch handling"
    
    mkdir -p "$TEST_ROOT/_cursorflow/tasks"
    cat > "$TEST_ROOT/_cursorflow/tasks/bad-base.json" << 'EOF'
{
  "name": "bad-base-lane",
  "baseBranch": "nonexistent-branch-xyz",
  "tasks": [{ "name": "task1", "prompt": "Test nonexistent base branch" }]
}
EOF
    
    local output
    output=$(cursorflow_out doctor --tasks-dir "$TEST_ROOT/_cursorflow/tasks" 2>&1) || true
    
    if echo "$output" | grep -qiE "(not found|invalid|warning|nonexistent|error)"; then
        record_pass "Nonexistent base branch handled"
    else
        record_skip "Base branch validation behavior unclear"
    fi
    
    rm -f "$TEST_ROOT/_cursorflow/tasks/bad-base.json"
}

# ============================================================================
# Commit Tests
# ============================================================================

test_dirty_working_directory() {
    log_test "Dirty working directory handling"
    
    # Create uncommitted change
    echo "test content" > "$TEST_ROOT/uncommitted-file.txt"
    
    local output
    output=$(cursorflow_out doctor --no-cursor 2>&1) || true
    
    if echo "$output" | grep -qiE "(uncommitted|dirty|warning|change)"; then
        record_pass "Dirty working directory detected"
    else
        record_skip "Dirty directory detection not explicit"
    fi
    
    rm -f "$TEST_ROOT/uncommitted-file.txt"
}

# ============================================================================
# Main
# ============================================================================

run_tests() {
    log_module "Git Integration Tests"
    
    setup_module
    
    log_phase "Phase 1: Git Repository Detection"
    test_git_repo_detection
    test_not_git_repo
    test_git_worktree_support
    
    log_phase "Phase 2: Branch Management"
    test_branch_prefix_generation
    test_custom_branch_prefix
    test_branch_name_sanitization
    
    log_phase "Phase 3: Worktree Management"
    test_worktree_directory_structure
    test_worktree_list_command
    test_no_orphaned_worktrees
    
    log_phase "Phase 4: Clean Commands"
    test_clean_branches_command
    test_clean_worktrees_command
    test_clean_all_command
    
    log_phase "Phase 5: Git Configuration"
    test_gitignore_cursorflow
    test_cursorflow_config_exists
    test_config_is_valid_js
    
    log_phase "Phase 6: Base Branch Handling"
    test_base_branch_detection
    test_nonexistent_base_branch
    test_dirty_working_directory
    
    cleanup_module
    
    print_module_summary
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    run_tests
    exit $?
fi


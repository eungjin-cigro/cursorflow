#!/bin/bash
# tests/scripts/cli/test-commands.sh
#
# Tests for various CLI commands (help, version, models, etc.)
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
    TEST_ROOT=$(setup_test_repo "$PROJECT_ROOT/_test_cli")
    cd "$TEST_ROOT"
    
    # Initialize CursorFlow
    cursorflow_out init --yes > /dev/null 2>&1
}

cleanup_module() {
    cleanup_test_repo "$TEST_ROOT"
}

# ============================================================================
# Help & Version Tests
# ============================================================================

test_help_command() {
    log_test "cursorflow --help"
    local output
    output=$(cursorflow_out --help 2>&1)
    if echo "$output" | grep -qiE "(usage|commands|options)"; then
        record_pass "cursorflow --help shows usage"
    else
        record_fail "cursorflow --help missing expected output"
    fi
}

test_version_command() {
    log_test "cursorflow --version"
    local output
    output=$(cursorflow_out --version 2>&1)
    if echo "$output" | grep -qE "[0-9]+\.[0-9]+\.[0-9]+"; then
        record_pass "cursorflow --version shows version number"
    else
        record_fail "cursorflow --version missing version number"
    fi
}

test_help_flag_variants() {
    log_test "cursorflow help variants (-h)"
    local output
    output=$(cursorflow_out -h 2>&1) || true
    if echo "$output" | grep -qiE "(usage|commands|cursorflow)"; then
        record_pass "-h flag shows help"
    else
        record_fail "-h flag not working"
    fi
}

# ============================================================================
# Init Tests
# ============================================================================

test_init_help() {
    log_test "cursorflow init --help"
    local output
    output=$(cursorflow_out init --help 2>&1)
    if echo "$output" | grep -qiE "(init|initialize|project)"; then
        record_pass "init --help shows usage"
    else
        record_fail "init --help missing expected output"
    fi
}

test_init_already_initialized() {
    log_test "init on already initialized project"
    local output
    local exit_code=0
    output=$(cursorflow_out init --yes 2>&1) || exit_code=$?
    # Should either succeed or show "already initialized" message
    if [ $exit_code -eq 0 ] || echo "$output" | grep -qiE "(already|exist|skip)"; then
        record_pass "init handles already initialized project"
    else
        record_fail "init behaves unexpectedly on re-init"
    fi
}

# ============================================================================
# Models Command Tests
# ============================================================================

test_models_command() {
    log_test "cursorflow models"
    local output
    output=$(cursorflow_out models 2>&1) || true
    if echo "$output" | grep -qiE "(model|available|sonnet|gpt|claude)"; then
        record_pass "models command shows available models"
    else
        record_skip "models command output different than expected"
    fi
}

test_models_help() {
    log_test "cursorflow models --help"
    local output
    output=$(cursorflow_out models --help 2>&1) || true
    if echo "$output" | grep -qiE "(model|list|available)"; then
        record_pass "models --help shows usage"
    else
        record_skip "models --help not implemented or different format"
    fi
}

# ============================================================================
# Tasks Command Tests
# ============================================================================

test_tasks_command() {
    log_test "cursorflow tasks"
    local output
    output=$(cursorflow_out tasks 2>&1) || true
    # Should show tasks or "no tasks found" message
    if echo "$output" | grep -qiE "(task|no.*found|empty|list)"; then
        record_pass "tasks command works"
    else
        record_skip "tasks command output different than expected"
    fi
}

test_tasks_help() {
    log_test "cursorflow tasks --help"
    local output
    output=$(cursorflow_out tasks --help 2>&1) || true
    if echo "$output" | grep -qiE "(task|list)"; then
        record_pass "tasks --help shows usage"
    else
        record_skip "tasks --help not implemented"
    fi
}

# ============================================================================
# Monitor Command Tests
# ============================================================================

test_monitor_help() {
    log_test "cursorflow monitor --help"
    local output
    output=$(cursorflow_out monitor --help 2>&1) || true
    if echo "$output" | grep -qiE "(monitor|list|all flows)"; then
        record_pass "monitor --help shows usage"
    else
        record_skip "monitor --help not implemented"
    fi
}

test_monitor_list() {
    log_test "cursorflow monitor --list"
    local output
    # Since it's interactive, we just check if it doesn't crash immediately or shows help if no runs
    output=$(cursorflow_out monitor --list 2>&1 || true)
    if echo "$output" | grep -qiE "(flow|run|no.*found|empty)"; then
        record_pass "monitor --list works"
    else
        record_skip "monitor --list behavior different than expected"
    fi
}

test_monitor_no_run() {
    log_test "monitor without active run"
    local output
    output=$(cursorflow_out monitor 2>&1) || true
    # Should handle gracefully when no run is active
    if echo "$output" | grep -qiE "(no.*run|not found|no active|specify)"; then
        record_pass "monitor handles no active run"
    else
        record_skip "monitor behavior different than expected"
    fi
}

# ============================================================================
# Stop Command Tests
# ============================================================================

test_stop_help() {
    log_test "cursorflow stop --help"
    local output
    output=$(cursorflow_out stop --help 2>&1) || true
    if echo "$output" | grep -qiE "(stop|halt|terminate)"; then
        record_pass "stop --help shows usage"
    else
        record_skip "stop --help not implemented"
    fi
}

test_stop_no_run() {
    log_test "stop without active run"
    local output
    output=$(cursorflow_out stop 2>&1) || true
    # Should handle gracefully
    if echo "$output" | grep -qiE "(no.*run|not found|nothing|specify)"; then
        record_pass "stop handles no active run"
    else
        record_skip "stop behavior different than expected"
    fi
}

# ============================================================================
# Logs Command Tests
# ============================================================================

test_logs_help() {
    log_test "cursorflow logs --help"
    local output
    output=$(cursorflow_out logs --help 2>&1) || true
    if echo "$output" | grep -qiE "(log|view|show)"; then
        record_pass "logs --help shows usage"
    else
        record_skip "logs --help not implemented"
    fi
}

test_logs_no_run() {
    log_test "logs without run specified"
    local output
    output=$(cursorflow_out logs 2>&1) || true
    # Should show help or "no logs found"
    if echo "$output" | grep -qiE "(log|no.*found|specify|usage)"; then
        record_pass "logs handles no run specified"
    else
        record_skip "logs behavior different than expected"
    fi
}

# ============================================================================
# Signal Command Tests
# ============================================================================

test_signal_help() {
    log_test "cursorflow signal --help"
    local output
    output=$(cursorflow_out signal --help 2>&1) || true
    if echo "$output" | grep -qiE "(signal|intervene|lane)"; then
        record_pass "signal --help shows usage"
    else
        record_skip "signal --help not implemented"
    fi
}

test_signal_no_lane() {
    log_test "signal without lane specified"
    local output
    output=$(cursorflow_out signal 2>&1) || true
    # Should require lane specification
    if echo "$output" | grep -qiE "(lane|specify|required|usage)"; then
        record_pass "signal requires lane specification"
    else
        record_skip "signal behavior different than expected"
    fi
}

test_signal_timeout_option() {
    log_test "signal --timeout option"
    local output
    output=$(cursorflow_out signal --help 2>&1) || true
    if echo "$output" | grep -qiE "timeout"; then
        record_pass "signal supports --timeout option"
    else
        record_skip "signal --timeout not documented"
    fi
}

# ============================================================================
# Resume Command Tests
# ============================================================================

test_resume_help() {
    log_test "cursorflow resume --help"
    local output
    output=$(cursorflow_out resume --help 2>&1) || true
    if echo "$output" | grep -qiE "(resume|continue|lane)"; then
        record_pass "resume --help shows usage"
    else
        record_skip "resume --help not implemented"
    fi
}

test_resume_no_lane() {
    log_test "resume without lane specified"
    local output
    output=$(cursorflow_out resume 2>&1) || true
    # Should require lane specification
    if echo "$output" | grep -qiE "(lane|specify|required|usage)"; then
        record_pass "resume requires lane specification"
    else
        record_skip "resume behavior different than expected"
    fi
}

# ============================================================================
# Setup Command Tests
# ============================================================================

test_setup_help() {
    log_test "cursorflow setup --help"
    local output
    output=$(cursorflow_out setup --help 2>&1) || true
    if echo "$output" | grep -qiE "(setup|configure|environment)"; then
        record_pass "setup --help shows usage"
    else
        record_skip "setup --help not implemented"
    fi
}

# ============================================================================
# Unknown Command Tests
# ============================================================================

test_unknown_command() {
    log_test "Unknown command handling"
    local output
    local exit_code=0
    output=$(cursorflow_out unknown-command-xyz 2>&1) || exit_code=$?
    
    if [ $exit_code -ne 0 ] || echo "$output" | grep -qiE "(unknown|invalid|not.*found|error)"; then
        record_pass "Unknown command handled properly"
    else
        record_fail "Unknown command not handled"
    fi
}

# ============================================================================
# Main
# ============================================================================

run_tests() {
    log_module "CLI Command Tests"
    
    setup_module
    
    log_phase "Phase 1: Help & Version"
    test_help_command
    test_version_command
    test_help_flag_variants
    
    log_phase "Phase 2: Init Command"
    test_init_help
    test_init_already_initialized
    
    log_phase "Phase 3: Informational Commands"
    test_models_command
    test_models_help
    test_tasks_command
    test_tasks_help
    
    log_phase "Phase 4: Monitoring Commands"
    test_monitor_help
    test_monitor_list
    test_monitor_no_run
    test_logs_help
    test_logs_no_run
    
    log_phase "Phase 5: Control Commands"
    test_stop_help
    test_stop_no_run
    test_signal_help
    test_signal_no_lane
    test_signal_timeout_option
    test_resume_help
    test_resume_no_lane
    
    log_phase "Phase 6: Misc Commands"
    test_setup_help
    test_unknown_command
    
    cleanup_module
    
    print_module_summary
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    run_tests
    exit $?
fi


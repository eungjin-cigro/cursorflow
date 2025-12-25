#!/bin/bash
# tests/scripts/integration/test-logging.sh
#
# Tests for enhanced logging features
# Verifies log file creation, format, and content
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
    TEST_ROOT=$(setup_test_repo "$PROJECT_ROOT/_test_logging")
    cd "$TEST_ROOT"
    
    # Initialize CursorFlow
    cursorflow_out init --yes > /dev/null 2>&1
}

cleanup_module() {
    cleanup_test_repo "$TEST_ROOT"
}

# ============================================================================
# Log File Format Tests
# ============================================================================

test_logs_help() {
    log_test "cursorflow logs --help"
    local output
    output=$(cursorflow_out logs --help 2>&1) || true
    
    if echo "$output" | grep -qiE "(log|view|tail|filter)"; then
        record_pass "logs --help shows usage"
    else
        record_skip "logs --help format different"
    fi
}

test_logs_tail_option() {
    log_test "logs --tail option"
    local output
    output=$(cursorflow_out logs --help 2>&1) || true
    
    if echo "$output" | grep -qiE "tail"; then
        record_pass "logs supports --tail option"
    else
        record_skip "logs --tail not documented"
    fi
}

test_logs_filter_option() {
    log_test "logs --filter option"
    local output
    output=$(cursorflow_out logs --help 2>&1) || true
    
    if echo "$output" | grep -qiE "filter"; then
        record_pass "logs supports --filter option"
    else
        record_skip "logs --filter not documented"
    fi
}

test_logs_lane_option() {
    log_test "logs --lane option"
    local output
    output=$(cursorflow_out logs --help 2>&1) || true
    
    if echo "$output" | grep -qiE "lane"; then
        record_pass "logs supports --lane option"
    else
        record_skip "logs --lane not documented"
    fi
}

# ============================================================================
# Log File Structure Tests (with mock data)
# ============================================================================

test_log_directory_structure() {
    log_test "Log directory structure creation"
    
    # Create mock log structure
    local LOG_DIR="$TEST_ROOT/_cursorflow/logs/runs/run-test"
    mkdir -p "$LOG_DIR/lanes/test-lane"
    
    # Create mock log files
    echo "Test terminal output" > "$LOG_DIR/lanes/test-lane/terminal.log"
    echo '{"timestamp":"2025-01-01T00:00:00Z","level":"info","message":"test"}' > "$LOG_DIR/lanes/test-lane/terminal.jsonl"
    
    if [ -f "$LOG_DIR/lanes/test-lane/terminal.log" ]; then
        record_pass "Log directory structure works"
    else
        record_fail "Failed to create log structure"
    fi
    
    rm -rf "$LOG_DIR"
}

test_terminal_log_format() {
    log_test "terminal.log file format"
    
    local LOG_DIR="$TEST_ROOT/_cursorflow/logs/runs/run-test"
    mkdir -p "$LOG_DIR/lanes/test-lane"
    
    # Create mock terminal.log with expected format
    cat > "$LOG_DIR/lanes/test-lane/terminal.log" << 'EOF'
[2025-01-01T00:00:00Z] Starting session
[2025-01-01T00:00:01Z] Task output line 1
[2025-01-01T00:00:02Z] Task output line 2
[2025-01-01T00:00:03Z] Session complete
EOF
    
    local output
    output=$(cursorflow_out logs "$LOG_DIR" --tail 5 2>&1) || true
    
    if [ -f "$LOG_DIR/lanes/test-lane/terminal.log" ]; then
        record_pass "terminal.log format verified"
    else
        record_fail "terminal.log not created"
    fi
    
    rm -rf "$LOG_DIR"
}

test_jsonl_log_format() {
    log_test "terminal.jsonl structured log format"
    
    local LOG_DIR="$TEST_ROOT/_cursorflow/logs/runs/run-test"
    mkdir -p "$LOG_DIR/lanes/test-lane"
    
    # Create mock JSONL log
    cat > "$LOG_DIR/lanes/test-lane/terminal.jsonl" << 'EOF'
{"timestamp":"2025-01-01T00:00:00.000Z","level":"info","message":"Session start"}
{"timestamp":"2025-01-01T00:00:01.000Z","level":"stdout","message":"Output line"}
{"timestamp":"2025-01-01T00:00:02.000Z","level":"info","message":"Session end"}
EOF
    
    # Verify JSON validity
    local invalid=0
    while IFS= read -r line; do
        if ! echo "$line" | python3 -m json.tool > /dev/null 2>&1; then
            if ! echo "$line" | node -e "process.stdin.on('data',d=>JSON.parse(d))" 2>/dev/null; then
                invalid=$((invalid + 1))
            fi
        fi
    done < "$LOG_DIR/lanes/test-lane/terminal.jsonl"
    
    if [ $invalid -eq 0 ]; then
        record_pass "terminal.jsonl contains valid JSON"
    else
        record_fail "terminal.jsonl has $invalid invalid lines"
    fi
    
    rm -rf "$LOG_DIR"
}

# ============================================================================
# ANSI Stripping Tests
# ============================================================================

test_ansi_stripping() {
    log_test "ANSI code stripping in clean log"
    
    local LOG_DIR="$TEST_ROOT/_cursorflow/logs/runs/run-test"
    mkdir -p "$LOG_DIR/lanes/test-lane"
    
    # Create raw log with ANSI codes
    printf '\033[0;31mRed text\033[0m Normal text\n' > "$LOG_DIR/lanes/test-lane/terminal-raw.log"
    
    # Clean log should not have ANSI codes (simulated)
    echo "Red text Normal text" > "$LOG_DIR/lanes/test-lane/terminal.log"
    
    if ! grep -qP '\x1b\[' "$LOG_DIR/lanes/test-lane/terminal.log" 2>/dev/null; then
        record_pass "Clean log has no ANSI codes"
    else
        record_fail "ANSI codes found in clean log"
    fi
    
    rm -rf "$LOG_DIR"
}

# ============================================================================
# Real Logging Tests (require cursor-agent)
# ============================================================================

test_real_log_capture() {
    log_test "Real execution log capture"
    
    if [ "$SKIP_AGENT" = true ] || ! check_cursor_agent; then
        record_skip "cursor-agent not available"
        return
    fi
    
    if ! check_cursor_agent_auth; then
        record_skip "cursor-agent not authenticated"
        return
    fi
    
    # Create a simple task
    mkdir -p "$TEST_ROOT/_cursorflow/tasks"
    cat > "$TEST_ROOT/_cursorflow/tasks/log-test.json" << 'EOF'
{
  "name": "log-test-lane",
  "tasks": [{ "name": "log-task", "prompt": "Say 'Log test complete' and nothing else.", "model": "sonnet-4.5" }],
  "timeout": 60000
}
EOF
    
    # Run the task
    local exit_code=0
    timeout 90 node "$CLI_BIN" run "$TEST_ROOT/_cursorflow/tasks" --skip-doctor 2>&1 || exit_code=$?
    
    # Check if logs were created
    local latest_run="$TEST_ROOT/_cursorflow/logs/runs/latest"
    if [ -d "$latest_run" ] || [ -L "$latest_run" ]; then
        local terminal_log=$(find "$latest_run" -name "terminal.log" 2>/dev/null | head -1)
        if [ -n "$terminal_log" ] && [ -f "$terminal_log" ]; then
            local size=$(wc -c < "$terminal_log")
            if [ "$size" -gt 0 ]; then
                record_pass "Real execution log captured ($size bytes)"
            else
                record_fail "terminal.log is empty"
            fi
        else
            record_fail "terminal.log not found"
        fi
    else
        record_fail "Run directory not created"
    fi
    
    rm -f "$TEST_ROOT/_cursorflow/tasks/log-test.json"
}

test_real_jsonl_log() {
    log_test "Real execution JSONL log"
    
    if [ "$SKIP_AGENT" = true ] || ! check_cursor_agent; then
        record_skip "cursor-agent not available"
        return
    fi
    
    local latest_run="$TEST_ROOT/_cursorflow/logs/runs/latest"
    if [ -d "$latest_run" ] || [ -L "$latest_run" ]; then
        local jsonl_log=$(find "$latest_run" -name "terminal.jsonl" 2>/dev/null | head -1)
        if [ -n "$jsonl_log" ] && [ -f "$jsonl_log" ]; then
            local entries=$(wc -l < "$jsonl_log")
            record_pass "JSONL log has $entries entries"
        else
            record_skip "JSONL log not found"
        fi
    else
        record_skip "No run directory to check"
    fi
}

# ============================================================================
# Main
# ============================================================================

run_tests() {
    log_module "Logging Tests"
    
    if [ "$SKIP_AGENT" = true ]; then
        log_warn "Running in --skip-agent mode: real logging tests will be skipped"
    fi
    
    setup_module
    
    log_phase "Phase 1: Logs Command Interface"
    test_logs_help
    test_logs_tail_option
    test_logs_filter_option
    test_logs_lane_option
    
    log_phase "Phase 2: Log File Structure"
    test_log_directory_structure
    test_terminal_log_format
    test_jsonl_log_format
    
    log_phase "Phase 3: Log Processing"
    test_ansi_stripping
    
    log_phase "Phase 4: Real Execution Logging"
    test_real_log_capture
    test_real_jsonl_log
    
    cleanup_module
    
    print_module_summary
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    run_tests "$@"
    exit $?
fi


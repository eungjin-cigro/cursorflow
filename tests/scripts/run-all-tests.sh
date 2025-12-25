#!/bin/bash
# tests/scripts/run-all-tests.sh
#
# Main test runner for CursorFlow
# Runs all test modules or specific ones based on arguments
#
# Usage:
#   ./run-all-tests.sh                    # Run all tests
#   ./run-all-tests.sh --quick            # Run quick tests only (no cursor-agent)
#   ./run-all-tests.sh --module cli       # Run only CLI tests
#   ./run-all-tests.sh --list             # List available modules
#   ./run-all-tests.sh --help             # Show help
#

set -e

# Source helpers
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common/helpers.sh"

# ============================================================================
# Configuration
# ============================================================================

# Available test modules
declare -A TEST_MODULES=(
    ["cli-doctor"]="$SCRIPT_DIR/cli/test-doctor.sh"
    ["cli-commands"]="$SCRIPT_DIR/cli/test-commands.sh"
    ["prepare"]="$SCRIPT_DIR/prepare/test-prepare.sh"
    ["validation"]="$SCRIPT_DIR/validation/test-edge-cases.sh"
    ["templates"]="$SCRIPT_DIR/templates/test-templates.sh"
    ["git"]="$SCRIPT_DIR/git/test-git-integration.sh"
    ["integration-lifecycle"]="$SCRIPT_DIR/integration/test-lifecycle.sh"
    ["integration-logging"]="$SCRIPT_DIR/integration/test-logging.sh"
    ["integration-parallel"]="$SCRIPT_DIR/integration/test-parallel.sh"
)

# Quick test modules (no cursor-agent required)
QUICK_MODULES=(
    "cli-doctor"
    "cli-commands"
    "prepare"
    "validation"
    "templates"
    "git"
)

# Full test modules (including those requiring cursor-agent)
FULL_MODULES=(
    "cli-doctor"
    "cli-commands"
    "prepare"
    "validation"
    "templates"
    "git"
    "integration-lifecycle"
    "integration-logging"
    "integration-parallel"
)

# ============================================================================
# Arguments
# ============================================================================

QUICK_MODE=false
SKIP_AGENT=false
SELECTED_MODULES=()
VERBOSE=false

show_help() {
    cat << 'EOF'
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  🧪 CursorFlow Test Runner
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Usage: ./run-all-tests.sh [OPTIONS]

Options:
  --quick           Run quick tests only (no cursor-agent required)
  --skip-agent      Skip tests that require cursor-agent
  --module <name>   Run only the specified module (can be repeated)
  --list            List all available test modules
  --verbose         Show verbose output
  --help            Show this help message

Available Modules:
  cli-doctor        Doctor command and validation tests
  cli-commands      CLI command interface tests
  prepare           Task preparation tests
  validation        Edge cases and bug scenario tests
  templates         Template loading tests
  git               Git integration tests
  integration-*     Integration tests (require cursor-agent)
    - lifecycle     Full lifecycle integration tests
    - logging       Logging feature tests
    - parallel      Parallel execution tests

Examples:
  ./run-all-tests.sh                           # Run all tests
  ./run-all-tests.sh --quick                   # Run quick tests only
  ./run-all-tests.sh --module cli-doctor       # Run only doctor tests
  ./run-all-tests.sh --module cli-doctor --module prepare
  ./run-all-tests.sh --skip-agent              # Run all, skip agent tests

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
}

list_modules() {
    echo ""
    echo "Available Test Modules:"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Quick modules (no cursor-agent):"
    for module in "${QUICK_MODULES[@]}"; do
        echo "  • $module"
    done
    echo ""
    echo "Integration modules (may require cursor-agent):"
    echo "  • integration-lifecycle"
    echo "  • integration-logging"
    echo "  • integration-parallel"
    echo ""
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --quick)
                QUICK_MODE=true
                shift
                ;;
            --skip-agent)
                SKIP_AGENT=true
                shift
                ;;
            --module)
                if [[ -n "$2" && ! "$2" =~ ^-- ]]; then
                    SELECTED_MODULES+=("$2")
                    shift 2
                else
                    echo "Error: --module requires a module name"
                    exit 1
                fi
                ;;
            --list)
                list_modules
                exit 0
                ;;
            --verbose)
                VERBOSE=true
                shift
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            *)
                echo "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
        esac
    done
}

# ============================================================================
# Main Logic
# ============================================================================

run_module() {
    local module_name="$1"
    local module_script="${TEST_MODULES[$module_name]}"
    
    if [[ -z "$module_script" ]]; then
        log_fail "Unknown module: $module_name"
        return 1
    fi
    
    if [[ ! -f "$module_script" ]]; then
        log_fail "Module script not found: $module_script"
        return 1
    fi
    
    # Make executable
    chmod +x "$module_script"
    
    # Build agent args
    local agent_args=""
    if [[ "$SKIP_AGENT" == true ]]; then
        agent_args="--skip-agent"
    fi
    
    # Run module
    if "$module_script" $agent_args; then
        return 0
    else
        return 1
    fi
}

main() {
    parse_args "$@"
    
    # Build CursorFlow first
    log_header "🧪 CursorFlow Test Suite"
    
    echo -e "${YELLOW}Building CursorFlow...${NC}"
    cd "$PROJECT_ROOT"
    npm run build > /dev/null 2>&1
    echo -e "${GREEN}✓ Build complete${NC}"
    
    # Determine which modules to run
    local modules_to_run=()
    
    if [[ ${#SELECTED_MODULES[@]} -gt 0 ]]; then
        # Run only selected modules
        modules_to_run=("${SELECTED_MODULES[@]}")
    elif [[ "$QUICK_MODE" == true ]]; then
        # Run quick modules only
        modules_to_run=("${QUICK_MODULES[@]}")
        SKIP_AGENT=true
    else
        # Run all modules
        modules_to_run=("${FULL_MODULES[@]}")
    fi
    
    # Display run info
    echo ""
    echo -e "${CYAN}Running ${#modules_to_run[@]} test module(s)${NC}"
    if [[ "$SKIP_AGENT" == true ]]; then
        echo -e "${YELLOW}(cursor-agent tests will be skipped)${NC}"
    fi
    echo ""
    
    # Track overall results
    local total_passed=0
    local total_failed=0
    local total_skipped=0
    local failed_modules=()
    
    # Run each module
    for module in "${modules_to_run[@]}"; do
        # Reset counters for this module
        reset_counters
        
        echo ""
        echo -e "${BOLD}════════════════════════════════════════════════════════════════════════════════${NC}"
        echo -e "${BOLD}  Running: $module${NC}"
        echo -e "${BOLD}════════════════════════════════════════════════════════════════════════════════${NC}"
        
        if run_module "$module"; then
            total_passed=$((total_passed + TESTS_PASSED))
            total_failed=$((total_failed + TESTS_FAILED))
            total_skipped=$((total_skipped + TESTS_SKIPPED))
        else
            failed_modules+=("$module")
            total_passed=$((total_passed + TESTS_PASSED))
            total_failed=$((total_failed + TESTS_FAILED))
            total_skipped=$((total_skipped + TESTS_SKIPPED))
        fi
    done
    
    # Final summary
    TESTS_PASSED=$total_passed
    TESTS_FAILED=$total_failed
    TESTS_SKIPPED=$total_skipped
    
    echo ""
    echo ""
    log_header "🏁 Final Test Summary"
    
    echo -e "  ${CYAN}Modules Run:${NC}    ${#modules_to_run[@]}"
    if [[ ${#failed_modules[@]} -gt 0 ]]; then
        echo -e "  ${RED}Modules Failed:${NC} ${#failed_modules[@]}"
        for fm in "${failed_modules[@]}"; do
            echo -e "    ${RED}• $fm${NC}"
        done
    fi
    echo ""
    echo -e "  ${GREEN}✓ Tests Passed:${NC}  $total_passed"
    echo -e "  ${RED}✗ Tests Failed:${NC}  $total_failed"
    echo -e "  ${DIM}○ Tests Skipped:${NC} $total_skipped"
    echo -e "  ${BOLD}──────────────────${NC}"
    echo -e "  ${BOLD}Total:${NC}            $((total_passed + total_failed + total_skipped))"
    echo ""
    
    if [[ $total_failed -gt 0 ]]; then
        echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${RED}  ❌ SOME TESTS FAILED${NC}"
        echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        exit 1
    else
        echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${GREEN}  ✅ ALL TESTS PASSED${NC}"
        echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        exit 0
    fi
}

# Run main
main "$@"


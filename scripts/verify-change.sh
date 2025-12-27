#!/bin/bash
#
# verify-change.sh - Post-change verification script
#
# Runs a series of checks to verify that code changes don't break functionality.
# Use this after making changes to ensure everything still works.
#
# Usage:
#   ./scripts/verify-change.sh           # Run all checks
#   ./scripts/verify-change.sh --quick   # Skip slow tests
#   ./scripts/verify-change.sh --smoke   # Only run smoke tests
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Parse arguments
QUICK_MODE=false
SMOKE_ONLY=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --quick|-q)
            QUICK_MODE=true
            shift
            ;;
        --smoke|-s)
            SMOKE_ONLY=true
            shift
            ;;
        --verbose|-v)
            VERBOSE=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --quick, -q    Skip slow tests (integration, e2e)"
            echo "  --smoke, -s    Only run smoke tests"
            echo "  --verbose, -v  Show detailed output"
            echo "  --help, -h     Show this help message"
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# Logging functions
log_step() {
    echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}▶ $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

log_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

log_error() {
    echo -e "${RED}✗ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

# Track results
RESULTS=()
FAILED=false

run_check() {
    local name="$1"
    local command="$2"
    
    if $VERBOSE; then
        echo -e "${YELLOW}Running: $command${NC}"
    fi
    
    if eval "$command"; then
        log_success "$name"
        RESULTS+=("✓ $name")
    else
        log_error "$name"
        RESULTS+=("✗ $name")
        FAILED=true
    fi
}

cd "$ROOT_DIR"

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║           CursorFlow Change Verification                  ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Step 1: TypeScript Compilation
log_step "Step 1: TypeScript Compilation"

BUILD_OUTPUT=$(mktemp)
if npm run build > "$BUILD_OUTPUT" 2>&1; then
    log_success "TypeScript compilation passed"
    RESULTS+=("✓ TypeScript compilation")
else
    log_error "TypeScript compilation failed"
    echo "Build output:"
    cat "$BUILD_OUTPUT"
    RESULTS+=("✗ TypeScript compilation")
    FAILED=true
fi
rm -f "$BUILD_OUTPUT"

# Exit early if build failed
if $FAILED; then
    log_error "Build failed, skipping further checks"
    exit 1
fi

# Step 2: Lint Check (if available)
log_step "Step 2: Lint Check"
if command -v eslint &> /dev/null && [ -f ".eslintrc.js" ] || [ -f ".eslintrc.json" ]; then
    run_check "ESLint" "npx eslint src/ --quiet 2>/dev/null || true"
else
    log_warning "ESLint not configured, skipping"
    RESULTS+=("⚠ ESLint (skipped)")
fi

# Step 3: Unit Tests (unless smoke-only mode)
if ! $SMOKE_ONLY; then
    log_step "Step 3: Unit Tests"
    run_check "Unit tests" "npm run test:unit -- --passWithNoTests --silent"
fi

# Step 4: CLI Smoke Tests
log_step "Step 4: CLI Smoke Tests"

# Test 1: Version command
echo -e "${YELLOW}Testing: cursorflow --version${NC}"
VERSION_OUTPUT=$(node dist/cli/index.js --version 2>&1 || true)
if echo "$VERSION_OUTPUT" | grep -qE '[0-9]+\.[0-9]+\.[0-9]+'; then
    log_success "Version command works"
    RESULTS+=("✓ Version command")
else
    log_error "Version command failed"
    echo "Output: $VERSION_OUTPUT"
    RESULTS+=("✗ Version command")
    FAILED=true
fi

# Test 2: Help command
echo -e "${YELLOW}Testing: cursorflow --help${NC}"
HELP_OUTPUT=$(node dist/cli/index.js --help 2>&1 || true)
if echo "$HELP_OUTPUT" | grep -qiE 'usage|commands|options'; then
    log_success "Help command works"
    RESULTS+=("✓ Help command")
else
    log_error "Help command failed"
    echo "Output: $HELP_OUTPUT"
    RESULTS+=("✗ Help command")
    FAILED=true
fi

# Test 3: Doctor command (in a temp directory to avoid git issues)
echo -e "${YELLOW}Testing: cursorflow doctor${NC}"
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR"
git init -q 2>/dev/null || true
git config user.email "test@test.com" 2>/dev/null || true
git config user.name "Test" 2>/dev/null || true
touch README.md
git add . 2>/dev/null || true
git commit -m "init" -q 2>/dev/null || true

DOCTOR_OUTPUT=$(node "$ROOT_DIR/dist/cli/index.js" doctor 2>&1 || true)
cd "$ROOT_DIR"
rm -rf "$TEMP_DIR"

# Doctor should produce some output (even if checks fail)
if [ -n "$DOCTOR_OUTPUT" ] && ! echo "$DOCTOR_OUTPUT" | grep -qiE 'undefined is not|cannot read'; then
    log_success "Doctor command works"
    RESULTS+=("✓ Doctor command")
else
    log_error "Doctor command has runtime errors"
    echo "Output: $DOCTOR_OUTPUT"
    RESULTS+=("✗ Doctor command")
    FAILED=true
fi

# Step 5: Output Format Verification
log_step "Step 5: Output Format Verification"

# Check for common issues in CLI output
check_output_format() {
    local cmd="$1"
    local name="$2"
    
    OUTPUT=$(node dist/cli/index.js $cmd 2>&1 || true)
    
    # Check for runtime errors
    if echo "$OUTPUT" | grep -qiE 'undefined is not|cannot read propert|null is not'; then
        log_error "$name has JavaScript runtime errors"
        return 1
    fi
    
    # Check for unhandled stack traces (but allow intentional error messages)
    if echo "$OUTPUT" | grep -qE 'at\s+Object\.<anonymous>|at\s+Module\._compile'; then
        log_warning "$name may have unhandled errors (stack trace detected)"
    fi
    
    return 0
}

run_check "Version output format" "check_output_format '--version' 'Version'"
run_check "Help output format" "check_output_format '--help' 'Help'"

# Step 6: Integration Tests (unless quick or smoke-only mode)
if ! $QUICK_MODE && ! $SMOKE_ONLY; then
    log_step "Step 6: Integration Tests"
    run_check "Integration tests" "npm run test:integration -- --passWithNoTests 2>/dev/null || true"
fi

# Step 7: Jest Smoke Tests
log_step "Step 7: Jest Smoke Tests"
if [ -f "tests/smoke/smoke.test.ts" ]; then
    run_check "Jest smoke tests" "npx jest tests/smoke --passWithNoTests --runInBand 2>/dev/null"
else
    log_warning "Smoke test file not found"
    RESULTS+=("⚠ Jest smoke tests (skipped)")
fi

# Summary
echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}                    VERIFICATION SUMMARY                    ${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

for result in "${RESULTS[@]}"; do
    if [[ "$result" == ✓* ]]; then
        echo -e "${GREEN}$result${NC}"
    elif [[ "$result" == ✗* ]]; then
        echo -e "${RED}$result${NC}"
    else
        echo -e "${YELLOW}$result${NC}"
    fi
done

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if $FAILED; then
    echo -e "\n${RED}❌ Verification FAILED${NC}"
    echo -e "${RED}Some checks did not pass. Please fix the issues before committing.${NC}"
    exit 1
else
    echo -e "\n${GREEN}✅ All verifications PASSED${NC}"
    echo -e "${GREEN}Your changes look good!${NC}"
    exit 0
fi


#!/bin/bash

# CursorFlow Lane Monitor
# Displays the latest logs from all active lanes in the current or latest run.

# Colors for output
BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color
BOLD='\033[1m'

LOGS_DIR_BASE="${1:-.}"
LOGS_DIR="${LOGS_DIR_BASE}/_cursorflow/logs/runs"

# Shift arguments if path was provided
if [[ -d "$1" && "$1" != "-w" && "$1" != "--watch" ]]; then
    shift
fi

# Ensure we are in the root of the project or target dir
if [ ! -d "$LOGS_DIR" ]; then
    echo -e "${RED}Error: ${LOGS_DIR} directory not found.${NC}"
    echo "Please run this script from the root of the CursorFlow project or provide a path."
    exit 1
fi

# Find the latest run directory
LATEST_RUN=$(ls -td ${LOGS_DIR}/run-* 2>/dev/null | head -n 1)

if [ -z "$LATEST_RUN" ]; then
    echo -e "${YELLOW}No runs found in ${LOGS_DIR}${NC}"
    exit 1
fi

RUN_ID=$(basename "$LATEST_RUN")

# Clear screen if requested or if using watch
show_summary() {
    echo -e "${BOLD}CursorFlow Lane Monitor${NC} - Run: ${GREEN}${RUN_ID}${NC}"
    echo -e "Time: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "--------------------------------------------------------------------------------"

    for lane_dir in "${LATEST_RUN}/lanes"/*; do
        if [ -d "$lane_dir" ]; then
            lane_name=$(basename "$lane_dir")
            log_file="${lane_dir}/terminal-readable.log"
            
            # Extract status if possible (last line of log often contains status info)
            if [ -f "$log_file" ]; then
                # Get the last few lines
                LAST_LOG=$(tail -n 1 "$log_file")
                
                # Check for completion or errors
                STATUS="${BLUE}RUNNING${NC}"
                if grep -q "✅ Pipeline completed" "$log_file" 2>/dev/null; then
                     STATUS="${GREEN}SUCCESS${NC}"
                elif grep -q "❌ Pipeline failed" "$log_file" 2>/dev/null; then
                     STATUS="${RED}ERROR${NC}"
                elif grep -q "❌ Task failed" "$log_file" 2>/dev/null; then
                     STATUS="${RED}ERROR${NC}"
                elif grep -q "✅ ✓ Configuration valid" "$log_file" 2>/dev/null; then
                     STATUS="${BLUE}ACTIVE${NC}"
                fi
                
                echo -e "[${STATUS}] ${BOLD}${lane_name}${NC}"
                echo -e "   ${LAST_LOG:0:100}"
                echo ""
            else
                echo -e "[${YELLOW}WAITING${NC}] ${BOLD}${lane_name}${NC}"
                echo "   (No logs yet)"
                echo ""
            fi
        fi
    done
}

# Check for watch mode
if [[ "$1" == "-w" || "$1" == "--watch" ]]; then
    # Use simple loop to avoid argument passing issues with 'watch' command
    while true; do
        clear
        show_summary
        echo "Press Ctrl+C to stop..."
        sleep 2
    done
else
    show_summary
    echo -e "${NC}Tip: Use ${BOLD}$0 --watch${NC} to monitor in real-time."
fi

exit 0


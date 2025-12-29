#!/bin/bash

# CursorFlow All Lanes Log Streamer
# Replicates the output of 'cursorflow run' by streaming logs from all lanes.

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color
BOLD='\033[1m'

LOGS_DIR_BASE="${1:-.}"
LOGS_DIR="${LOGS_DIR_BASE}/_cursorflow/logs/runs"

if [ ! -d "$LOGS_DIR" ]; then
    echo -e "${RED}Error: ${LOGS_DIR} directory not found.${NC}"
    exit 1
fi

LATEST_RUN=$(ls -td ${LOGS_DIR}/run-* 2>/dev/null | head -n 1)

if [ -z "$LATEST_RUN" ]; then
    echo -e "${YELLOW}No runs found in ${LOGS_DIR}${NC}"
    exit 1
fi

RUN_ID=$(basename "$LATEST_RUN")
echo -e "${BOLD}Streaming logs for Run: ${GREEN}${RUN_ID}${NC}"
echo "--------------------------------------------------------------------------------"

# Function to stream a single log file with a prefix
stream_log() {
    local lane_name=$1
    local log_file=$2
    local color=$3
    
    # Check if file exists, if not wait for it
    until [ -f "$log_file" ]; do
        sleep 1
    done

    # Tail the file and prefix each line
    tail -n +1 -f "$log_file" | while IFS= read -r line; do
        echo -e "${color}[${lane_name}]${NC} ${line}"
    done
}

# Colors to rotate through
COLORS=('\033[0;32m' '\033[0;34m' '\033[0;35m' '\033[0;36m' '\033[1;32m' '\033[1;34m' '\033[1;35m' '\033[1;36m')
color_idx=0

# Clean up background processes on exit
trap 'kill $(jobs -p) 2>/dev/null' EXIT

# Find all lanes and start streaming
for lane_dir in "${LATEST_RUN}/lanes"/*; do
    if [ -d "$lane_dir" ]; then
        lane_name=$(basename "$lane_dir")
        log_file="${lane_dir}/terminal.jsonl"
        color=${COLORS[$color_idx]}
        
        # Start streaming in background
        stream_log "$lane_name" "$log_file" "$color" &
        
        color_idx=$(( (color_idx + 1) % ${#COLORS[@]} ))
    fi
done

# Wait for all background processes
wait


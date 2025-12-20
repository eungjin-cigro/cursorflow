# /cursorflow-signal

## Goal
Directly intervene in a running lane to provide guidance, corrections, or emergency stops.

## Usage
1. Type `/cursorflow-signal <lane-name> <your-message>` in the chat.
2. The message will be injected into the lane's conversation as a high-priority system instruction.

## Context
Use this command when:
- You see an agent making a repeated mistake in the monitor.
- You want to provide specific implementation guidance mid-task.
- You need to tell the agent to stop or change direction without killing the process.

## Example
"Send a signal to lane-1: 'Stop using library X, use library Y instead.'"
"Intervene in backend-lane: 'The database schema changed, please pull the latest main branch.'"


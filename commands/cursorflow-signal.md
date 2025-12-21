# CursorFlow Signal & Intervention

## Overview
Directly intervene in a running lane to provide guidance, corrections, or mid-task instructions. This is one of CursorFlow's most powerful features for "human-in-the-loop" AI orchestration.

## ⚠️ Prerequisites

**Intervention requires `enableIntervention: true` in your task configuration!**

```json
{
  "enableIntervention": true,
  "tasks": [...]
}
```

> **Note**: Enabling intervention uses stdin piping, which may cause stdout buffering issues on some systems. If you experience timeout issues, try disabling intervention.

## Methods of Intervention

### 1. via Interactive Monitor (Recommended)
The easiest way to intervene is through the dashboard:
1. Run `cursorflow monitor latest`.
2. Enter the lane detail view (`→`).
3. Press **`I`**.
4. Type your message and press **Enter**.

### 2. via CLI / Cursor Command
You can also send a signal from any terminal or via the Cursor chat:
```bash
cursorflow signal <lane-name> "Your message here"
```

## When to use it
- **Guidance**: "Focus on the `utils/` directory first."
- **Correction**: "You are using the wrong API version. Use v2 instead."
- **Emergency**: "Stop! I just found a critical bug in the base branch."
- **Clarification**: If the agent is stuck or asking a question in its log.

## How it works
1. Your message is written to an `intervention.txt` file in the lane's log directory.
2. The CursorFlow runner, which is watching this file, detects the change.
3. **If `enableIntervention: true`**: It immediately injects your message into the `cursor-agent`'s standard input (stdin).
4. **If `enableIntervention: false`**: The message is logged but cannot be injected (warning displayed).

## Configuration

### Enable Intervention

```json
{
  "enableIntervention": true,
  "timeout": 300000,
  "tasks": [
    {
      "name": "my-task",
      "prompt": "..."
    }
  ]
}
```

### Default Behavior (Intervention Disabled)

By default, `enableIntervention` is `false` to avoid potential buffering issues. When disabled:
- Signal commands will still work but messages are **logged only**
- The agent will **not receive** the injected message
- A warning will be shown: `Intervention requested but stdin not available`

## PID Control (Emergency Stop)
If an intervention isn't enough and the agent is "looping" or stuck:
- In the monitor, press **`K`** to kill the process via its PID.
- This is a hard stop and will immediately terminate the `cursor-agent` for that lane.

## Troubleshooting

### "Intervention requested but stdin not available"

This means `enableIntervention` is not set to `true` in your task JSON.

**Solution**: Add `"enableIntervention": true` to your task configuration.

### Intervention causes timeout

On some systems, enabling stdin piping can cause stdout buffering issues.

**Solution**: 
1. Disable intervention: `"enableIntervention": false`
2. Increase timeout: `"timeout": 600000`
3. Use `K` (Kill) in monitor for emergency stops instead

# CursorFlow Event Triggers & Webhooks

## Overview

CursorFlow emits various status changes during the orchestration process as **Events**. Through this event system, you can send notifications to external services (Webhooks) or execute custom logic to automate complex workflows.

## Key Concepts

### 1. Events
Occurrences during the lifecycle of the orchestrator, lanes, tasks, agents, and reviewers. Each event has a unique type and payload.

### 2. Webhooks
A mechanism to send emitted events to external HTTP endpoints. Configured via `cursorflow.config.js`, allowing you to filter for specific events.

### 3. Dependency Triggers
Internally, when a lane completes, any subsequent lanes that depend on it are automatically executed (triggered). This is managed by the DAG (Directed Acyclic Graph) scheduler.

## Supported Events

| Category | Event Type | Occurrence |
| :--- | :--- | :--- |
| **Orchestration** | `orchestration.started` | When the entire workflow begins |
| | `orchestration.completed` | When all lanes complete successfully |
| | `orchestration.failed` | When an error occurs during the workflow |
| **Lane** | `lane.started` | When an individual lane starts execution |
| | `lane.completed` | When all tasks in a lane are finished |
| | `lane.failed` | When an error occurs during lane execution |
| | `lane.dependency_requested` | When an agent requests to modify external dependencies |
| **Task** | `task.started` | When an individual task within a lane begins |
| | `task.completed` | When a task succeeds |
| | `task.failed` | When a task fails |
| **Agent** | `agent.prompt_sent` | When a prompt is sent to the AI agent |
| | `agent.response_received` | When a response is received from the AI agent |
| **Review** | `review.started` | When the AI review process begins |
| | `review.completed` | When the AI review completes (includes results) |
| | `review.approved` | When a review is approved |
| | `review.rejected` | When a review is rejected and a retry is determined |

## Common Event Structure

All events passed to listeners have the following common wrapper structure:

```typescript
{
  "id": "evt_1734842400000_abc123", // Unique event ID
  "type": "task.completed",           // Event type
  "timestamp": "2024-12-22T10:00:00.000Z", // Timestamp (ISO 8601)
  "runId": "run-1734842400000",       // Current orchestration run ID
  "payload": { ... }                  // Event-specific data (see below)
}
```

## Event Payload Details

### 1. Orchestration

#### `orchestration.started`
- `runId`: Unique run ID
- `tasksDir`: Path to the directory containing task configuration files
- `laneCount`: Total number of lanes to be executed
- `runRoot`: Root directory where logs and status files are stored

#### `orchestration.completed`
- `runId`: Unique run ID
- `laneCount`: Total number of lanes
- `completedCount`: Number of successfully completed lanes
- `failedCount`: Number of failed lanes

#### `orchestration.failed`
- `error`: Error message
- `blockedLanes`: (Optional) List of lane names that could not start due to dependency issues

### 2. Lane

#### `lane.started`
- `laneName`: Name of the lane (filename)
- `pid`: (Optional) Process ID of the child process running the lane
- `logPath`: Path to the log file for this lane

#### `lane.completed`
- `laneName`: Name of the lane
- `exitCode`: Exit code (0 for success)

#### `lane.failed`
- `laneName`: Name of the lane
- `exitCode`: Exit code
- `error`: Description of the failure cause

#### `lane.dependency_requested`
- `laneName`: Name of the lane that sent the request
- `dependencyRequest`: Dependency modification plan (includes `reason`, `changes`, `commands`)

### 3. Task

#### `task.started`
- `taskName`: Name of the task
- `taskBranch`: Name of the Git branch being worked on
- `index`: Task sequence index within the lane (starting from 0)
- `timeout`: (Optional) Task-specific timeout in milliseconds

#### `task.completed`
- `taskName`: Name of the task
- `taskBranch`: Name of the Git branch
- `status`: Completion status (e.g., 'FINISHED')

#### `task.failed`
- `taskName`: Name of the task
- `taskBranch`: Branch name
- `error`: Error message from task execution

### 4. Agent

#### `agent.prompt_sent`
- `taskName`: Current task name
- `model`: AI model used
- `promptLength`: Length of the sent prompt string

#### `agent.response_received`
- `taskName`: Task name
- `ok`: Success flag (boolean)
- `duration`: Time taken for AI response (milliseconds)
- `responseLength`: Length of the received response string
- `error`: (On failure) Error message

### 5. Review

#### `review.started`
- `taskName`: Name of the task under review
- `taskBranch`: Name of the branch under review

#### `review.completed`
- `taskName`: Task name
- `status`: Review result (`'approved'` or `'needs_changes'`)
- `issueCount`: Number of issues found
- `summary`: Review summary content

#### `review.approved`
- `taskName`: Task name
- `iterations`: Number of review iterations until final approval

#### `review.rejected`
- `taskName`: Task name
- `reason`: Reason for rejection (summary of requested changes)
- `iterations`: Current number of review iterations

## Webhook Configuration

Set up the `webhooks` array in your `cursorflow.config.js` file.

```javascript
module.exports = {
  // ... other settings
  webhooks: [
    {
      enabled: true,
      url: 'https://your-api.com/webhooks/cursorflow',
      secret: 'your-hmac-secret', // Secret for HMAC signature
      events: ['lane.completed', 'orchestration.*'], // Event patterns to receive
      headers: {
        'X-Custom-Header': 'CursorFlow-Bot'
      },
      retries: 3,      // Number of retries on failure
      timeoutMs: 5000  // Timeout setting
    }
  ]
};
```

### Event Filtering Patterns
- `*`: Receive all events
- `lane.*`: Receive all lane-related events
- `task.failed`: Receive only task failure events

## Programmatic Event Listeners (Function Triggers)

In addition to webhooks, you can register event listeners directly via Node.js code to execute custom logic. This is useful for running local scripts or complex conditional logic.

### 1. Registering in `cursorflow.config.js`

Since the `cursorflow run` command loads the configuration file, you can subscribe to events at this point.

```javascript
// cursorflow.config.js
const { events } = require('@litmers/cursorflow-orchestrator');

// Execute custom logic on task completion
events.on('task.completed', (event) => {
  const { taskName, taskBranch } = event.payload;
  console.log(`[HOOK] Task completed: ${taskName} (Branch: ${taskBranch})`);
  
  // Example: Check if a specific file was created or update a local database
});

// Notify on entire orchestration failure
events.on('orchestration.failed', (event) => {
  console.error(`!!! Orchestration failed: ${event.payload.error}`);
});

module.exports = {
  tasksDir: '_cursorflow/tasks',
  // ... other configurations
};
```

### 2. Usage in Custom Scripts

If you are using CursorFlow as a library, you can call the `orchestrate` function directly and monitor events.

```javascript
const { orchestrate, events } = require('@litmers/cursorflow-orchestrator');

async function runMyPipeline() {
  // Register event listener
  events.on('lane.started', (event) => {
    console.log(`Lane started: ${event.payload.laneName}`);
  });

  // Execute orchestration
  try {
    await orchestrate('./my-tasks');
    console.log('All tasks completed');
  } catch (err) {
    console.error('Error during orchestration', err);
  }
}

runMyPipeline();
```

## Security & Verification

When sending webhooks, you can verify the integrity of the payload using the `X-CursorFlow-Signature` header.

- **Algorithm**: HMAC-SHA256
- **Format**: `sha256=<hex_signature>`

The receiver should hash the request body using the configured `secret` and verify it matches the signature in the header.

## Use Cases

1. **Slack/Discord Notifications**: Notify the team messenger on `orchestration.completed` or `lane.failed`.
2. **Deployment Automation**: Execute an external script to deploy code to a staging environment once a specific lane completes.
3. **Statistics Collection**: Record token usage or response times in a database via the `agent.response_received` event.
4. **Dashboard Updates**: Reflect real-time status on an external monitoring dashboard.

## Precautions

- Webhook endpoints must support the `POST` method.
- Payloads are sent in `application/json` format.
- Consider network latency and set timeout and retry policies appropriately.

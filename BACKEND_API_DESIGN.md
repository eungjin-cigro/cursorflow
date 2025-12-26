# Backend API Design Document

This document defines the Backend API for CursorFlow, enabling programmatic control and monitoring of flows, lanes, and tasks.

## 1. Data Models

### 1.1 Flow
Represents a high-level development feature consisting of multiple parallel lanes.

| Field | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` | Unique identifier (e.g., "001") |
| `name` | `string` | Human-readable name (e.g., "ShopFeature") |
| `status` | `enum` | `pending`, `running`, `completed`, `failed`, `cancelled` |
| `createdAt` | `string` | ISO 8601 creation timestamp |
| `createdBy` | `string` | User or system identifier |
| `baseBranch` | `string` | Git branch the flow originated from |
| `lanes` | `string[]` | List of lane names associated with this flow |

### 1.2 Lane
An independent execution thread within a flow, mapped to a Git Worktree.

| Field | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Unique name within the flow |
| `status` | `enum` | `pending`, `running`, `completed`, `failed`, `paused`, `waiting`, `reviewing` |
| `currentTaskIndex` | `number` | Index of the currently executing task (0-based) |
| `totalTasks` | `number` | Total number of tasks in this lane |
| `pipelineBranch` | `string` | The Git branch used by this lane's pipeline |
| `worktreeDir` | `string` | Absolute path to the worktree directory |

### 1.3 Task
A single unit of work assigned to an AI agent.

| Field | Type | Description |
| :--- | :--- | :--- |
| `name` | `string` | Unique task name within the lane |
| `prompt` | `string` | Instructions for the AI agent |
| `model` | `string` | AI model identifier (e.g., "sonnet-3.5") |
| `dependsOn` | `string[]` | List of dependencies in `lane:task` or `lane` format |

---

## 2. API Endpoints

### 2.1 Flow Management

#### List Flows
- **Endpoint**: `GET /api/flows`
- **Success Response**: `200 OK` with `FlowInfo[]`

#### Get Flow Details
- **Endpoint**: `GET /api/flows/:id`
- **Success Response**: `200 OK` with `FlowMeta` and summary of lanes.

#### Create Flow
- **Endpoint**: `POST /api/flows`
- **Body**:
  ```json
  {
    "name": "string",
    "lanes": ["string"],
    "baseBranch": "string"
  }
  ```
- **Success Response**: `201 Created`

#### Run Flow
- **Endpoint**: `POST /api/flows/:id/run`
- **Success Response**: `202 Accepted`

#### Stop Flow
- **Endpoint**: `POST /api/flows/:id/stop`
- **Success Response**: `200 OK`

---

### 2.2 Lane & Task Management

#### Get Lane Status
- **Endpoint**: `GET /api/flows/:id/lanes/:laneName`
- **Success Response**: `200 OK` with `LaneState`

#### Add Task to Lane
- **Endpoint**: `POST /api/flows/:id/lanes/:laneName/tasks`
- **Body**: `FlowTask`
- **Success Response**: `201 Created`

#### Get Lane Logs
- **Endpoint**: `GET /api/flows/:id/lanes/:laneName/logs`
- **Query Params**: `limit`, `offset`, `tail`
- **Success Response**: `200 OK` with log entries.

---

### 2.3 Real-time Monitoring

#### Status WebSocket
- **Endpoint**: `WS /api/ws/monitor/:flowId`
- **Events**:
  - `lane_status_changed`: Fired when a lane changes status.
  - `task_started` / `task_completed`: Fired on task progress.
  - `log_append`: Real-time log streaming.

---

## 3. Error Handling

### 3.1 Standard Response
All errors follow this format:
```json
{
  "error": {
    "code": "STRING_CODE",
    "message": "Human readable explanation",
    "details": {}
  }
}
```

### 3.2 Common Error Codes
- `FLOW_NOT_FOUND`: The requested Flow ID does not exist.
- `LANE_NOT_FOUND`: The requested Lane does not exist in the Flow.
- `INVALID_TASK_SPEC`: The provided task definition is missing required fields.
- `FLOW_ALREADY_RUNNING`: Attempted to start a flow that is already in progress.
- `GIT_ERROR`: Operation failed due to a Git conflict or error.

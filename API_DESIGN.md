# CursorFlow Backend API Design

This document defines the REST API for the CursorFlow orchestrator backend.

## Base URL
All API requests are prefixed with: `/api/v1`

## Authentication
(Placeholder) Authentication is required for all endpoints except health checks. 
Recommended: Bearer Token (JWT).

---

## 1. Flows
A Flow is a template or definition of a workflow consisting of multiple lanes and tasks.

### List Flows
`GET /flows`
- **Response**: `200 OK`
- **Body**: `FlowInfo[]`

### Create Flow
`POST /flows`
- **Body**: `FlowMeta` (without ID)
- **Response**: `201 Created`
- **Body**: `FlowInfo`

### Get Flow Details
`GET /flows/{flowId}`
- **Response**: `200 OK`
- **Body**: `FlowInfo`

### Update Flow
`PUT /flows/{flowId}`
- **Body**: Partial `FlowMeta` or `LaneConfig[]`
- **Response**: `200 OK`

### Delete Flow
`DELETE /flows/{flowId}`
- **Response**: `204 No Content`

---

## 2. Runs
A Run is an execution instance of a Flow.

### List All Runs
`GET /runs`
- **Response**: `200 OK`
- **Body**: `RunInfo[]`

### List Runs for a Flow
`GET /flows/{flowId}/runs`
- **Response**: `200 OK`
- **Body**: `RunInfo[]`

### Start Run
`POST /flows/{flowId}/runs`
- **Body**: Optional execution overrides (model, branch prefix, etc.)
- **Response**: `202 Accepted`
- **Body**: `RunInfo`

### Get Run Status
`GET /runs/{runId}`
- **Response**: `200 OK`
- **Body**: `RunInfo` (includes detailed lane and task status)

### Stop Run
`POST /runs/{runId}/stop`
- **Response**: `200 OK`

### Resume Run
`POST /runs/{runId}/resume`
- **Response**: `200 OK`

---

## 3. Tasks & Monitoring

### List Lane Tasks
`GET /runs/{runId}/lanes/{laneName}/tasks`
- **Response**: `200 OK`
- **Body**: `TaskExecutionResult[]`

### Get Task Logs
`GET /runs/{runId}/tasks/{taskName}/logs`
- **Query Params**: `offset`, `limit`, `tail`
- **Response**: `200 OK`
- **Body**: `{ logs: string[], nextOffset: number }`

### Send Signal to Task
`POST /runs/{runId}/tasks/{taskName}/signal`
- **Body**: `{ type: string, message: string }`
- **Response**: `200 OK`

---

## 4. Real-time Events
CursorFlow provides real-time updates via Server-Sent Events (SSE).

### Stream Events
`GET /events`
- **Query Params**: `runId` (optional, filter by run)
- **Response**: `200 OK` (Content-Type: `text/event-stream`)
- **Body**: `CursorFlowEvent` data chunks

---

## 5. System

### Health Check (Doctor)
`GET /system/health`
- **Response**: `200 OK`
- **Body**: `DoctorStatus`

### List Available Models
`GET /system/models`
- **Response**: `200 OK`
- **Body**: `{ models: string[] }`

### System Config
`GET /system/config`
- **Response**: `200 OK`
- **Body**: `Config`

---

## 5. Data Models (TypeScript Definitions)

### RunStatus
```typescript
type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'partial';
```

### FlowInfo
```typescript
interface FlowInfo {
  id: string;
  name: string;
  path: string;
  meta: FlowMeta;
  laneCount: number;
}
```

### RunInfo
```typescript
interface RunInfo {
  id: string;
  flowId: string;
  status: RunStatus;
  startTime: number;
  endTime?: number;
  duration: number;
  lanes: LaneStatus[];
}
```

### CursorFlowEvent
```typescript
interface CursorFlowEvent<T = any> {
  id: string;
  type: string;
  timestamp: string;
  runId: string;
  payload: T;
}
```

---

## 6. Error Handling

Standard HTTP status codes are used:
- `200`: Success
- `201`: Created
- `400`: Bad Request (Validation Error)
- `401`: Unauthorized
- `404`: Not Found
- `500`: Internal Server Error

### Error Response Body
```json
{
  "error": {
    "code": "INVALID_FLOW_ID",
    "message": "The provided flow ID does not exist.",
    "details": {
      "id": "flow-123"
    }
  }
}
```

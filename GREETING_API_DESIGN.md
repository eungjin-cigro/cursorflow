# Greeting API Design

This document outlines the design for a simple REST API endpoint for user greeting.

## Endpoint Overview

| Property | Value |
| --- | --- |
| **Path** | `/api/greet` |
| **HTTP Method** | `GET` |
| **Description** | Greets the user with a personalized or generic message. |

## Request Parameters

### Query Parameters

| Name | Type | Required | Description | Default |
| --- | --- | --- | --- | --- |
| `name` | `string` | No | The name of the person to greet. | `Guest` |

## Response Formats

### Success Response

- **Status Code:** `200 OK`
- **Content-Type:** `application/json`

**Body:**

```json
{
  "message": "Hello, Guest!",
  "timestamp": "2025-12-26T10:00:00.000Z",
  "status": "success"
}
```

### Error Response (Optional)

- **Status Code:** `400 Bad Request`
- **Content-Type:** `application/json`

**Body:**

```json
{
  "error": "Bad Request",
  "message": "The 'name' parameter exceeds the maximum allowed length.",
  "status": "error"
}
```

## Example Usage

### Generic Greeting
`GET /api/greet`

**Response:**
```json
{
  "message": "Hello, Guest!",
  "timestamp": "2025-12-26T10:00:00.000Z",
  "status": "success"
}
```

### Personalized Greeting
`GET /api/greet?name=Eugene`

**Response:**
```json
{
  "message": "Hello, Eugene!",
  "timestamp": "2025-12-26T10:00:00.000Z",
  "status": "success"
}
```

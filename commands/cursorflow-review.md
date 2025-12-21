# CursorFlow Automatic Review

## Overview
CursorFlow features an integrated AI-powered code review system. It automatically validates task results against your defined acceptance criteria and can provide feedback to the agent for iterative improvements.

## Configuration

### Project-wide Settings
Enable and configure the review process in your `cursorflow.config.js`:

```javascript
module.exports = {
  enableReview: true,               // Enable automatic reviews
  reviewModel: 'sonnet-4.5-thinking', // Model to use for reviewing
  maxReviewIterations: 3,           // Number of fix/re-review cycles
  // ...
};
```

### Task-level Criteria
Add `acceptanceCriteria` to your task JSON to guide the reviewer:

```json
{
  "tasks": [
    {
      "name": "implement-logic",
      "acceptanceCriteria": [
        "No build errors",
        "Tests in src/tests/ pass",
        "Code follows project style guide"
      ],
      "prompt": "..."
    }
  ]
}
```

## The Review Process

1. **Completion**: When an agent finishes a task, CursorFlow spawns a reviewer agent.
2. **Analysis**: The reviewer checks the worktree against the `acceptanceCriteria` using the `reviewModel`.
3. **Verdict**:
   - **Approved**: The lane proceeds to the next task.
   - **Needs Changes**: The reviewer's feedback is sent back to the original agent.
4. **Fix Loop**: The agent attempts to fix the issues based on the feedback. This repeats up to `maxReviewIterations`.

## Monitoring Reviews
You can track the review process in real-time using `cursorflow monitor`.
- The lane status will change to **`reviewing`** (`👀`).
- Reviewer feedback appears in the conversation history as a **`REVIEWER`** message.

## Best Practices
- **Specific Criteria**: Use clear, measurable criteria (e.g., "Build succeeds with `npm run build`").
- **Thinking Models**: Use reasoning-heavy models like `sonnet-4.5-thinking` for reviews to get better results.
- **Reasonable Iterations**: Set `maxReviewIterations` to 2 or 3 to prevent infinite loops.

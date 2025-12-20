# CursorFlow Review

## Overview
Configure the code review flow and inspect review results. Use AI-driven automatic reviews to improve code quality.

## Steps

1. **Enable reviews**

   Configure `cursorflow.config.js`:
   ```javascript
   module.exports = {
     enableReview: true,
     reviewModel: 'sonnet-4.5-thinking',
     maxReviewIterations: 3,
     // ...
   };
   ```

2. **Define acceptance criteria**

   Add validation criteria to the task JSON file:
   ```json
   {
     "tasks": [
       {
         "name": "implement",
         "model": "sonnet-4.5",
         "acceptanceCriteria": [
           "No build errors",
           "No TypeScript type errors",
           "Key functionality implemented",
           "Tests passing"
         ],
         "prompt": "..."
       }
     ]
   }
   ```

3. **Run reviews**

   Reviews start automatically after each task completes.

4. **Check review results**
   ```bash
   # Inspect the review output
   cat _cursorflow/logs/runs/<lane>/review-results.json
   ```

## Review models

| Model | Characteristics | Recommended use |
|------|------|-----------|
| `sonnet-4.5-thinking` | Strong reasoning, precise analysis | General code reviews (recommended) |
| `opus-4.5-thinking` | Highest quality, detailed reviews | Critical code or architecture reviews |
| `sonnet-4.5` | Faster reviews | Simple changes |

## Review process

1. **Task completion**
   - Finish implementation
   - Create a commit

2. **Automatic review**
   - Run the agent with the selected review model
   - Verify acceptance criteria
   - Validate build and types

3. **Review outcome**
   - `approved`: proceed to the next task
   - `needs_changes`: send feedback → rework

4. **Feedback loop**
   - Apply fixes
   - Re-run the review
   - Repeat until the maximum iteration count

## Review result format

```json
{
  "status": "approved",
  "buildSuccess": true,
  "typeCheckSuccess": true,
  "issues": [
    {
      "severity": "warning",
      "description": "Consider adding error handling",
      "file": "src/utils/api.js",
      "line": 42,
      "suggestion": "Add try-catch block"
    }
  ],
  "suggestions": [
    "Add unit tests for edge cases",
    "Improve error messages"
  ],
  "summary": "Code quality is good, minor improvements suggested",
  "reviewedBy": "sonnet-4.5-thinking",
  "reviewedAt": "2025-12-19T18:30:00Z"
}
```

## Examples

### Standard review settings
```javascript
// cursorflow.config.js
{
  enableReview: true,
  reviewModel: 'sonnet-4.5-thinking',
  maxReviewIterations: 3
}
```

### Strict reviews
```javascript
{
  enableReview: true,
  reviewModel: 'opus-4.5-thinking',
  maxReviewIterations: 5
}
```

### Fast reviews
```javascript
{
  enableReview: true,
  reviewModel: 'sonnet-4.5',
  maxReviewIterations: 1
}
```

## Acceptance criteria writing guide

### Good examples
```json
{
  "acceptanceCriteria": [
    "No build errors (pnpm build succeeds)",
    "No TypeScript type errors (pnpm type-check)",
    "All existing tests pass",
    "Three new API endpoints implemented",
    "Error handling logic included",
    "Logging added"
  ]
}
```

### Poor examples
```json
{
  "acceptanceCriteria": [
    "Works well",
    "Code looks good"
  ]
}
```

## Analyzing review results

### When approved
```bash
# The next task proceeds automatically
# Confirm in the logs
cursorflow monitor
```

### When changes are needed
```bash
# Feedback is passed back to the agent
# After rework, the review re-runs automatically
# View feedback in the logs
cat _cursorflow/logs/runs/<lane>/conversation.jsonl | \
  jq 'select(.role=="reviewer")'
```

### When the max iterations are hit
```bash
# Continue with a warning
# Manual review is required
```

## Checklist
- [ ] Is review enabled?
- [ ] Is the review model appropriate?
- [ ] Are the acceptance criteria clear?
- [ ] Is the max iteration count reasonable?
- [ ] Have you inspected the review results?

## Troubleshooting

### Reviews are not running
1. Confirm `enableReview: true`.
2. Verify the review model name is valid.
3. Check logs for errors.

### Infinite review loop
1. Check the `maxReviewIterations` setting.
2. Ensure the acceptance criteria are achievable.
3. Improve the task prompts.

### Reviews are too strict
1. Switch to a more lenient review model.
2. Adjust the acceptance criteria.
3. Increase `maxReviewIterations`.

## Best practices

1. **Clear criteria**: Write specific acceptance criteria.
2. **Right model**: Choose a review model that matches task complexity.
3. **Iterative improvement**: Don’t aim for perfection on the first pass.
4. **Use feedback**: Apply review feedback to strengthen future tasks.

## Next steps
1. Analyze review results.
2. Identify recurring issue patterns.
3. Refine task prompts and acceptance criteria.
4. Tune the review model as needed.

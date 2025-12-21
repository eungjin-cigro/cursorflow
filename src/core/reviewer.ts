/**
 * Reviewer - Code review agent
 * 
 * Adapted from reviewer-agent.js
 */

import * as logger from '../utils/logger';
import { appendLog, createConversationEntry } from '../utils/state';
import * as path from 'path';
import { ReviewResult, ReviewIssue, TaskResult, RunnerConfig, AgentSendResult } from '../utils/types';
import { events } from '../utils/events';

/**
 * Build review prompt
 */
export function buildReviewPrompt({ taskName, taskBranch, acceptanceCriteria = [] }: { taskName: string; taskBranch: string; acceptanceCriteria?: string[] }): string {
  const criteriaList = acceptanceCriteria.length > 0
    ? acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`).join('\n')
    : 'Work should be completed properly.';
  
  return `# Code Review: ${taskName}

## Role
You are a senior code reviewer. Please review the results of this task.

## Task Details
- Name: ${taskName}
- Branch: ${taskBranch}

## Acceptance Criteria
${criteriaList}

## Review Checklist
1. **Build Success**: Does \`pnpm build\` complete without errors?
2. **Code Quality**: Are there no linting or TypeScript type errors?
3. **Completeness**: Are all acceptance criteria met?
4. **Bugs**: Are there any obvious bugs or logic errors?
5. **Commit Status**: Are changes properly committed and pushed?

## Output Format (MUST follow exactly)
\`\`\`json
{
  "status": "approved" | "needs_changes",
  "buildSuccess": true | false,
  "issues": [
    {
      "severity": "critical" | "major" | "minor",
      "description": "...",
      "file": "...",
      "suggestion": "..."
    }
  ],
  "suggestions": ["..."],
  "summary": "One-line summary"
}
\`\`\`

IMPORTANT: You MUST respond in the exact JSON format above. "status" must be either "approved" or "needs_changes".
`;
}

/**
 * Parse review result
 */
export function parseReviewResult(text: string): ReviewResult {
  const t = String(text || '');
  
  // Try JSON block
  const jsonMatch = t.match(/```json\n([\s\S]*?)\n```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]!);
      return {
        status: parsed.status || 'needs_changes',
        buildSuccess: parsed.buildSuccess !== false,
        issues: Array.isArray(parsed.issues) ? (parsed.issues as ReviewIssue[]) : [],
        suggestions: Array.isArray(parsed.suggestions) ? (parsed.suggestions as string[]) : [],
        summary: parsed.summary || '',
        raw: t,
      };
    } catch (err: any) {
      logger.warn(`JSON parse failed: ${err.message}`);
    }
  }
  
  // Fallback parsing
  const hasApproved = t.toLowerCase().includes('approved');
  const hasIssues = t.toLowerCase().includes('needs_changes') ||
                    t.toLowerCase().includes('error') ||
                    t.toLowerCase().includes('failed');
  
  return {
    status: hasApproved && !hasIssues ? 'approved' : 'needs_changes',
    buildSuccess: !t.toLowerCase().includes('build') || !t.toLowerCase().includes('fail'),
    issues: hasIssues ? [{ severity: 'major', description: 'Parse failed, see logs' }] : [],
    suggestions: [],
    summary: 'Auto-parsed - check original response',
    raw: t,
  };
}

/**
 * Build feedback prompt
 */
export function buildFeedbackPrompt(review: ReviewResult): string {
  const lines: string[] = [];
  lines.push('# Code Review Feedback');
  lines.push('');
  lines.push('The reviewer found the following issues. Please fix them:');
  lines.push('');
  
  if (!review.buildSuccess) {
    lines.push('## CRITICAL: Build Failed');
    lines.push('- \`pnpm build\` failed. Fix build errors first.');
    lines.push('');
  }
  
  for (const issue of review.issues || []) {
    const severity = (issue.severity || 'major').toUpperCase();
    lines.push(`## ${severity}: ${issue.description}`);
    if (issue.file) lines.push(`- File: ${issue.file}`);
    if (issue.suggestion) lines.push(`- Suggestion: ${issue.suggestion}`);
    lines.push('');
  }
  
  if (review.suggestions && review.suggestions.length > 0) {
    lines.push('## Additional Suggestions');
    for (const s of review.suggestions) {
      lines.push(`- ${s}`);
    }
    lines.push('');
  }
  
  lines.push('## Requirements');
  lines.push('1. Fix all issues listed above');
  lines.push('2. Ensure \`pnpm build\` succeeds');
  lines.push('3. Commit and push your changes');
  lines.push('');
  lines.push('**Let me know when fixes are complete.**');
  
  return lines.join('\n');
}

/**
 * Review task
 */
export async function reviewTask({ taskResult, worktreeDir, runDir, config, cursorAgentSend, cursorAgentCreateChat }: { 
  taskResult: TaskResult; 
  worktreeDir: string; 
  runDir: string; 
  config: RunnerConfig; 
  cursorAgentSend: (options: { workspaceDir: string; chatId: string; prompt: string; model?: string }) => AgentSendResult; 
  cursorAgentCreateChat: () => string; 
}): Promise<ReviewResult> {
  const reviewPrompt = buildReviewPrompt({
    taskName: taskResult.taskName,
    taskBranch: taskResult.taskBranch,
    acceptanceCriteria: config.acceptanceCriteria || [],
  });
  
  logger.info(`Reviewing: ${taskResult.taskName}`);
  
  events.emit('review.started', {
    taskName: taskResult.taskName,
    taskBranch: taskResult.taskBranch,
  });

  const reviewChatId = cursorAgentCreateChat();
  const reviewResult = cursorAgentSend({
    workspaceDir: worktreeDir,
    chatId: reviewChatId,
    prompt: reviewPrompt,
    model: config.reviewModel || 'sonnet-4.5-thinking',
  });
  
  const review = parseReviewResult(reviewResult.resultText || '');
  
  // Log review
  const convoPath = path.join(runDir, 'conversation.jsonl');
  appendLog(convoPath, createConversationEntry('reviewer', reviewResult.resultText || 'No result', {
    task: taskResult.taskName,
    model: config.reviewModel,
  }));
  
  logger.info(`Review result: ${review.status} (${review.issues?.length || 0} issues)`);
  
  events.emit('review.completed', {
    taskName: taskResult.taskName,
    status: review.status,
    issueCount: review.issues?.length || 0,
    summary: review.summary,
  });

  return review;
}

/**
 * Review loop with feedback
 */
export async function runReviewLoop({ taskResult, worktreeDir, runDir, config, workChatId, cursorAgentSend, cursorAgentCreateChat }: {
  taskResult: TaskResult;
  worktreeDir: string;
  runDir: string;
  config: RunnerConfig;
  workChatId: string;
  cursorAgentSend: (options: { workspaceDir: string; chatId: string; prompt: string; model?: string }) => AgentSendResult;
  cursorAgentCreateChat: () => string;
}): Promise<{ approved: boolean; review: ReviewResult; iterations: number; error?: string }> {
  const maxIterations = config.maxReviewIterations || 3;
  let iteration = 0;
  let currentReview: ReviewResult | null = null;
  
  while (iteration < maxIterations) {
    currentReview = await reviewTask({
      taskResult,
      worktreeDir,
      runDir,
      config,
      cursorAgentSend,
      cursorAgentCreateChat,
    });
    
    if (currentReview.status === 'approved') {
      logger.success(`Review passed: ${taskResult.taskName} (iteration ${iteration + 1})`);
      events.emit('review.approved', {
        taskName: taskResult.taskName,
        iterations: iteration + 1,
      });
      return { approved: true, review: currentReview, iterations: iteration + 1 };
    }
    
    iteration++;
    
    if (iteration >= maxIterations) {
      logger.warn(`Max review iterations (${maxIterations}) reached: ${taskResult.taskName}`);
      events.emit('review.rejected', {
        taskName: taskResult.taskName,
        reason: 'Max iterations reached',
        iterations: iteration,
      });
      break;
    }
    
    // Send feedback
    logger.info(`Sending feedback (iteration ${iteration}/${maxIterations})`);
    const feedbackPrompt = buildFeedbackPrompt(currentReview);
    
    const fixResult = cursorAgentSend({
      workspaceDir: worktreeDir,
      chatId: workChatId,
      prompt: feedbackPrompt,
      model: config.model,
    });
    
    if (!fixResult.ok) {
      logger.error(`Feedback application failed: ${fixResult.error}`);
      return { approved: false, review: currentReview, iterations: iteration, error: fixResult.error };
    }
  }
  
  return { approved: false, review: currentReview!, iterations: iteration };
}

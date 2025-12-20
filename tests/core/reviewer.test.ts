import { parseReviewResult, buildFeedbackPrompt } from '../../src/core/reviewer';

describe('Reviewer Core', () => {
  test('parseReviewResult should parse valid JSON block', () => {
    const text = 'Some text before\n```json\n{"status": "approved", "summary": "Looks good"}\n```\nSome after';
    const result = parseReviewResult(text);
    
    expect(result.status).toBe('approved');
    expect(result.summary).toBe('Looks good');
    expect(result.buildSuccess).toBe(true);
  });

  test('parseReviewResult should fallback when JSON is missing', () => {
    const text = 'The status is approved but there are no code blocks.';
    const result = parseReviewResult(text);
    
    expect(result.status).toBe('approved');
  });

  test('buildFeedbackPrompt should include critical issues', () => {
    const review: any = {
      buildSuccess: false,
      issues: [{ severity: 'major', description: 'Test fail' }],
      suggestions: ['Add comments']
    };
    
    const prompt = buildFeedbackPrompt(review);
    expect(prompt).toContain('CRITICAL: Build Failed');
    expect(prompt).toContain('MAJOR: Test fail');
    expect(prompt).toContain('Add comments');
  });
});


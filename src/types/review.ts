
export interface ReviewIssue {
  severity: 'critical' | 'major' | 'minor';
  description: string;
  file?: string;
  suggestion?: string;
}

export interface ReviewResult {
  status: 'approved' | 'needs_changes';
  buildSuccess: boolean;
  issues: ReviewIssue[];
  suggestions: string[];
  summary: string;
  raw: string;
}

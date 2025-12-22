
export interface DependencyPolicy {
  allowDependencyChange: boolean;
  lockfileReadOnly: boolean;
}

export interface DependencyRequestPlan {
  reason: string;
  changes: string[];
  commands: string[];
  notes?: string;
}

export interface AgentSendResult {
  ok: boolean;
  exitCode: number;
  error?: string;
  sessionId?: string;
  resultText?: string;
}

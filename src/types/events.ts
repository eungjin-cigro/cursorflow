
import { DependencyRequestPlan } from './agent';

export interface CursorFlowEvent<T = Record<string, any>> {
  id: string;
  type: string;
  timestamp: string;
  runId: string;
  payload: T;
}

export type EventHandler<T = any> = (event: CursorFlowEvent<T>) => void | Promise<void>;

// Orchestration Events
export interface OrchestrationStartedPayload {
  runId: string;
  tasksDir: string;
  laneCount: number;
  runRoot: string;
}

export interface OrchestrationCompletedPayload {
  runId: string;
  laneCount: number;
  completedCount: number;
  failedCount: number;
}

export interface OrchestrationFailedPayload {
  error: string;
  blockedLanes?: string[];
}

// Lane Events
export interface LaneStartedPayload {
  laneName: string;
  pid?: number;
  logPath: string;
}

export interface LaneCompletedPayload {
  laneName: string;
  exitCode: number;
}

export interface LaneFailedPayload {
  laneName: string;
  exitCode: number;
  error: string;
}

export interface LaneDependencyRequestedPayload {
  laneName: string;
  dependencyRequest: DependencyRequestPlan;
}

// Task Events
export interface TaskStartedPayload {
  taskName: string;
  taskBranch: string;
  index: number;
}

export interface TaskCompletedPayload {
  taskName: string;
  taskBranch: string;
  status: string;
}

export interface TaskFailedPayload {
  taskName: string;
  taskBranch: string;
  error: string;
}

// Agent Events
export interface AgentPromptSentPayload {
  taskName: string;
  model: string;
  promptLength: number;
}

export interface AgentResponseReceivedPayload {
  taskName: string;
  ok: boolean;
  duration: number;
  responseLength: number;
  error?: string;
}

// Review Events
export interface ReviewStartedPayload {
  taskName: string;
  taskBranch: string;
}

export interface ReviewCompletedPayload {
  taskName: string;
  status: 'approved' | 'needs_changes';
  issueCount: number;
  summary: string;
  raw: string;
}

export interface ReviewApprovedPayload {
  taskName: string;
  iterations: number;
}

export interface ReviewRejectedPayload {
  taskName: string;
  reason: string;
  iterations: number;
}

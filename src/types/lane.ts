
import { DependencyRequestPlan } from './agent';

export type LaneStatus = 
  | 'pending' 
  | 'running' 
  | 'completed' 
  | 'failed' 
  | 'paused' 
  | 'waiting' 
  | 'reviewing';

export interface LaneInfo {
  name: string;
  status: string;
  currentTask: number;
  totalTasks: number;
  pid?: number;
  pipelineBranch?: string;
}

export interface LaneState {
  label: string;
  status: LaneStatus;
  currentTaskIndex: number;
  totalTasks: number;
  worktreeDir: string | null;
  pipelineBranch: string | null;
  startTime: number;
  endTime: number | null;
  error: string | null;
  dependencyRequest: DependencyRequestPlan | null;
  updatedAt?: number;
  tasksFile?: string;
  dependsOn?: string[];
  pid?: number;
  completedTasks?: string[];
  waitingFor?: string[];
}

export interface LaneFileInfo {
  fileName: string;
  laneName: string;
  preset: string;
  taskCount: number;
  taskFlow: string;
  dependsOn: string[];
}

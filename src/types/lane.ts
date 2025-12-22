/**
 * Lane-related type definitions
 */

import type { DependencyRequestPlan } from './agent';

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
  tasksFile?: string; // Original tasks file path
  dependsOn?: string[];
  pid?: number;
  /** List of completed task names in this lane */
  completedTasks?: string[];
  /** Task-level dependencies currently being waited for (format: "lane:task") */
  waitingFor?: string[];
  /** Chat session ID */
  chatId?: string;
}

export interface LaneFileInfo {
  fileName: string;
  laneName: string;
  preset: string;
  taskCount: number;
  taskFlow: string;
  dependsOn: string[];
}


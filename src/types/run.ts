/**
 * Run-related type definitions
 */

import type { LaneInfo } from './lane';

export type RunStatus = 'running' | 'completed' | 'failed' | 'partial' | 'pending';

export interface RunInfo {
  id: string;
  path: string;
  taskName: string;
  status: RunStatus;
  startTime: number;
  endTime?: number;
  duration: number;
  lanes: LaneInfo[];
  branches: string[];
  worktrees: string[];
}

/**
 * Flow info for multiple concurrent flows
 */
export interface FlowInfo {
  id: string;
  path: string;
  status: RunStatus;
  startTime: number;
  endTime?: number;
  laneCount: number;
  completedCount: number;
  failedCount: number;
  isAlive: boolean;
  pid?: number;
}



import { LaneInfo } from './lane';

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

/**
 * API specific type definitions
 */

import { RunInfo, RunStatus, FlowInfo as BaseFlowInfo } from '../types/run';
import { FlowMeta } from '../types/flow';
import { DoctorStatus } from '../types/index';

export interface FlowInfo extends BaseFlowInfo {
  name: string;
  meta?: FlowMeta;
}

export interface ApiResponse<T> {
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

export interface LogResponse {
  logs: string[];
  nextOffset: number;
}

export interface CursorFlowEvent<T = any> {
  id: string;
  type: string;
  timestamp: string;
  runId: string;
  payload: T;
}

/**
 * Flow type definitions for CursorFlow
 * 
 * Flow: A collection of Lanes working together on a feature
 * Lane: A parallel execution path with its own worktree
 * Task: A unit of work executed by an AI agent
 */

/**
 * Flow metadata stored in flow.meta.json
 */
export interface FlowMeta {
  /** Unique ID (sequential number) */
  id: string;
  /** Human-readable flow name */
  name: string;
  /** Creation timestamp (ISO 8601) */
  createdAt: string;
  /** Creator identifier */
  createdBy: string;
  /** Git branch this flow started from */
  baseBranch: string;
  /** Current flow status */
  status: FlowStatus;
  /** List of lane names in this flow */
  lanes: string[];
}

/**
 * Flow execution status
 */
export type FlowStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Lane configuration stored in {NN}-{laneName}.json
 */
export interface LaneConfig {
  /** Lane identifier (matches filename without prefix/extension) */
  laneName: string;
  /** Branch prefix for this lane */
  branchPrefix?: string;
  /** Tasks to execute in this lane */
  tasks: FlowTask[];
}

/**
 * Task definition within a lane
 */
export interface FlowTask {
  /** Task identifier (unique within lane) */
  name: string;
  /** AI model to use */
  model: string;
  /** Task prompt/instructions */
  prompt: string;
  /** Acceptance criteria (optional) */
  acceptanceCriteria?: string[];
  /** Dependencies: wait for these tasks to complete first */
  dependsOn?: string[];
  /** Task timeout in milliseconds (optional) */
  timeout?: number;
}

/**
 * Parsed task spec from CLI --task option
 */
export interface ParsedTaskSpec {
  name: string;
  model: string;
  prompt: string;
  acceptanceCriteria?: string[];
  dependsOn?: string[];
  timeout?: number;
}

/**
 * Flow directory info for listing
 */
export interface FlowInfo {
  /** Flow ID */
  id: string;
  /** Flow name */
  name: string;
  /** Full directory path */
  path: string;
  /** Flow metadata */
  meta: FlowMeta;
  /** Lane count */
  laneCount: number;
}


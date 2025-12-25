/**
 * Central type definitions for CursorFlow
 * Re-exports all types from separate modules
 */

// Config (LaneConfig defined here)
export * from './config';

// Lane (LaneInfo, LaneState, etc.)
export * from './lane';

// Task
export * from './task';

// Flow (new architecture) - explicit exports to avoid conflicts
export { 
  FlowMeta, 
  FlowStatus, 
  FlowTask, 
  ParsedTaskSpec,
  // Note: LaneConfig and FlowInfo are also defined in config.ts and run.ts
  // Use aliases if you need the flow-specific versions:
  LaneConfig as FlowLaneConfig,
  FlowInfo as FlowDirInfo,
} from './flow';

// Agent
export * from './agent';

// Review
export * from './review';

// Events
export * from './events';

// Logging
export * from './logging';

// Run (FlowInfo also defined here - using this version as default)
export * from './run';


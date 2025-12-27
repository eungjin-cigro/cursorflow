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

// Events (기존 - 호환성 유지)
export * from './events';

// Event Categories (v2.1 - 카테고리별 분류, 새 아키텍처)
// 중복 이름은 명시적으로 제외하고 새 카테고리 관련 타입만 export
export {
  // Event Categories
  EventCategory,
  
  // Event Type Enums
  OrchestrationEventType,
  LaneEventType,
  TaskEventType,
  GitEventType,
  RecoveryEventType,
  AgentEventType,
  StateEventType,
  SystemEventType,
  AllEventTypes,
  
  // Event Payload Map & Typed Event
  EventPayloadMap,
  TypedCursorFlowEvent,
  TypedEventHandler,
  GenericEventHandler,
  getCategoryFromEventType,
  
  // New Payload Types (이름 충돌 없는 것들)
  CycleDetectedPayload,
  LaneWaitingPayload,
  LaneBlockedPayload,
  TaskRetryPayload,
  TaskWaitingDependencyPayload,
  GitBranchCreatedPayload,
  GitCommittedPayload,
  GitPushedPayload,
  GitMergeStartedPayload,
  GitMergeCompletedPayload,
  GitMergeConflictPayload,
  GitPushRejectedPayload,
  GitErrorPayload,
  RecoveryStartedPayload,
  RecoveryConflictResolvedPayload,
  AgentConnectionErrorPayload,
  StateTransitionPayload,
  StateTransitionFailedPayload,
  StateCorruptedPayload,
  StateRepairedPayload,
  SystemHealthCheckPayload,
  SystemSignalReceivedPayload,
} from './event-categories';

// Logging
export * from './logging';

// Run (FlowInfo also defined here - using this version as default)
export * from './run';


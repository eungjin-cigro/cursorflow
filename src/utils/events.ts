import { EventEmitter } from 'events';
import { 
  CursorFlowEvent, 
  EventHandler,
  OrchestrationStartedPayload,
  OrchestrationCompletedPayload,
  OrchestrationFailedPayload,
  LaneStartedPayload,
  LaneCompletedPayload,
  LaneFailedPayload,
  LaneDependencyRequestedPayload,
  TaskStartedPayload,
  TaskCompletedPayload,
  TaskFailedPayload,
  AgentPromptSentPayload,
  AgentResponseReceivedPayload,
  ReviewStartedPayload,
  ReviewCompletedPayload,
  ReviewApprovedPayload,
  ReviewRejectedPayload
} from './types';

class CursorFlowEvents extends EventEmitter {
  // Specific event overloads for emit
  emit(type: 'orchestration.started', payload: OrchestrationStartedPayload, runId: string): boolean;
  emit(type: 'orchestration.completed', payload: OrchestrationCompletedPayload, runId: string): boolean;
  emit(type: 'orchestration.failed', payload: OrchestrationFailedPayload, runId: string): boolean;
  emit(type: 'lane.started', payload: LaneStartedPayload, runId: string): boolean;
  emit(type: 'lane.completed', payload: LaneCompletedPayload, runId: string): boolean;
  emit(type: 'lane.failed', payload: LaneFailedPayload, runId: string): boolean;
  emit(type: 'lane.dependency_requested', payload: LaneDependencyRequestedPayload, runId: string): boolean;
  emit(type: 'task.started', payload: TaskStartedPayload, runId: string): boolean;
  emit(type: 'task.completed', payload: TaskCompletedPayload, runId: string): boolean;
  emit(type: 'task.failed', payload: TaskFailedPayload, runId: string): boolean;
  emit(type: 'agent.prompt_sent', payload: AgentPromptSentPayload, runId: string): boolean;
  emit(type: 'agent.response_received', payload: AgentResponseReceivedPayload, runId: string): boolean;
  emit(type: 'review.started', payload: ReviewStartedPayload, runId: string): boolean;
  emit(type: 'review.completed', payload: ReviewCompletedPayload, runId: string): boolean;
  emit(type: 'review.approved', payload: ReviewApprovedPayload, runId: string): boolean;
  emit(type: 'review.rejected', payload: ReviewRejectedPayload, runId: string): boolean;
  emit(type: string, payload: any, runId: string): boolean;
  emit(type: string, payload: any, runId: string): boolean {
    const event: CursorFlowEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      type,
      timestamp: new Date().toISOString(),
      runId,
      payload,
    };

    // Emit specific event
    super.emit(type, event);

    // Emit wildcard patterns (e.g., 'task.*' listeners)
    const parts = type.split('.');
    if (parts.length > 1) {
      const category = parts[0];
      super.emit(`${category}.*`, event);
    }
    
    super.emit('*', event);

    return true;
  }

  // Specific event overloads for on
  on(pattern: 'orchestration.started', handler: EventHandler<OrchestrationStartedPayload>): this;
  on(pattern: 'orchestration.completed', handler: EventHandler<OrchestrationCompletedPayload>): this;
  on(pattern: 'orchestration.failed', handler: EventHandler<OrchestrationFailedPayload>): this;
  on(pattern: 'lane.started', handler: EventHandler<LaneStartedPayload>): this;
  on(pattern: 'lane.completed', handler: EventHandler<LaneCompletedPayload>): this;
  on(pattern: 'lane.failed', handler: EventHandler<LaneFailedPayload>): this;
  on(pattern: 'lane.dependency_requested', handler: EventHandler<LaneDependencyRequestedPayload>): this;
  on(pattern: 'task.started', handler: EventHandler<TaskStartedPayload>): this;
  on(pattern: 'task.completed', handler: EventHandler<TaskCompletedPayload>): this;
  on(pattern: 'task.failed', handler: EventHandler<TaskFailedPayload>): this;
  on(pattern: 'agent.prompt_sent', handler: EventHandler<AgentPromptSentPayload>): this;
  on(pattern: 'agent.response_received', handler: EventHandler<AgentResponseReceivedPayload>): this;
  on(pattern: 'review.started', handler: EventHandler<ReviewStartedPayload>): this;
  on(pattern: 'review.completed', handler: EventHandler<ReviewCompletedPayload>): this;
  on(pattern: 'review.approved', handler: EventHandler<ReviewApprovedPayload>): this;
  on(pattern: 'review.rejected', handler: EventHandler<ReviewRejectedPayload>): this;
  on(pattern: string, handler: EventHandler): this;
  on(pattern: string, handler: EventHandler): this {
    return super.on(pattern, handler);
  }

  once(pattern: 'orchestration.started', handler: EventHandler<OrchestrationStartedPayload>): this;
  once(pattern: 'orchestration.completed', handler: EventHandler<OrchestrationCompletedPayload>): this;
  once(pattern: 'orchestration.failed', handler: EventHandler<OrchestrationFailedPayload>): this;
  once(pattern: 'lane.started', handler: EventHandler<LaneStartedPayload>): this;
  once(pattern: 'lane.completed', handler: EventHandler<LaneCompletedPayload>): this;
  once(pattern: 'lane.failed', handler: EventHandler<LaneFailedPayload>): this;
  once(pattern: 'lane.dependency_requested', handler: EventHandler<LaneDependencyRequestedPayload>): this;
  once(pattern: 'task.started', handler: EventHandler<TaskStartedPayload>): this;
  once(pattern: 'task.completed', handler: EventHandler<TaskCompletedPayload>): this;
  once(pattern: 'task.failed', handler: EventHandler<TaskFailedPayload>): this;
  once(pattern: 'agent.prompt_sent', handler: EventHandler<AgentPromptSentPayload>): this;
  once(pattern: 'agent.response_received', handler: EventHandler<AgentResponseReceivedPayload>): this;
  once(pattern: 'review.started', handler: EventHandler<ReviewStartedPayload>): this;
  once(pattern: 'review.completed', handler: EventHandler<ReviewCompletedPayload>): this;
  once(pattern: 'review.approved', handler: EventHandler<ReviewApprovedPayload>): this;
  once(pattern: 'review.rejected', handler: EventHandler<ReviewRejectedPayload>): this;
  once(pattern: string, handler: EventHandler): this;
  once(pattern: string, handler: EventHandler): this {
    return super.once(pattern, handler);
  }
}

export const events = new CursorFlowEvents();


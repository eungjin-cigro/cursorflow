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
} from './types';

class CursorFlowEvents extends EventEmitter {
  private runId: string = '';

  setRunId(id: string) {
    this.runId = id;
  }

  // Specific event overloads for emit
  emit(type: 'orchestration.started', payload: OrchestrationStartedPayload): boolean;
  emit(type: 'orchestration.completed', payload: OrchestrationCompletedPayload): boolean;
  emit(type: 'orchestration.failed', payload: OrchestrationFailedPayload): boolean;
  emit(type: 'lane.started', payload: LaneStartedPayload): boolean;
  emit(type: 'lane.completed', payload: LaneCompletedPayload): boolean;
  emit(type: 'lane.failed', payload: LaneFailedPayload): boolean;
  emit(type: 'lane.dependency_requested', payload: LaneDependencyRequestedPayload): boolean;
  emit(type: 'task.started', payload: TaskStartedPayload): boolean;
  emit(type: 'task.completed', payload: TaskCompletedPayload): boolean;
  emit(type: 'task.failed', payload: TaskFailedPayload): boolean;
  emit(type: 'agent.prompt_sent', payload: AgentPromptSentPayload): boolean;
  emit(type: 'agent.response_received', payload: AgentResponseReceivedPayload): boolean;
  emit(type: string, payload: any): boolean;
  emit(type: string, payload: any): boolean {
    const event: CursorFlowEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      type,
      timestamp: new Date().toISOString(),
      runId: this.runId,
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
  once(pattern: string, handler: EventHandler): this;
  once(pattern: string, handler: EventHandler): this {
    return super.once(pattern, handler);
  }
}

export const events = new CursorFlowEvents();


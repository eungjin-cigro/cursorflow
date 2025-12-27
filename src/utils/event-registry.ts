/**
 * Event Registry - 타입화된 이벤트 버스
 * 
 * 기존 events.ts를 확장하여 타입 안전한 이벤트 발행/구독을 제공합니다.
 * 
 * 특징:
 * - 타입 안전한 이벤트 발행/구독
 * - 카테고리별 이벤트 필터링
 * - 이벤트 히스토리 관리
 * - 이벤트 직렬화/역직렬화
 */

import { EventEmitter } from 'events';
import {
  EventCategory,
  AllEventTypes,
  EventPayloadMap,
  TypedCursorFlowEvent,
  TypedEventHandler,
  GenericEventHandler,
  getCategoryFromEventType,
  
  // Event Types
  OrchestrationEventType,
  LaneEventType,
  TaskEventType,
  GitEventType,
  RecoveryEventType,
  AgentEventType,
  StateEventType,
  SystemEventType,
} from '../types/event-categories';

// ============================================================================
// Event Registry Configuration
// ============================================================================

/**
 * 이벤트 레지스트리 설정
 */
export interface EventRegistryConfig {
  /** 이벤트 히스토리 최대 크기 (0 = 무제한) */
  maxHistorySize: number;
  /** 이벤트 히스토리 유지 시간 (ms, 0 = 영구) */
  historyTtlMs: number;
  /** 디버그 모드 */
  debug: boolean;
  /** 이벤트 발행 시 콘솔 출력 */
  logEvents: boolean;
  /** 로그할 이벤트 카테고리 (빈 배열 = 모두) */
  logCategories: EventCategory[];
}

const DEFAULT_CONFIG: EventRegistryConfig = {
  maxHistorySize: 1000,
  historyTtlMs: 30 * 60 * 1000, // 30분
  debug: false,
  logEvents: false,
  logCategories: [],
};

// ============================================================================
// Event Registry
// ============================================================================

/**
 * 타입화된 이벤트 레지스트리
 * 
 * 사용 예:
 * ```typescript
 * const registry = EventRegistry.getInstance();
 * 
 * // 타입 안전한 이벤트 발행
 * registry.emit(OrchestrationEventType.STARTED, {
 *   runId: 'run-123',
 *   tasksDir: '/path/to/tasks',
 *   laneCount: 3,
 *   runRoot: '/path/to/run'
 * });
 * 
 * // 타입 안전한 이벤트 구독
 * registry.on(LaneEventType.COMPLETED, (event) => {
 *   console.log(event.payload.laneName, event.payload.exitCode);
 * });
 * 
 * // 카테고리별 구독
 * registry.onCategory(EventCategory.GIT, (event) => {
 *   console.log('Git event:', event.type);
 * });
 * 
 * // 와일드카드 구독
 * registry.onAny((event) => {
 *   console.log('Any event:', event.type);
 * });
 * ```
 */
export class EventRegistry extends EventEmitter {
  private static instance: EventRegistry | null = null;
  
  private config: EventRegistryConfig;
  private runId: string = '';
  private eventHistory: TypedCursorFlowEvent[] = [];
  private categoryHandlers: Map<EventCategory, GenericEventHandler[]> = new Map();
  
  private constructor(config: Partial<EventRegistryConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.setMaxListeners(100); // 많은 리스너 허용
  }
  
  /**
   * 싱글톤 인스턴스 획득
   */
  static getInstance(config?: Partial<EventRegistryConfig>): EventRegistry {
    if (!EventRegistry.instance) {
      EventRegistry.instance = new EventRegistry(config);
    } else if (config) {
      EventRegistry.instance.updateConfig(config);
    }
    return EventRegistry.instance;
  }
  
  /**
   * 인스턴스 리셋 (테스트용)
   */
  static resetInstance(): void {
    EventRegistry.instance = null;
  }
  
  /**
   * 설정 업데이트
   */
  updateConfig(config: Partial<EventRegistryConfig>): void {
    this.config = { ...this.config, ...config };
  }
  
  /**
   * Run ID 설정
   */
  setRunId(id: string): void {
    this.runId = id;
  }
  
  /**
   * Run ID 조회
   */
  getRunId(): string {
    return this.runId;
  }
  
  // --------------------------------------------------------------------------
  // Type-safe Event Emission
  // --------------------------------------------------------------------------
  
  /**
   * 타입 안전한 이벤트 발행
   */
  emit<T extends keyof EventPayloadMap>(
    type: T,
    payload: EventPayloadMap[T],
    options: { laneName?: string } = {}
  ): boolean {
    const category = getCategoryFromEventType(type as string);
    
    const event: TypedCursorFlowEvent<T> = {
      id: this.generateEventId(),
      type,
      category,
      timestamp: new Date().toISOString(),
      runId: this.runId,
      laneName: options.laneName || this.extractLaneName(payload),
      payload,
    };
    
    // 히스토리에 추가
    this.addToHistory(event as TypedCursorFlowEvent);
    
    // 디버그 로깅
    if (this.config.logEvents && this.shouldLogEvent(category)) {
      this.logEvent(event as TypedCursorFlowEvent);
    }
    
    // 이벤트 발행
    super.emit(type as string, event);
    
    // 카테고리별 핸들러 호출
    const categoryHandlers = this.categoryHandlers.get(category);
    if (categoryHandlers) {
      for (const handler of categoryHandlers) {
        try {
          handler(event as TypedCursorFlowEvent);
        } catch (error) {
          console.error(`Event handler error for ${type}:`, error);
        }
      }
    }
    
    // 와일드카드 패턴 발행
    super.emit(`${category}.*`, event);
    super.emit('*', event);
    
    return true;
  }
  
  /**
   * 이벤트 ID 생성
   */
  private generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  
  /**
   * 페이로드에서 laneName 추출
   */
  private extractLaneName(payload: any): string | undefined {
    if (typeof payload === 'object' && payload !== null) {
      return payload.laneName;
    }
    return undefined;
  }
  
  // --------------------------------------------------------------------------
  // Type-safe Event Subscription
  // --------------------------------------------------------------------------
  
  /**
   * 타입 안전한 이벤트 구독
   */
  on<T extends keyof EventPayloadMap>(
    type: T,
    handler: TypedEventHandler<T>
  ): this {
    return super.on(type as string, handler);
  }
  
  /**
   * 일회성 이벤트 구독
   */
  once<T extends keyof EventPayloadMap>(
    type: T,
    handler: TypedEventHandler<T>
  ): this {
    return super.once(type as string, handler);
  }
  
  /**
   * 이벤트 구독 해제
   */
  off<T extends keyof EventPayloadMap>(
    type: T,
    handler: TypedEventHandler<T>
  ): this {
    return super.off(type as string, handler);
  }
  
  /**
   * 카테고리별 이벤트 구독
   */
  onCategory(category: EventCategory, handler: GenericEventHandler): () => void {
    if (!this.categoryHandlers.has(category)) {
      this.categoryHandlers.set(category, []);
    }
    this.categoryHandlers.get(category)!.push(handler);
    
    // 와일드카드 패턴도 등록
    super.on(`${category}.*`, handler);
    
    // 구독 해제 함수 반환
    return () => {
      const handlers = this.categoryHandlers.get(category);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index > -1) {
          handlers.splice(index, 1);
        }
      }
      super.off(`${category}.*`, handler);
    };
  }
  
  /**
   * 모든 이벤트 구독
   */
  onAny(handler: GenericEventHandler): () => void {
    super.on('*', handler);
    
    return () => {
      super.off('*', handler);
    };
  }
  
  // --------------------------------------------------------------------------
  // Event History
  // --------------------------------------------------------------------------
  
  /**
   * 히스토리에 이벤트 추가
   */
  private addToHistory(event: TypedCursorFlowEvent): void {
    this.eventHistory.push(event);
    
    // 크기 제한 적용
    if (this.config.maxHistorySize > 0 && this.eventHistory.length > this.config.maxHistorySize) {
      this.eventHistory = this.eventHistory.slice(-this.config.maxHistorySize);
    }
    
    // TTL 적용
    if (this.config.historyTtlMs > 0) {
      const cutoffTime = Date.now() - this.config.historyTtlMs;
      this.eventHistory = this.eventHistory.filter(
        e => new Date(e.timestamp).getTime() > cutoffTime
      );
    }
  }
  
  /**
   * 이벤트 히스토리 조회
   */
  getHistory(options: {
    category?: EventCategory;
    laneName?: string;
    type?: string;
    since?: number;
    limit?: number;
  } = {}): TypedCursorFlowEvent[] {
    let result = this.eventHistory;
    
    if (options.category) {
      result = result.filter(e => e.category === options.category);
    }
    
    if (options.laneName) {
      result = result.filter(e => e.laneName === options.laneName);
    }
    
    if (options.type) {
      result = result.filter(e => e.type === options.type);
    }
    
    if (options.since) {
      result = result.filter(e => new Date(e.timestamp).getTime() >= options.since!);
    }
    
    if (options.limit) {
      result = result.slice(-options.limit);
    }
    
    return result;
  }
  
  /**
   * Lane별 이벤트 히스토리 조회
   */
  getLaneHistory(laneName: string, limit?: number): TypedCursorFlowEvent[] {
    return this.getHistory({ laneName, limit });
  }
  
  /**
   * 카테고리별 이벤트 히스토리 조회
   */
  getCategoryHistory(category: EventCategory, limit?: number): TypedCursorFlowEvent[] {
    return this.getHistory({ category, limit });
  }
  
  /**
   * 히스토리 초기화
   */
  clearHistory(): void {
    this.eventHistory = [];
  }
  
  // --------------------------------------------------------------------------
  // Event Logging
  // --------------------------------------------------------------------------
  
  /**
   * 이벤트 로깅 여부 결정
   */
  private shouldLogEvent(category: EventCategory): boolean {
    if (this.config.logCategories.length === 0) {
      return true;
    }
    return this.config.logCategories.includes(category);
  }
  
  /**
   * 이벤트 로깅
   */
  private logEvent(event: TypedCursorFlowEvent): void {
    const { type, category, laneName, timestamp } = event;
    const laneLabel = laneName ? `[${laneName}]` : '';
    console.log(`[Event] ${timestamp} ${category}.${type.split('.')[1]} ${laneLabel}`);
    
    if (this.config.debug) {
      console.log('  Payload:', JSON.stringify(event.payload, null, 2));
    }
  }
  
  // --------------------------------------------------------------------------
  // Event Serialization
  // --------------------------------------------------------------------------
  
  /**
   * 이벤트를 JSON으로 직렬화
   */
  serializeEvent(event: TypedCursorFlowEvent): string {
    return JSON.stringify(event);
  }
  
  /**
   * JSON에서 이벤트 역직렬화
   */
  deserializeEvent(json: string): TypedCursorFlowEvent | null {
    try {
      return JSON.parse(json) as TypedCursorFlowEvent;
    } catch {
      return null;
    }
  }
  
  /**
   * 히스토리를 JSONL 형식으로 내보내기
   */
  exportHistory(): string {
    return this.eventHistory.map(e => JSON.stringify(e)).join('\n');
  }
  
  /**
   * JSONL에서 히스토리 가져오기
   */
  importHistory(jsonl: string): number {
    const lines = jsonl.split('\n').filter(l => l.trim());
    let imported = 0;
    
    for (const line of lines) {
      const event = this.deserializeEvent(line);
      if (event) {
        this.eventHistory.push(event);
        imported++;
      }
    }
    
    return imported;
  }
  
  // --------------------------------------------------------------------------
  // Convenience Methods
  // --------------------------------------------------------------------------
  
  /**
   * 마지막 이벤트 조회
   */
  getLastEvent(laneName?: string): TypedCursorFlowEvent | undefined {
    if (laneName) {
      const laneHistory = this.getLaneHistory(laneName, 1);
      return laneHistory[0];
    }
    return this.eventHistory[this.eventHistory.length - 1];
  }
  
  /**
   * 이벤트 카운트 조회
   */
  getEventCount(options: {
    category?: EventCategory;
    laneName?: string;
  } = {}): number {
    return this.getHistory(options).length;
  }
  
  /**
   * 특정 이벤트 대기 (Promise)
   */
  waitFor<T extends keyof EventPayloadMap>(
    type: T,
    options: {
      timeout?: number;
      filter?: (event: TypedCursorFlowEvent<T>) => boolean;
    } = {}
  ): Promise<TypedCursorFlowEvent<T>> {
    return new Promise((resolve, reject) => {
      const timeout = options.timeout || 30000;
      
      const timer = setTimeout(() => {
        this.off(type, handler);
        reject(new Error(`Timeout waiting for event: ${type}`));
      }, timeout);
      
      const handler: TypedEventHandler<T> = (event) => {
        if (!options.filter || options.filter(event)) {
          clearTimeout(timer);
          this.off(type, handler);
          resolve(event);
        }
      };
      
      this.on(type, handler);
    });
  }
}

// ============================================================================
// Event Type Guards
// ============================================================================

/**
 * Orchestration 이벤트인지 확인
 */
export function isOrchestrationEvent(event: TypedCursorFlowEvent): boolean {
  return event.category === EventCategory.ORCHESTRATION;
}

/**
 * Lane 이벤트인지 확인
 */
export function isLaneEvent(event: TypedCursorFlowEvent): boolean {
  return event.category === EventCategory.LANE;
}

/**
 * Task 이벤트인지 확인
 */
export function isTaskEvent(event: TypedCursorFlowEvent): boolean {
  return event.category === EventCategory.TASK;
}

/**
 * Git 이벤트인지 확인
 */
export function isGitEvent(event: TypedCursorFlowEvent): boolean {
  return event.category === EventCategory.GIT;
}

/**
 * Recovery 이벤트인지 확인
 */
export function isRecoveryEvent(event: TypedCursorFlowEvent): boolean {
  return event.category === EventCategory.RECOVERY;
}

/**
 * 오류 이벤트인지 확인
 */
export function isErrorEvent(event: TypedCursorFlowEvent): boolean {
  const errorTypes = [
    OrchestrationEventType.FAILED,
    LaneEventType.FAILED,
    TaskEventType.FAILED,
    GitEventType.ERROR,
    GitEventType.MERGE_CONFLICT,
    GitEventType.PUSH_REJECTED,
    AgentEventType.CONNECTION_ERROR,
    AgentEventType.AUTH_ERROR,
    AgentEventType.TIMEOUT,
    StateEventType.TRANSITION_FAILED,
    StateEventType.CORRUPTED,
  ];
  
  return errorTypes.includes(event.type as any);
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * 싱글톤 인스턴스 획득
 */
export function getEventRegistry(config?: Partial<EventRegistryConfig>): EventRegistry {
  return EventRegistry.getInstance(config);
}

/**
 * 인스턴스 리셋 (테스트용)
 */
export function resetEventRegistry(): void {
  EventRegistry.resetInstance();
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export {
  EventCategory,
  OrchestrationEventType,
  LaneEventType,
  TaskEventType,
  GitEventType,
  RecoveryEventType,
  AgentEventType,
  StateEventType,
  SystemEventType,
};


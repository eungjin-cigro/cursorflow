/**
 * CursorFlow Hook System
 * 
 * 외부 개발자가 Supervisor AI, 모니터링 시스템, 커스텀 로직 등을
 * 구현할 수 있도록 제공하는 Hook API입니다.
 * 
 * ## Quick Start
 * 
 * ```typescript
 * import { hooks, HookPoint } from '@litmers/cursorflow-orchestrator';
 * 
 * // 태스크 완료 후 결과 리뷰
 * hooks.register({
 *   point: HookPoint.AFTER_TASK,
 *   mode: 'sync',
 *   name: 'my-reviewer',
 *   handler: async (ctx) => {
 *     // 수정된 파일 확인
 *     const files = await ctx.getData.git.getChangedFiles();
 *     console.log('Modified files:', files.map(f => f.path));
 *     
 *     // AI 응답 분석
 *     const response = await ctx.getData.conversation.getLastResponse();
 *     
 *     // 필요시 추가 태스크 삽입
 *     if (needsFix(response)) {
 *       ctx.flow.injectTask({
 *         name: 'Fix: ' + ctx.task.name,
 *         prompt: 'Fix the issues...',
 *       });
 *     }
 *   },
 * });
 * ```
 * 
 * ## Hook Points
 * 
 * | Hook Point | 트리거 시점 | 주요 용도 |
 * |------------|------------|----------|
 * | `beforeTask` | 태스크 실행 직전 | 프롬프트 검토/수정 |
 * | `afterTask` | 태스크 완료 직후 | 결과 리뷰, 태스크 삽입 |
 * | `onError` | 에러 발생 시 | 에러 분석, 복구 |
 * | `onStall` | 응답 없음 감지 시 | 상황 분석, 개입 |
 * | `onLaneEnd` | Lane 종료 시 | 최종 리뷰, 보고서 |
 * 
 * ## Configuration
 * 
 * `.cursorflow.json`에서 Hook 설정:
 * 
 * ```json
 * {
 *   "hooks": {
 *     "file": "./cursorflow.hooks.ts",
 *     "timeout": 30000,
 *     "continueOnError": false
 *   }
 * }
 * ```
 * 
 * @module hooks
 */

// ============================================================================
// Type Exports
// ============================================================================

export {
  // Hook Points & Modes
  HookPoint,
  HookMode,
  
  // Context Types
  HookContext,
  BeforeTaskContext,
  AfterTaskContext,
  OnErrorContext,
  OnStallContext,
  OnLaneEndContext,
  
  // Data Types
  ChangedFile,
  Commit,
  Message,
  TaskResult,
  TaskDefinition,
  ToolCall,
  ErrorLog,
  DependencyResult,
  
  // Interface Types
  HookDataAccessor,
  FlowController,
  AICallOptions,
  
  // Registration Types
  HookRegistration,
  HookExecutionResult,
  HookHandlerMap,
  
  // Config Types
  HooksConfig,
} from './types';

// ============================================================================
// Manager Exports
// ============================================================================

export {
  HookManager,
  hooks,
  getHookManager,
  resetHookManager,
} from './manager';

// ============================================================================
// Implementation Exports (for advanced usage)
// ============================================================================

export {
  HookDataAccessorImpl,
  DataAccessorOptions,
  createDataAccessor,
} from './data-accessor';

export {
  FlowControllerImpl,
  FlowControllerOptions,
  FlowControlState,
  FlowAbortError,
  FlowRetryError,
  createFlowController,
} from './flow-controller';

// ============================================================================
// Context Builder Exports (for internal/advanced usage)
// ============================================================================

export {
  BaseContextOptions,
  createBeforeTaskContext,
  createAfterTaskContext,
  createOnErrorContext,
  createOnStallContext,
  createOnLaneEndContext,
} from './contexts';

// ============================================================================
// Re-export for convenience
// ============================================================================

// Default export: hooks singleton
import { hooks as hooksSingleton } from './manager';
export default hooksSingleton;


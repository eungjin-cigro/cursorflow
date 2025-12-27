/**
 * CursorFlow Hook System - Hook Manager
 * 
 * Hook 등록 및 실행을 관리하는 중앙 매니저입니다.
 * 외부 개발자가 Hook을 등록하고 CursorFlow가 적절한 시점에 실행합니다.
 * 
 * @example
 * ```typescript
 * import { hooks, HookPoint } from '@litmers/cursorflow-orchestrator';
 * 
 * hooks.register({
 *   point: HookPoint.AFTER_TASK,
 *   mode: 'sync',
 *   handler: async (ctx) => {
 *     // Your logic here
 *   },
 * });
 * ```
 */

import * as logger from '../utils/logger';
import {
  HookPoint,
  HookMode,
  HookRegistration,
  HookExecutionResult,
  HookContext,
  BeforeTaskContext,
  AfterTaskContext,
  OnErrorContext,
  OnStallContext,
  OnLaneEndContext,
  HooksConfig,
} from './types';

// ============================================================================
// Hook Manager
// ============================================================================

/**
 * Hook Manager 클래스
 * 
 * 싱글톤 패턴으로 구현되어 전역에서 접근 가능합니다.
 */
export class HookManager {
  private static instance: HookManager | null = null;
  
  /** 등록된 Hook 목록 (Hook Point별로 분류) */
  private hooks: Map<HookPoint, HookRegistration[]> = new Map();
  
  /** 설정 */
  private config: HooksConfig = {
    timeout: 30000,
    continueOnError: false,
    debug: false,
  };
  
  private constructor() {
    // 각 Hook Point에 대해 빈 배열 초기화
    for (const point of Object.values(HookPoint)) {
      this.hooks.set(point, []);
    }
  }
  
  /**
   * 싱글톤 인스턴스 획득
   */
  static getInstance(): HookManager {
    if (!HookManager.instance) {
      HookManager.instance = new HookManager();
    }
    return HookManager.instance;
  }
  
  /**
   * 인스턴스 리셋 (테스트용)
   */
  static resetInstance(): void {
    HookManager.instance = null;
  }
  
  // ==========================================================================
  // Configuration
  // ==========================================================================
  
  /**
   * 설정 업데이트
   */
  configure(config: Partial<HooksConfig>): void {
    this.config = { ...this.config, ...config };
  }
  
  /**
   * 현재 설정 조회
   */
  getConfig(): HooksConfig {
    return { ...this.config };
  }
  
  // ==========================================================================
  // Hook Registration
  // ==========================================================================
  
  /**
   * Hook 등록
   * 
   * @param registration Hook 등록 정보
   * @returns 등록 해제 함수
   */
  register<T extends HookPoint>(registration: HookRegistration<T>): () => void {
    const { point, priority = 50, name, enabled = true } = registration;
    
    if (!enabled) {
      if (this.config.debug) {
        logger.debug(`[HookManager] Skipping disabled hook: ${name || 'unnamed'}`);
      }
      return () => {};
    }
    
    const hooks = this.hooks.get(point) || [];
    
    // 우선순위에 따라 정렬된 위치에 삽입
    const insertIndex = hooks.findIndex(h => (h.priority || 50) > priority);
    if (insertIndex === -1) {
      hooks.push(registration);
    } else {
      hooks.splice(insertIndex, 0, registration);
    }
    
    this.hooks.set(point, hooks);
    
    if (this.config.debug) {
      logger.debug(`[HookManager] Registered hook "${name || 'unnamed'}" at ${point} (priority: ${priority})`);
    }
    
    // 등록 해제 함수 반환
    return () => {
      this.unregister(point, registration);
    };
  }
  
  /**
   * Hook 등록 해제
   */
  private unregister<T extends HookPoint>(point: T, registration: HookRegistration<T>): void {
    const hooks = this.hooks.get(point) || [];
    const index = hooks.indexOf(registration as any);
    
    if (index !== -1) {
      hooks.splice(index, 1);
      this.hooks.set(point, hooks);
      
      if (this.config.debug) {
        logger.debug(`[HookManager] Unregistered hook "${registration.name || 'unnamed'}" from ${point}`);
      }
    }
  }
  
  /**
   * 특정 Hook Point의 모든 Hook 제거
   */
  clearHooks(point?: HookPoint): void {
    if (point) {
      this.hooks.set(point, []);
    } else {
      for (const p of Object.values(HookPoint)) {
        this.hooks.set(p, []);
      }
    }
  }
  
  /**
   * 등록된 Hook 수 조회
   */
  getHookCount(point?: HookPoint): number {
    if (point) {
      return this.hooks.get(point)?.length || 0;
    }
    
    let total = 0;
    for (const hooks of this.hooks.values()) {
      total += hooks.length;
    }
    return total;
  }
  
  /**
   * Hook 등록 여부 확인
   */
  hasHooks(point: HookPoint): boolean {
    return (this.hooks.get(point)?.length || 0) > 0;
  }
  
  // ==========================================================================
  // Hook Execution
  // ==========================================================================
  
  /**
   * beforeTask Hook 실행
   */
  async executeBeforeTask(context: BeforeTaskContext): Promise<HookExecutionResult[]> {
    return this.execute(HookPoint.BEFORE_TASK, context);
  }
  
  /**
   * afterTask Hook 실행
   */
  async executeAfterTask(context: AfterTaskContext): Promise<HookExecutionResult[]> {
    return this.execute(HookPoint.AFTER_TASK, context);
  }
  
  /**
   * onError Hook 실행
   */
  async executeOnError(context: OnErrorContext): Promise<HookExecutionResult[]> {
    return this.execute(HookPoint.ON_ERROR, context);
  }
  
  /**
   * onStall Hook 실행
   */
  async executeOnStall(context: OnStallContext): Promise<HookExecutionResult[]> {
    return this.execute(HookPoint.ON_STALL, context);
  }
  
  /**
   * onLaneEnd Hook 실행
   */
  async executeOnLaneEnd(context: OnLaneEndContext): Promise<HookExecutionResult[]> {
    return this.execute(HookPoint.ON_LANE_END, context);
  }
  
  /**
   * 일반 Hook 실행
   */
  async execute<T extends HookPoint>(
    point: T,
    context: HookContext
  ): Promise<HookExecutionResult[]> {
    const hooks = this.hooks.get(point) || [];
    
    if (hooks.length === 0) {
      return [];
    }
    
    if (this.config.debug) {
      logger.debug(`[HookManager] Executing ${hooks.length} hooks for ${point}`);
    }
    
    const results: HookExecutionResult[] = [];
    const syncHooks = hooks.filter(h => h.mode === 'sync');
    const asyncHooks = hooks.filter(h => h.mode === 'async');
    
    // 동기 Hook 순차 실행 (블로킹)
    for (const hook of syncHooks) {
      const result = await this.executeHook(hook, context);
      results.push(result);
      
      // 에러 발생 시 중단 여부 결정
      if (!result.success && !this.config.continueOnError) {
        logger.error(`[HookManager] Hook "${hook.name || 'unnamed'}" failed, stopping execution`);
        break;
      }
    }
    
    // 비동기 Hook 병렬 실행 (논블로킹)
    if (asyncHooks.length > 0) {
      // 비동기 Hook은 백그라운드에서 실행 (결과를 기다리지 않음)
      Promise.all(
        asyncHooks.map(hook => this.executeHook(hook, context))
      ).then(asyncResults => {
        for (const result of asyncResults) {
          if (!result.success) {
            logger.warn(`[HookManager] Async hook "${result.handlerName || 'unnamed'}" failed: ${result.error?.message}`);
          }
        }
      }).catch(error => {
        logger.error(`[HookManager] Async hooks error: ${error.message}`);
      });
    }
    
    return results;
  }
  
  /**
   * 단일 Hook 실행
   */
  private async executeHook(
    hook: HookRegistration,
    context: HookContext
  ): Promise<HookExecutionResult> {
    const startTime = Date.now();
    const handlerName = hook.name || 'unnamed';
    
    try {
      // 타임아웃 설정
      const timeout = this.config.timeout || 30000;
      
      const result = await Promise.race([
        (hook.handler as any)(context),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Hook timeout after ${timeout}ms`)), timeout)
        ),
      ]);
      
      const duration = Date.now() - startTime;
      
      if (this.config.debug) {
        logger.debug(`[HookManager] Hook "${handlerName}" completed in ${duration}ms`);
      }
      
      return {
        success: true,
        duration,
        handlerName,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      // FlowAbortError와 FlowRetryError는 정상적인 플로우 제어이므로 다시 throw
      if (error.name === 'FlowAbortError' || error.name === 'FlowRetryError') {
        throw error;
      }
      
      logger.error(`[HookManager] Hook "${handlerName}" error: ${error.message}`);
      
      return {
        success: false,
        error,
        duration,
        handlerName,
      };
    }
  }
  
  // ==========================================================================
  // Hook Loading
  // ==========================================================================
  
  /**
   * 파일에서 Hook 로드
   */
  async loadHooksFromFile(filePath: string): Promise<number> {
    try {
      // TypeScript/JavaScript 파일 동적 로드
      const resolved = require.resolve(filePath);
      
      // 캐시 삭제 (개발 중 핫 리로드를 위해)
      delete require.cache[resolved];
      
      const module = await import(resolved);
      
      // 모듈이 HookManager를 반환하거나 register를 호출했으면 성공
      if (this.config.debug) {
        logger.debug(`[HookManager] Loaded hooks from ${filePath}`);
      }
      
      return this.getHookCount();
    } catch (error: any) {
      logger.error(`[HookManager] Failed to load hooks from ${filePath}: ${error.message}`);
      throw error;
    }
  }
  
  // ==========================================================================
  // Debug & Inspection
  // ==========================================================================
  
  /**
   * 등록된 Hook 목록 조회
   */
  listHooks(point?: HookPoint): Array<{ point: HookPoint; name: string; mode: HookMode; priority: number }> {
    const result: Array<{ point: HookPoint; name: string; mode: HookMode; priority: number }> = [];
    
    const points = point ? [point] : Object.values(HookPoint);
    
    for (const p of points) {
      const hooks = this.hooks.get(p) || [];
      for (const hook of hooks) {
        result.push({
          point: p,
          name: hook.name || 'unnamed',
          mode: hook.mode,
          priority: hook.priority || 50,
        });
      }
    }
    
    return result;
  }
  
  /**
   * 디버그 정보 출력
   */
  debug(): void {
    logger.info('=== HookManager Debug ===');
    logger.info(`Config: ${JSON.stringify(this.config)}`);
    logger.info(`Total hooks: ${this.getHookCount()}`);
    
    for (const point of Object.values(HookPoint)) {
      const hooks = this.hooks.get(point) || [];
      if (hooks.length > 0) {
        logger.info(`  ${point}: ${hooks.length} hooks`);
        for (const hook of hooks) {
          logger.info(`    - ${hook.name || 'unnamed'} (${hook.mode}, priority: ${hook.priority || 50})`);
        }
      }
    }
  }
}

// ============================================================================
// Singleton Instance & Convenience API
// ============================================================================

/**
 * 전역 HookManager 인스턴스
 */
export const hooks = HookManager.getInstance();

/**
 * HookManager 인스턴스 획득
 */
export function getHookManager(): HookManager {
  return HookManager.getInstance();
}

/**
 * HookManager 인스턴스 리셋 (테스트용)
 */
export function resetHookManager(): void {
  HookManager.resetInstance();
}


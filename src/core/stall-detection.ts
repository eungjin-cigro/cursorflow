/**
 * Stall Detection Service - 통합된 교착 상태 감지 및 복구 시스템
 * 
 * 기존 분산된 로직을 단일 모듈로 통합:
 * - orchestrator.ts의 RunningLaneInfo 상태 관리
 * - failure-policy.ts의 analyzeStall() 분석 로직
 * - auto-recovery.ts의 AutoRecoveryManager 복구 로직
 * 
 * 핵심 원칙:
 * 1. 단일 상태 저장소 (Single Source of Truth)
 * 2. 명확한 상태 전이 (State Machine)
 * 3. 실제 활동만 타이머 리셋 (Heartbeat 제외)
 */

import * as fs from 'fs';
import { ChildProcess } from 'child_process';

import * as logger from '../utils/logger';
import { events } from '../utils/events';
import { safeJoin } from '../utils/path';
import {
  createInterventionRequest,
  InterventionType,
  createContinueMessage,
  createStrongerPromptMessage,
  createRestartMessage,
  killAndWait,
} from './intervention';

// ============================================================================
// 설정 (Configuration)
// ============================================================================

/**
 * Stall 감지 설정
 * 
 * 모든 타임아웃 및 패턴을 한 곳에서 관리
 */
export interface StallDetectionConfig {
  /** stdout 활동 없이 대기하는 시간 (기본: 2분) */
  idleTimeoutMs: number;
  /** state.json 업데이트 없이 대기하는 시간 (기본: 10분) */
  progressTimeoutMs: number;
  /** 단일 태스크 최대 실행 시간 (기본: 30분) */
  taskTimeoutMs: number;
  /** 장기 작업 감지 패턴 */
  longOperationPatterns: RegExp[];
  /** 장기 작업 유예 시간 (기본: 10분) */
  longOperationGraceMs: number;
  /** continue 신호 후 유예 시간 (기본: 2분) */
  continueGraceMs: number;
  /** stronger prompt 후 유예 시간 (기본: 2분) */
  strongerPromptGraceMs: number;
  /** 최대 재시작 횟수 (기본: 2) */
  maxRestarts: number;
  /** 실패 시 doctor 실행 여부 (기본: true) */
  runDoctorOnFailure: boolean;
  /** 디버그 로깅 활성화 */
  verbose: boolean;
}

export const DEFAULT_STALL_CONFIG: StallDetectionConfig = {
  idleTimeoutMs: 2 * 60 * 1000,          // 2분 - idle 감지
  progressTimeoutMs: 10 * 60 * 1000,     // 10분 - progress 감지
  taskTimeoutMs: 30 * 60 * 1000,         // 30분 - task timeout
  longOperationPatterns: [
    /installing\s+dependencies/i,
    /npm\s+(i|install|ci)/i,
    /pnpm\s+(i|install)/i,
    /yarn\s+(install)?/i,
    /building/i,
    /compiling/i,
    /bundling/i,
    /downloading/i,
    /fetching/i,
    /cloning/i,
  ],
  longOperationGraceMs: 10 * 60 * 1000,  // 10분 - 장기 작업 유예
  continueGraceMs: 2 * 60 * 1000,        // 2분 - continue 후 유예
  strongerPromptGraceMs: 2 * 60 * 1000,  // 2분 - stronger prompt 후 유예
  maxRestarts: 2,
  runDoctorOnFailure: true,
  verbose: false,
};

// ============================================================================
// 상태 정의 (State Definitions)
// ============================================================================

/**
 * Stall 복구 단계 (State Machine)
 * 
 * 상태 전이:
 * NORMAL → CONTINUE_SENT → STRONGER_PROMPT_SENT → RESTART_REQUESTED → DIAGNOSED → ABORTED
 *    ↑__________________________________________________________|
 *                    (실제 활동 감지 시 리셋)
 */
export enum StallPhase {
  /** 정상 작동 - 모니터링 중 */
  NORMAL = 0,
  /** Continue 신호 발송 완료 - 응답 대기 */
  CONTINUE_SENT = 1,
  /** Stronger prompt 발송 완료 - 응답 대기 */
  STRONGER_PROMPT_SENT = 2,
  /** 재시작 요청 - 프로세스 종료/재시작 중 */
  RESTART_REQUESTED = 3,
  /** 진단 완료 - 더 이상 복구 불가 */
  DIAGNOSED = 4,
  /** 최종 실패 - 중단됨 */
  ABORTED = 5,
}

/**
 * 복구 액션 종류
 */
export enum RecoveryAction {
  /** 액션 필요 없음 - 정상 */
  NONE = 'NONE',
  /** Continue 신호 발송 */
  SEND_CONTINUE = 'SEND_CONTINUE',
  /** Stronger prompt 발송 */
  SEND_STRONGER_PROMPT = 'SEND_STRONGER_PROMPT',
  /** 프로세스 재시작 요청 */
  REQUEST_RESTART = 'REQUEST_RESTART',
  /** Doctor 실행 및 진단 */
  RUN_DOCTOR = 'RUN_DOCTOR',
  /** 레인 중단 */
  ABORT_LANE = 'ABORT_LANE',
}

/**
 * Stall 유형
 */
export enum StallType {
  /** stdout이 idle 상태 */
  IDLE = 'IDLE',
  /** state.json이 업데이트되지 않음 */
  NO_PROGRESS = 'NO_PROGRESS',
  /** 0바이트 수신 (에이전트 무응답) */
  ZERO_BYTES = 'ZERO_BYTES',
  /** 태스크 타임아웃 */
  TASK_TIMEOUT = 'TASK_TIMEOUT',
}

/**
 * Lane별 Stall 상태 (Single Source of Truth)
 */
export interface LaneStallState {
  /** Lane 이름 */
  laneName: string;
  /** 현재 복구 단계 */
  phase: StallPhase;
  /** Lane의 현재 상태 (waiting, running 등) - waiting 시 stall 분석 스킵 */
  laneStatus?: string;
  /** Intervention 활성화 여부 - false면 continue 신호 스킵 */
  interventionEnabled?: boolean;
  /** 마지막 실제 활동 시간 (bytes > 0) */
  lastRealActivityTime: number;
  /** 마지막 상태 변경 시간 (phase 변경) */
  lastPhaseChangeTime: number;
  /** 마지막 state.json 업데이트 시간 */
  lastStateUpdateTime: number;
  /** 태스크 시작 시간 */
  taskStartTime: number;
  /** 마지막 출력 라인 (장기 작업 감지용) */
  lastOutput: string;
  /** 마지막 체크 이후 수신 바이트 */
  bytesSinceLastCheck: number;
  /** 총 수신 바이트 */
  totalBytesReceived: number;
  /** 마지막 체크 시점의 총 바이트 (delta 계산용) */
  bytesAtLastCheck: number;
  /** 재시작 횟수 */
  restartCount: number;
  /** Continue 신호 발송 횟수 */
  continueSignalCount: number;
  /** 장기 작업 진행 중 여부 */
  isLongOperation: boolean;
  /** 연결된 ChildProcess (재시작용) */
  childProcess?: ChildProcess;
  /** Lane 실행 디렉토리 */
  laneRunDir?: string;
  /** 실패 이력 (POF용) */
  failureHistory: FailureRecord[];
}

/**
 * Stall 분석 결과
 */
export interface StallAnalysis {
  /** Stall 유형 */
  type: StallType;
  /** 권장 복구 액션 */
  action: RecoveryAction;
  /** 사용자 표시용 메시지 */
  message: string;
  /** 일시적 문제 여부 (복구 가능) */
  isTransient: boolean;
  /** 추가 정보 */
  details?: Record<string, any>;
}

/**
 * 실패 기록 (POF용)
 */
export interface FailureRecord {
  timestamp: number;
  phase: StallPhase;
  action: RecoveryAction;
  message: string;
  idleTimeMs: number;
  bytesReceived: number;
  lastOutput: string;
}

// ============================================================================
// 분석 컨텍스트 (Analysis Context)
// ============================================================================

/** 분석에 필요한 시간 및 상태 컨텍스트 */
interface AnalysisContext {
  state: LaneStallState;
  idleTime: number;
  progressTime: number;
  taskTime: number;
  timeSincePhaseChange: number;
  bytesDelta: number;
  effectiveIdleTimeout: number;
}

// ============================================================================
// Stall Detection Service
// ============================================================================

/**
 * 통합 Stall 감지 서비스
 * 
 * 사용법:
 * ```typescript
 * const stallService = StallDetectionService.getInstance();
 * stallService.registerLane('lane-1', { laneRunDir: '/path/to/lane' });
 * 
 * // 활동 기록
 * stallService.recordActivity('lane-1', bytesReceived, outputLine);
 * 
 * // 주기적 체크 (10초마다)
 * const result = stallService.checkAndRecover('lane-1');
 * if (result.action !== RecoveryAction.NONE) {
 *   // 복구 액션 처리
 * }
 * ```
 */
export class StallDetectionService {
  private static instance: StallDetectionService | null = null;
  
  private config: StallDetectionConfig;
  private laneStates: Map<string, LaneStallState> = new Map();
  
  private constructor(config: Partial<StallDetectionConfig> = {}) {
    this.config = { ...DEFAULT_STALL_CONFIG, ...config };
  }
  
  /**
   * 싱글톤 인스턴스 획득
   */
  static getInstance(config?: Partial<StallDetectionConfig>): StallDetectionService {
    if (!StallDetectionService.instance) {
      StallDetectionService.instance = new StallDetectionService(config);
    } else if (config) {
      StallDetectionService.instance.updateConfig(config);
    }
    return StallDetectionService.instance;
  }
  
  /**
   * 인스턴스 리셋 (테스트용)
   */
  static resetInstance(): void {
    StallDetectionService.instance = null;
  }
  
  /**
   * 설정 업데이트
   */
  updateConfig(config: Partial<StallDetectionConfig>): void {
    this.config = { ...this.config, ...config };
  }
  
  /**
   * 현재 설정 조회
   */
  getConfig(): StallDetectionConfig {
    return { ...this.config };
  }
  
  // --------------------------------------------------------------------------
  // Lane 등록/해제
  // --------------------------------------------------------------------------
  
  /**
   * Lane 등록
   */
  registerLane(
    laneName: string, 
    options: {
      laneRunDir?: string;
      childProcess?: ChildProcess;
      startIndex?: number;
      interventionEnabled?: boolean;
    } = {}
  ): void {
    const now = Date.now();
    
    this.laneStates.set(laneName, {
      laneName,
      phase: StallPhase.NORMAL,
      interventionEnabled: options.interventionEnabled ?? true, // default to true
      lastRealActivityTime: now,
      lastPhaseChangeTime: now,
      lastStateUpdateTime: now,
      taskStartTime: now,
      lastOutput: '',
      bytesSinceLastCheck: 0,
      totalBytesReceived: 0,
      bytesAtLastCheck: 0,
      restartCount: 0,
      continueSignalCount: 0,
      isLongOperation: false,
      childProcess: options.childProcess,
      laneRunDir: options.laneRunDir,
      failureHistory: [],
    });
    
    if (this.config.verbose) {
      logger.debug(`[StallService] Lane registered: ${laneName} (intervention: ${options.interventionEnabled ?? true})`);
    }
  }
  
  /**
   * Lane 해제
   */
  unregisterLane(laneName: string): void {
    this.laneStates.delete(laneName);
    
    if (this.config.verbose) {
      logger.debug(`[StallService] Lane unregistered: ${laneName}`);
    }
  }
  
  /**
   * Lane 상태 조회
   */
  getState(laneName: string): LaneStallState | undefined {
    return this.laneStates.get(laneName);
  }
  
  /**
   * ChildProcess 업데이트 (spawn 후 설정)
   */
  setChildProcess(laneName: string, child: ChildProcess): void {
    const state = this.laneStates.get(laneName);
    if (state) {
      state.childProcess = child;
    }
  }
  
  /**
   * LaneRunDir 업데이트
   */
  setLaneRunDir(laneName: string, dir: string): void {
    const state = this.laneStates.get(laneName);
    if (state) {
      state.laneRunDir = dir;
    }
  }
  
  /**
   * Lane 상태 업데이트 (waiting, running 등)
   * waiting 상태일 때는 stall 분석을 스킵함
   */
  setLaneStatus(laneName: string, status: string): void {
    const state = this.laneStates.get(laneName);
    if (state) {
      state.laneStatus = status;
      
      // waiting 상태로 전환 시 타이머 리셋 (의존성 대기 시간을 stall로 간주하지 않음)
      if (status === 'waiting') {
        const now = Date.now();
        state.lastRealActivityTime = now;
        state.lastStateUpdateTime = now;
        state.taskStartTime = now;
      }
      
      if (this.config.verbose) {
        logger.debug(`[StallService] [${laneName}] Lane status updated: ${status}`);
      }
    }
  }
  
  /**
   * Intervention 활성화 상태 설정
   * false로 설정하면 continue 신호를 보내지 않음
   */
  setInterventionEnabled(laneName: string, enabled: boolean): void {
    const state = this.laneStates.get(laneName);
    if (state) {
      state.interventionEnabled = enabled;
      
      if (this.config.verbose) {
        logger.debug(`[StallService] [${laneName}] Intervention ${enabled ? 'enabled' : 'disabled'}`);
      }
    }
  }
  
  // --------------------------------------------------------------------------
  // 활동 기록 (Activity Recording)
  // --------------------------------------------------------------------------
  
  /**
   * 활동 기록 - stdout/stderr에서 데이터 수신 시 호출
   * 
   * @param laneName Lane 이름
   * @param bytesReceived 수신한 바이트 수 (0 = heartbeat)
   * @param output 출력 라인 (장기 작업 감지용)
   * 
   * 핵심 규칙:
   * - bytesReceived > 0: 실제 활동 → lastRealActivityTime 업데이트, phase 리셋
   * - bytesReceived === 0: heartbeat → lastOutput만 업데이트, 타이머 리셋 안함
   */
  recordActivity(laneName: string, bytesReceived: number, output?: string): void {
    const state = this.laneStates.get(laneName);
    if (!state) return;
    
    const now = Date.now();
    
    // 출력 업데이트 (장기 작업 감지용)
    if (output) {
      state.lastOutput = output;
      state.isLongOperation = this.config.longOperationPatterns.some(p => p.test(output));
    }
    
    // bytesReceived > 0일 때만 실제 활동으로 인정
    if (bytesReceived > 0) {
      state.lastRealActivityTime = now;
      state.totalBytesReceived += bytesReceived;
      state.bytesSinceLastCheck += bytesReceived;
      
      // 실제 활동 감지 시 phase를 NORMAL로 리셋
      if (state.phase !== StallPhase.NORMAL && state.phase < StallPhase.RESTART_REQUESTED) {
        if (this.config.verbose) {
          logger.debug(`[StallService] [${laneName}] Real activity detected (${bytesReceived} bytes), resetting to NORMAL`);
        }
        state.phase = StallPhase.NORMAL;
        state.lastPhaseChangeTime = now;
      }
    }
    // bytesReceived === 0: heartbeat는 타이머 리셋하지 않음
  }
  
  /**
   * State.json 업데이트 기록
   */
  recordStateUpdate(laneName: string): void {
    const state = this.laneStates.get(laneName);
    if (state) {
      state.lastStateUpdateTime = Date.now();
    }
  }
  
  /**
   * 새 태스크 시작 기록
   */
  recordTaskStart(laneName: string): void {
    const state = this.laneStates.get(laneName);
    if (state) {
      const now = Date.now();
      state.taskStartTime = now;
      state.lastRealActivityTime = now;
      state.lastStateUpdateTime = now;
      // 새 태스크 시작 시 phase 리셋
      state.phase = StallPhase.NORMAL;
      state.lastPhaseChangeTime = now;
    }
  }
  
  // --------------------------------------------------------------------------
  // Stall 분석 (Analysis)
  // --------------------------------------------------------------------------
  
  /** StallAnalysis 생성 헬퍼 */
  private buildAnalysis(
    type: StallType, 
    action: RecoveryAction, 
    message: string, 
    isTransient: boolean, 
    details?: Record<string, any>
  ): StallAnalysis {
    return { type, action, message, isTransient, details };
  }
  
  /**
   * Stall 상태 분석 - 현재 상태에서 필요한 액션 결정
   * 
   * 분석 우선순위:
   * 0. waiting 상태면 스킵 (의존성 대기 중)
   * 1. Task timeout (30분) → RESTART/DOCTOR
   * 2. Zero bytes + idle → phase별 에스컬레이션
   * 3. No progress (10분) → 단계별 에스컬레이션
   * 4. Idle timeout (2분) → 단계별 에스컬레이션
   */
  analyzeStall(laneName: string): StallAnalysis {
    const state = this.laneStates.get(laneName);
    if (!state) {
      return this.buildAnalysis(StallType.IDLE, RecoveryAction.NONE, 'Lane not found', false);
    }
    
    // 0. waiting 상태는 stall 분석 스킵 (의존성 대기 중이므로 정상)
    if (state.laneStatus === 'waiting') {
      return this.buildAnalysis(
        StallType.IDLE, 
        RecoveryAction.NONE, 
        'Waiting for dependencies', 
        true,
        { laneStatus: 'waiting' }
      );
    }
    
    const ctx = this.buildAnalysisContext(state);
    
    // 1. Task timeout (최우선)
    const taskResult = this.checkTaskTimeout(ctx);
    if (taskResult) return taskResult;
    
    // 2. Zero bytes + idle (에이전트 무응답)
    const zeroByteResult = this.checkZeroBytes(ctx);
    if (zeroByteResult) return zeroByteResult;
    
    // 3. Progress timeout
    const progressResult = this.checkProgressTimeout(ctx);
    if (progressResult) return progressResult;
    
    // 4. Phase별 idle 체크
    const idleResult = this.checkPhaseBasedIdle(ctx);
    if (idleResult) return idleResult;
    
    // 액션 필요 없음
    return this.buildAnalysis(StallType.IDLE, RecoveryAction.NONE, 'Monitoring', true);
  }
  
  /** 분석 컨텍스트 생성 */
  private buildAnalysisContext(state: LaneStallState): AnalysisContext {
    const now = Date.now();
    return {
      state,
      idleTime: now - state.lastRealActivityTime,
      progressTime: now - state.lastStateUpdateTime,
      taskTime: now - state.taskStartTime,
      timeSincePhaseChange: now - state.lastPhaseChangeTime,
      bytesDelta: state.totalBytesReceived - state.bytesAtLastCheck,
      effectiveIdleTimeout: state.isLongOperation 
        ? this.config.longOperationGraceMs 
        : this.config.idleTimeoutMs,
    };
  }
  
  /** Task timeout 체크 */
  private checkTaskTimeout(ctx: AnalysisContext): StallAnalysis | null {
    if (ctx.taskTime <= this.config.taskTimeoutMs) return null;
    
    const canRestart = ctx.state.restartCount < this.config.maxRestarts;
    return this.buildAnalysis(
      StallType.TASK_TIMEOUT,
      canRestart ? RecoveryAction.REQUEST_RESTART : RecoveryAction.RUN_DOCTOR,
      `Task exceeded maximum timeout of ${Math.round(this.config.taskTimeoutMs / 60000)} minutes`,
      canRestart,
      { taskTimeMs: ctx.taskTime, restartCount: ctx.state.restartCount }
    );
  }
  
  /** Zero bytes 체크 (grace period 존중) */
  private checkZeroBytes(ctx: AnalysisContext): StallAnalysis | null {
    const { state, idleTime, timeSincePhaseChange, bytesDelta, effectiveIdleTimeout } = ctx;
    
    if (bytesDelta !== 0 || idleTime <= effectiveIdleTimeout) return null;
    
    const baseDetails = { idleTimeMs: idleTime, bytesDelta, phase: state.phase, timeSincePhaseChange };
    
    switch (state.phase) {
      case StallPhase.NORMAL:
        return this.buildAnalysis(
          StallType.ZERO_BYTES,
          RecoveryAction.SEND_CONTINUE,
          `Agent produced 0 bytes for ${Math.round(idleTime / 1000)}s - possible API issue`,
          true, baseDetails
        );
        
      case StallPhase.CONTINUE_SENT:
        if (timeSincePhaseChange > this.config.continueGraceMs) {
          return this.buildAnalysis(
            StallType.ZERO_BYTES,
            RecoveryAction.SEND_STRONGER_PROMPT,
            `Still 0 bytes after continue signal (${Math.round(timeSincePhaseChange / 1000)}s). Escalating...`,
            true, baseDetails
          );
        }
        return null; // Grace period 내 → 대기
        
      case StallPhase.STRONGER_PROMPT_SENT:
        if (timeSincePhaseChange > this.config.strongerPromptGraceMs) {
          return this.buildAnalysis(
            StallType.ZERO_BYTES,
            RecoveryAction.REQUEST_RESTART,
            `Still 0 bytes after stronger prompt (${Math.round(timeSincePhaseChange / 1000)}s). Restarting...`,
            true, baseDetails
          );
        }
        return null; // Grace period 내 → 대기
        
      default:
        // RESTART_REQUESTED, DIAGNOSED, ABORTED
        return this.buildAnalysis(
          StallType.ZERO_BYTES,
          RecoveryAction.REQUEST_RESTART,
          `Agent produced 0 bytes for ${Math.round(idleTime / 1000)}s - possible API issue`,
          true, baseDetails
        );
    }
  }
  
  /** Progress timeout 체크 */
  private checkProgressTimeout(ctx: AnalysisContext): StallAnalysis | null {
    if (ctx.progressTime <= this.config.progressTimeoutMs) return null;
    return this.getEscalatedAction(ctx.state, StallType.NO_PROGRESS, ctx.progressTime);
  }
  
  /** Phase별 idle 상태 체크 */
  private checkPhaseBasedIdle(ctx: AnalysisContext): StallAnalysis | null {
    const { state, idleTime, timeSincePhaseChange, effectiveIdleTimeout } = ctx;
    
    switch (state.phase) {
      case StallPhase.NORMAL:
        if (idleTime > effectiveIdleTimeout) {
          return this.buildAnalysis(
            StallType.IDLE,
            RecoveryAction.SEND_CONTINUE,
            `Lane idle for ${Math.round(idleTime / 1000)}s. Sending continue signal...`,
            true,
            { idleTimeMs: idleTime, isLongOperation: state.isLongOperation }
          );
        }
        break;
        
      case StallPhase.CONTINUE_SENT:
        if (timeSincePhaseChange > this.config.continueGraceMs) {
          return this.buildAnalysis(
            StallType.IDLE,
            RecoveryAction.SEND_STRONGER_PROMPT,
            `Still idle after continue signal. Sending stronger prompt...`,
            true,
            { timeSincePhaseChange, continueSignalCount: state.continueSignalCount }
          );
        }
        break;
        
      case StallPhase.STRONGER_PROMPT_SENT:
        if (timeSincePhaseChange > this.config.strongerPromptGraceMs) {
          return this.buildRestartOrDoctorAnalysis(state, 
            'No response after stronger prompt. Killing and restarting process...',
            `Lane failed after ${state.restartCount} restarts. Running diagnostics...`
          );
        }
        break;
        
      case StallPhase.RESTART_REQUESTED:
        const postRestartTimeout = effectiveIdleTimeout * 0.75;
        if (idleTime > postRestartTimeout) {
          return this.buildRestartOrDoctorAnalysis(state,
            'Lane idle after restart. Retrying continue signal...',
            'Lane repeatedly stalled. Running diagnostics...',
            RecoveryAction.SEND_CONTINUE  // restart 후에는 continue부터 시작
          );
        }
        break;
        
      case StallPhase.DIAGNOSED:
      case StallPhase.ABORTED:
        return this.buildAnalysis(StallType.IDLE, RecoveryAction.ABORT_LANE, 'Lane recovery exhausted', false);
    }
    
    return null;
  }
  
  /** 재시작 또는 Doctor 실행 결정 헬퍼 */
  private buildRestartOrDoctorAnalysis(
    state: LaneStallState, 
    restartMsg: string, 
    doctorMsg: string,
    restartAction: RecoveryAction = RecoveryAction.REQUEST_RESTART
  ): StallAnalysis {
    const canRestart = state.restartCount < this.config.maxRestarts;
    return this.buildAnalysis(
      StallType.IDLE,
      canRestart ? restartAction : RecoveryAction.RUN_DOCTOR,
      canRestart ? restartMsg : doctorMsg,
      canRestart,
      { restartCount: state.restartCount, maxRestarts: this.config.maxRestarts }
    );
  }
  
  /** Progress timeout에 대한 에스컬레이션 액션 결정 */
  private getEscalatedAction(state: LaneStallState, type: StallType, progressTime: number): StallAnalysis {
    const details = { progressTimeMs: progressTime };
    
    switch (state.phase) {
      case StallPhase.NORMAL:
        return this.buildAnalysis(type, RecoveryAction.SEND_CONTINUE,
          `No progress for ${Math.round(progressTime / 60000)} minutes. Sending continue signal...`,
          true, details);
        
      case StallPhase.CONTINUE_SENT:
        return this.buildAnalysis(type, RecoveryAction.SEND_STRONGER_PROMPT,
          'Still no progress. Sending stronger prompt...', true, details);
        
      default:
        const canRestart = state.restartCount < this.config.maxRestarts;
        return this.buildAnalysis(type,
          canRestart ? RecoveryAction.REQUEST_RESTART : RecoveryAction.RUN_DOCTOR,
          canRestart ? 'No progress after interventions. Restarting...' : 'Persistent no-progress state. Running diagnostics...',
          canRestart,
          { ...details, restartCount: state.restartCount }
        );
    }
  }
  
  // --------------------------------------------------------------------------
  // 복구 액션 실행 (Recovery Actions)
  // --------------------------------------------------------------------------
  
  /**
   * Stall 체크 및 복구 액션 실행
   * 
   * @returns 실행된 분석 결과 (orchestrator에서 추가 처리 필요시 사용)
   * 
   * 새로운 방식에서는 복구 액션이 프로세스 중단을 포함하므로 async
   */
  async checkAndRecover(laneName: string): Promise<StallAnalysis> {
    const state = this.laneStates.get(laneName);
    if (!state) {
      return {
        type: StallType.IDLE,
        action: RecoveryAction.NONE,
        message: 'Lane not found',
        isTransient: false,
      };
    }
    
    // 바이트 델타 업데이트 (다음 체크를 위해)
    state.bytesAtLastCheck = state.totalBytesReceived;
    state.bytesSinceLastCheck = 0;
    
    const analysis = this.analyzeStall(laneName);
    
    if (analysis.action === RecoveryAction.NONE) {
      return analysis;
    }
    
    // 로그 출력
    this.logAnalysis(laneName, analysis);
    
    // 실패 이력 기록
    this.recordFailure(state, analysis);
    
    // 액션 실행 (프로세스 중단 포함 - await 필요)
    switch (analysis.action) {
      case RecoveryAction.SEND_CONTINUE:
        await this.sendContinueSignal(state);
        break;
        
      case RecoveryAction.SEND_STRONGER_PROMPT:
        await this.sendStrongerPrompt(state);
        break;
        
      case RecoveryAction.REQUEST_RESTART:
        await this.requestRestart(state);
        break;
        
      case RecoveryAction.RUN_DOCTOR:
        this.markForDiagnosis(state);
        break;
        
      case RecoveryAction.ABORT_LANE:
        this.markAsAborted(state);
        break;
    }
    
    return analysis;
  }
  
  /**
   * Continue 신호 발송 - 프로세스 중단 및 개입 메시지와 함께 resume
   * 
   * 새로운 방식:
   * 1. pending-intervention.json 생성
   * 2. 현재 프로세스 SIGTERM으로 종료
   * 3. Orchestrator가 감지하여 개입 메시지와 함께 resume
   */
  private async sendContinueSignal(state: LaneStallState): Promise<void> {
    // Intervention이 비활성화된 경우 신호를 보내지 않고 phase만 업데이트
    if (state.interventionEnabled === false) {
      logger.warn(`[${state.laneName}] Continue signal skipped (intervention disabled). Stall will escalate on next check.`);
      state.phase = StallPhase.CONTINUE_SENT;
      state.lastPhaseChangeTime = Date.now();
      return;
    }
    
    if (!state.laneRunDir) {
      logger.error(`[StallService] [${state.laneName}] Cannot send continue signal: laneRunDir not set`);
      return;
    }
    
    try {
      // 1. 개입 요청 생성
      createInterventionRequest(state.laneRunDir, {
        type: InterventionType.CONTINUE_SIGNAL,
        message: createContinueMessage(),
        source: 'stall-detector',
        priority: 5,
      });
      
      // 2. 상태 먼저 업데이트 (race condition 방지)
      state.phase = StallPhase.CONTINUE_SENT;
      state.lastPhaseChangeTime = Date.now();
      state.continueSignalCount++;

      // 3. 프로세스 종료 (있는 경우)
      if (state.childProcess?.pid && !state.childProcess.killed) {
        logger.info(`[${state.laneName}] Interrupting process ${state.childProcess.pid} for continue signal`);
        await killAndWait(state.childProcess.pid);
      }
      
      logger.info(`[${state.laneName}] Continue signal queued (#${state.continueSignalCount}) - agent will resume with intervention`);
      
      events.emit('recovery.continue_signal', {
        laneName: state.laneName,
        idleSeconds: Math.round((Date.now() - state.lastRealActivityTime) / 1000),
        signalCount: state.continueSignalCount,
      });
    } catch (error: any) {
      logger.error(`[StallService] [${state.laneName}] Failed to send continue signal: ${error.message}`);
    }
  }
  
  /**
   * Stronger prompt 발송 - 프로세스 중단 및 강력한 개입 메시지와 함께 resume
   */
  private async sendStrongerPrompt(state: LaneStallState): Promise<void> {
    // Intervention이 비활성화된 경우 신호를 보내지 않고 phase만 업데이트
    if (state.interventionEnabled === false) {
      logger.warn(`[${state.laneName}] Stronger prompt skipped (intervention disabled). Will escalate to restart.`);
      state.phase = StallPhase.STRONGER_PROMPT_SENT;
      state.lastPhaseChangeTime = Date.now();
      return;
    }
    
    if (!state.laneRunDir) {
      logger.error(`[StallService] [${state.laneName}] Cannot send stronger prompt: laneRunDir not set`);
      return;
    }
    
    try {
      // 1. 개입 요청 생성
      createInterventionRequest(state.laneRunDir, {
        type: InterventionType.STRONGER_PROMPT,
        message: createStrongerPromptMessage(),
        source: 'stall-detector',
        priority: 7,
      });
      
      // 2. 상태 먼저 업데이트 (race condition 방지)
      state.phase = StallPhase.STRONGER_PROMPT_SENT;
      state.lastPhaseChangeTime = Date.now();

      // 3. 프로세스 종료 (있는 경우)
      if (state.childProcess?.pid && !state.childProcess.killed) {
        logger.warn(`[${state.laneName}] Interrupting process ${state.childProcess.pid} for stronger prompt`);
        await killAndWait(state.childProcess.pid);
      }
      
      logger.warn(`[${state.laneName}] Stronger prompt queued - agent will resume with intervention`);
      
      events.emit('recovery.stronger_prompt', {
        laneName: state.laneName,
      });
    } catch (error: any) {
      logger.error(`[StallService] [${state.laneName}] Failed to send stronger prompt: ${error.message}`);
    }
  }
  
  /**
   * 재시작 요청 - 프로세스 종료 및 재시작 메시지와 함께 resume
   */
  private async requestRestart(state: LaneStallState): Promise<void> {
    state.restartCount++;
    state.phase = StallPhase.RESTART_REQUESTED;
    state.lastPhaseChangeTime = Date.now();
    
    // 1. 개입 요청 생성 (재시작 메시지)
    if (state.laneRunDir) {
      createInterventionRequest(state.laneRunDir, {
        type: InterventionType.SYSTEM_RESTART,
        message: createRestartMessage('Agent became unresponsive after multiple intervention attempts'),
        source: 'stall-detector',
        priority: 9,
        metadata: {
          restartCount: state.restartCount,
          maxRestarts: this.config.maxRestarts,
        },
      });
    }
    
    // 2. 프로세스 종료 (SIGKILL 사용 - 강제 종료)
    if (state.childProcess?.pid && !state.childProcess.killed) {
      try {
        // SIGKILL로 즉시 종료 (SIGTERM이 안 먹힐 수 있으므로)
        state.childProcess.kill('SIGKILL');
        logger.info(`[StallService] [${state.laneName}] Killed process ${state.childProcess.pid}`);
      } catch (error: any) {
        logger.warn(`[StallService] [${state.laneName}] Failed to kill process: ${error.message}`);
      }
    }
    
    logger.warn(`[${state.laneName}] Restart requested (restart #${state.restartCount}/${this.config.maxRestarts})`);
    
    events.emit('recovery.restart', {
      laneName: state.laneName,
      restartCount: state.restartCount,
      maxRestarts: this.config.maxRestarts,
    });
  }
  
  /**
   * 진단 필요 상태로 마킹
   */
  private markForDiagnosis(state: LaneStallState): void {
    state.phase = StallPhase.DIAGNOSED;
    state.lastPhaseChangeTime = Date.now();
    
    logger.error(`[${state.laneName}] Running diagnostics due to persistent failures...`);
    
    events.emit('recovery.diagnosed', {
      laneName: state.laneName,
      restartCount: state.restartCount,
    });
  }
  
  /**
   * 중단 상태로 마킹
   */
  private markAsAborted(state: LaneStallState): void {
    state.phase = StallPhase.ABORTED;
    state.lastPhaseChangeTime = Date.now();
    
    logger.error(`[${state.laneName}] Lane aborted after recovery exhausted`);
    
    events.emit('recovery.aborted', {
      laneName: state.laneName,
    });
  }
  
  /**
   * 실패 이력 기록
   */
  private recordFailure(state: LaneStallState, analysis: StallAnalysis): void {
    state.failureHistory.push({
      timestamp: Date.now(),
      phase: state.phase,
      action: analysis.action,
      message: analysis.message,
      idleTimeMs: Date.now() - state.lastRealActivityTime,
      bytesReceived: state.totalBytesReceived,
      lastOutput: state.lastOutput.substring(0, 200),
    });
  }
  
  /**
   * 분석 결과 로깅
   */
  private logAnalysis(laneName: string, analysis: StallAnalysis): void {
    const actionLabel = analysis.action === RecoveryAction.NONE ? '' : ` -> Action: ${analysis.action}`;
    const message = `[${laneName}] ${analysis.type}: ${analysis.message}${actionLabel}`;
    
    if (analysis.isTransient) {
      logger.warn(message);
    } else {
      logger.error(message);
    }
    
    if (this.config.verbose && analysis.details) {
      logger.debug(`[StallService] Details: ${JSON.stringify(analysis.details)}`);
    }
  }
  
  // --------------------------------------------------------------------------
  // 유틸리티
  // --------------------------------------------------------------------------
  
  /**
   * Lane의 실패 이력 조회
   */
  getFailureHistory(laneName: string): FailureRecord[] {
    return this.laneStates.get(laneName)?.failureHistory || [];
  }
  
  /**
   * 재시작 횟수 조회
   */
  getRestartCount(laneName: string): number {
    return this.laneStates.get(laneName)?.restartCount || 0;
  }
  
  /**
   * 현재 phase 조회
   */
  getPhase(laneName: string): StallPhase {
    return this.laneStates.get(laneName)?.phase ?? StallPhase.NORMAL;
  }
  
  /**
   * 재시작 후 phase 리셋 (orchestrator에서 새 프로세스 시작 시 호출)
   */
  resetAfterRestart(laneName: string): void {
    const state = this.laneStates.get(laneName);
    if (state) {
      const now = Date.now();
      // RESTART_REQUESTED 유지 (재시작 후 모니터링 위해)
      state.lastRealActivityTime = now;
      state.lastPhaseChangeTime = now;
      state.bytesSinceLastCheck = 0;
      state.bytesAtLastCheck = state.totalBytesReceived;
    }
  }
  
  /**
   * Lane의 startIndex 업데이트 필요 여부 확인 (재시작 후)
   */
  needsStartIndexUpdate(laneName: string): boolean {
    const state = this.laneStates.get(laneName);
    return state?.phase === StallPhase.RESTART_REQUESTED;
  }
  
  /**
   * Phase가 DIAGNOSED 이상인지 확인 (더 이상 복구 불가)
   */
  isUnrecoverable(laneName: string): boolean {
    const phase = this.getPhase(laneName);
    return phase >= StallPhase.DIAGNOSED;
  }
  
  /**
   * 디버그용 상태 덤프
   */
  dumpState(laneName: string): string {
    const state = this.laneStates.get(laneName);
    if (!state) return `Lane ${laneName} not found`;
    
    const now = Date.now();
    return JSON.stringify({
      laneName: state.laneName,
      phase: StallPhase[state.phase],
      idleTimeMs: now - state.lastRealActivityTime,
      progressTimeMs: now - state.lastStateUpdateTime,
      taskTimeMs: now - state.taskStartTime,
      totalBytesReceived: state.totalBytesReceived,
      restartCount: state.restartCount,
      continueSignalCount: state.continueSignalCount,
      isLongOperation: state.isLongOperation,
      lastOutput: state.lastOutput.substring(0, 100),
    }, null, 2);
  }
}

// ============================================================================
// 편의 함수 (Convenience Functions)
// ============================================================================

/**
 * 싱글톤 인스턴스 획득 (간편 접근)
 */
export function getStallService(config?: Partial<StallDetectionConfig>): StallDetectionService {
  return StallDetectionService.getInstance(config);
}

/**
 * 인스턴스 리셋 (테스트용)
 */
export function resetStallService(): void {
  StallDetectionService.resetInstance();
}


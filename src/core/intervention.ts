/**
 * Intervention Executor - 즉각적인 에이전트 개입을 위한 통합 모듈
 * 
 * 핵심 기능:
 * - 실행 중인 cursor-agent 프로세스 종료
 * - 개입 메시지와 함께 세션 resume
 * - signal, stall-detection에서 일관된 방식으로 사용
 * 
 * 동작 원리:
 * 1. 개입 요청 시 pending-intervention.json 파일 생성
 * 2. 현재 프로세스 SIGTERM으로 종료
 * 3. Orchestrator/Runner가 프로세스 종료 감지
 * 4. pending-intervention.json 읽어서 개입 메시지 포함하여 resume
 */

import * as fs from 'fs';
import * as path from 'path';
import { ChildProcess } from 'child_process';
import * as logger from '../utils/logger';
import { safeJoin } from '../utils/path';
import { loadState } from '../utils/state';
import { LaneState } from '../types';

// ============================================================================
// Types
// ============================================================================

/**
 * 개입 요청 타입
 */
export enum InterventionType {
  /** 사용자가 직접 보낸 메시지 */
  USER_MESSAGE = 'user_message',
  /** Stall 감지로 인한 continue 신호 */
  CONTINUE_SIGNAL = 'continue_signal',
  /** Stall 감지로 인한 stronger prompt */
  STRONGER_PROMPT = 'stronger_prompt',
  /** 시스템 재시작 요청 */
  SYSTEM_RESTART = 'system_restart',
  /** Git 에러 가이던스 */
  GIT_GUIDANCE = 'git_guidance',
}

/**
 * 개입 요청 데이터
 */
export interface InterventionRequest {
  /** 개입 유형 */
  type: InterventionType;
  /** 개입 메시지 (에이전트에게 전달될 프롬프트) */
  message: string;
  /** 요청 시간 */
  timestamp: number;
  /** 요청자 (user, system, stall-detector) */
  source: 'user' | 'system' | 'stall-detector';
  /** 우선순위 (높을수록 먼저 처리) */
  priority?: number;
  /** 현재 태스크 인덱스 (resume 시 사용) */
  taskIndex?: number;
  /** 추가 메타데이터 */
  metadata?: Record<string, any>;
}

/**
 * 개입 실행 결과
 */
export interface InterventionResult {
  /** 성공 여부 */
  success: boolean;
  /** 종료된 프로세스 PID */
  killedPid?: number;
  /** 오류 메시지 */
  error?: string;
  /** pending-intervention.json 경로 */
  pendingFile?: string;
}

// ============================================================================
// Constants
// ============================================================================

/** 개입 요청 파일명 */
export const PENDING_INTERVENTION_FILE = 'pending-intervention.json';

/** 프로세스 종료 대기 시간 (ms) */
const KILL_TIMEOUT_MS = 5000;

// ============================================================================
// Intervention Messages
// ============================================================================

/**
 * Continue 신호 메시지 생성
 */
export function createContinueMessage(): string {
  return `[SYSTEM] Please continue with your current task. If you're waiting for something, explain what you need and proceed with what you can do now.`;
}

/**
 * Stronger prompt 메시지 생성
 */
export function createStrongerPromptMessage(): string {
  return `[SYSTEM INTERVENTION] You appear to be stuck or unresponsive. Please:
1. If you've completed the current task, summarize your work and proceed to the next task.
2. If you encountered an error, describe it and attempt to resolve it.
3. If you're waiting for something, explain what and continue with available work.
4. If you encountered a git error, resolve it (pull/rebase/merge) and continue.

Respond immediately with your current status and next action.`;
}

/**
 * 시스템 재시작 메시지 생성
 */
export function createRestartMessage(reason: string): string {
  return `[SYSTEM] Your previous session was interrupted due to: ${reason}. Please continue from where you left off. Review your progress and proceed with the current task.`;
}

/**
 * 사용자 개입 메시지 래핑
 */
export function wrapUserIntervention(message: string): string {
  return `[USER INTERVENTION] ${message}`;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * 개입 요청 파일 경로 가져오기
 */
export function getPendingInterventionPath(laneRunDir: string): string {
  return safeJoin(laneRunDir, PENDING_INTERVENTION_FILE);
}

/**
 * 개입 요청 생성 및 저장
 * 
 * @param laneRunDir Lane 실행 디렉토리
 * @param request 개입 요청 데이터
 * @returns 저장된 파일 경로
 */
export function createInterventionRequest(
  laneRunDir: string,
  request: Omit<InterventionRequest, 'timestamp'>
): string {
  const fullRequest: InterventionRequest = {
    ...request,
    timestamp: Date.now(),
    priority: request.priority ?? 0,
  };

  const filePath = getPendingInterventionPath(laneRunDir);
  
  // 기존 요청이 있으면 우선순위 비교
  const existing = readPendingIntervention(laneRunDir);
  if (existing && (existing.priority ?? 0) > (fullRequest.priority ?? 0)) {
    logger.debug(`[Intervention] Existing request has higher priority, skipping`);
    return filePath;
  }

  fs.writeFileSync(filePath, JSON.stringify(fullRequest, null, 2), 'utf8');
  logger.debug(`[Intervention] Created request: ${filePath}`);

  return filePath;
}

/**
 * 대기 중인 개입 요청 읽기
 */
export function readPendingIntervention(laneRunDir: string): InterventionRequest | null {
  const filePath = getPendingInterventionPath(laneRunDir);
  
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content) as InterventionRequest;
  } catch (error) {
    logger.warn(`[Intervention] Failed to read pending intervention: ${error}`);
    return null;
  }
}

/**
 * 대기 중인 개입 요청 삭제 (처리 완료 후)
 */
export function clearPendingIntervention(laneRunDir: string): void {
  const filePath = getPendingInterventionPath(laneRunDir);

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    // Ignore cleanup errors
  }
}

/**
 * 대기 중인 개입 요청이 있는지 확인
 */
export function hasPendingIntervention(laneRunDir: string): boolean {
  return fs.existsSync(getPendingInterventionPath(laneRunDir));
}

// ============================================================================
// Process Control
// ============================================================================

/**
 * PID로 프로세스 종료
 * 
 * @param pid 종료할 프로세스 PID
 * @param signal 종료 시그널 (기본: SIGTERM)
 * @returns 성공 여부
 */
export function killProcess(pid: number, signal: NodeJS.Signals = 'SIGTERM'): boolean {
  try {
    process.kill(pid, signal);
    logger.info(`[Intervention] Sent ${signal} to process ${pid}`);
    return true;
  } catch (error: any) {
    if (error.code === 'ESRCH') {
      logger.debug(`[Intervention] Process ${pid} already terminated`);
      return true; // Process doesn't exist, consider it killed
    }
    logger.error(`[Intervention] Failed to kill process ${pid}: ${error.message}`);
    return false;
  }
}

/**
 * 프로세스가 살아있는지 확인
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 = check existence
    return true;
  } catch {
    return false;
  }
}

/**
 * 프로세스 종료 후 대기
 * 
 * @param pid 종료할 프로세스 PID
 * @param timeoutMs 최대 대기 시간
 * @returns 종료 성공 여부
 */
export async function killAndWait(pid: number, timeoutMs: number = KILL_TIMEOUT_MS): Promise<boolean> {
  // 먼저 SIGTERM 시도
  if (!killProcess(pid, 'SIGTERM')) {
    return false;
  }

  // 종료 대기
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (!isProcessAlive(pid)) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // SIGTERM이 안 먹히면 SIGKILL
  logger.warn(`[Intervention] Process ${pid} didn't respond to SIGTERM, sending SIGKILL`);
  killProcess(pid, 'SIGKILL');

  // SIGKILL 후 잠시 대기
  await new Promise(resolve => setTimeout(resolve, 500));
  return !isProcessAlive(pid);
}

/**
 * ChildProcess 종료
 */
export async function killChildProcess(child: ChildProcess): Promise<boolean> {
  if (!child.pid) {
    return false;
  }

  if (child.killed) {
    return true;
  }

  return killAndWait(child.pid);
}

// ============================================================================
// High-Level API
// ============================================================================

/**
 * 즉각 개입 실행 - 프로세스 종료 및 개입 요청 생성
 * 
 * 이 함수는 다음을 수행합니다:
 * 1. 개입 요청 파일 생성 (pending-intervention.json)
 * 2. 현재 프로세스 종료 (SIGTERM → SIGKILL)
 * 3. 결과 반환 (Orchestrator가 resume 처리)
 * 
 * @param laneRunDir Lane 실행 디렉토리
 * @param request 개입 요청 데이터
 * @param pid 종료할 프로세스 PID (없으면 state.json에서 읽음)
 */
export async function executeIntervention(
  laneRunDir: string,
  request: Omit<InterventionRequest, 'timestamp'>,
  pid?: number
): Promise<InterventionResult> {
  // 1. 대상 PID 확인
  let targetPid = pid;
  if (!targetPid) {
    const statePath = safeJoin(laneRunDir, 'state.json');
    if (fs.existsSync(statePath)) {
      const state = loadState<LaneState>(statePath);
      targetPid = state?.pid;
    }
  }

  if (!targetPid) {
    return {
      success: false,
      error: 'No process PID found to interrupt',
    };
  }

  // 2. 프로세스가 살아있는지 확인
  if (!isProcessAlive(targetPid)) {
    logger.info(`[Intervention] Process ${targetPid} is not running, just creating request`);
    const pendingFile = createInterventionRequest(laneRunDir, request);
    return {
      success: true,
      pendingFile,
    };
  }

  // 3. 개입 요청 파일 생성 (프로세스 종료 전에)
  const pendingFile = createInterventionRequest(laneRunDir, request);

  // 4. 프로세스 종료
  const killed = await killAndWait(targetPid);

  if (!killed) {
    return {
      success: false,
      error: `Failed to kill process ${targetPid}`,
      pendingFile,
    };
  }

  logger.info(`[Intervention] Successfully interrupted process ${targetPid}`);

  return {
    success: true,
    killedPid: targetPid,
    pendingFile,
  };
}

/**
 * 사용자 개입 실행 (cursorflow signal 명령용)
 */
export async function executeUserIntervention(
  laneRunDir: string,
  message: string,
  pid?: number
): Promise<InterventionResult> {
  return executeIntervention(laneRunDir, {
    type: InterventionType.USER_MESSAGE,
    message: wrapUserIntervention(message),
    source: 'user',
    priority: 10, // 사용자 개입은 높은 우선순위
  }, pid);
}

/**
 * Continue 신호 실행 (stall-detection용)
 */
export async function executeContinueSignal(
  laneRunDir: string,
  pid?: number
): Promise<InterventionResult> {
  return executeIntervention(laneRunDir, {
    type: InterventionType.CONTINUE_SIGNAL,
    message: createContinueMessage(),
    source: 'stall-detector',
    priority: 5,
  }, pid);
}

/**
 * Stronger prompt 실행 (stall-detection용)
 */
export async function executeStrongerPrompt(
  laneRunDir: string,
  pid?: number
): Promise<InterventionResult> {
  return executeIntervention(laneRunDir, {
    type: InterventionType.STRONGER_PROMPT,
    message: createStrongerPromptMessage(),
    source: 'stall-detector',
    priority: 7,
  }, pid);
}

/**
 * Git 가이던스 실행
 */
export async function executeGitGuidance(
  laneRunDir: string,
  guidance: string,
  pid?: number
): Promise<InterventionResult> {
  return executeIntervention(laneRunDir, {
    type: InterventionType.GIT_GUIDANCE,
    message: guidance,
    source: 'system',
    priority: 8,
  }, pid);
}

// ============================================================================
// Resume Integration
// ============================================================================

/**
 * 개입 메시지를 포함한 resume 프롬프트 생성
 * 
 * Runner가 resume 시 호출하여 개입 메시지를 프롬프트에 포함
 */
export function buildResumePromptWithIntervention(
  laneRunDir: string,
  originalPrompt: string
): { prompt: string; hadIntervention: boolean } {
  const intervention = readPendingIntervention(laneRunDir);

  if (!intervention) {
    return { prompt: originalPrompt, hadIntervention: false };
  }

  // 개입 메시지를 프롬프트 앞에 추가
  const combinedPrompt = `${intervention.message}\n\n---\n\nOriginal Task:\n${originalPrompt}`;

  // 개입 요청 파일 삭제 (처리 완료)
  clearPendingIntervention(laneRunDir);

  logger.info(`[Intervention] Applied pending intervention (type: ${intervention.type})`);

  return { prompt: combinedPrompt, hadIntervention: true };
}

/**
 * 개입으로 인한 재시작인지 확인
 */
export function isInterventionRestart(laneRunDir: string): boolean {
  return hasPendingIntervention(laneRunDir);
}


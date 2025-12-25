/**
 * Auto-Recovery Module
 * 
 * Automatic recovery strategies for common orchestration failures:
 * - Agent idle/no response detection with escalating interventions
 * - Guidance messages for git conflicts and push failures
 * - Process health monitoring with restart capabilities
 * - Doctor integration for persistent failures
 * - POF (Post-mortem of Failure) saving for failed recoveries
 */

import * as fs from 'fs';
import { ChildProcess } from 'child_process';

import * as logger from '../utils/logger';
import { LaneState } from '../utils/types';
import { events } from '../utils/events';
import { safeJoin } from '../utils/path';
import { runHealthCheck, checkAgentHealth, checkAuthHealth } from '../utils/health';

// ============================================================================
// Types & Constants
// ============================================================================

/** Recovery stages for escalating interventions */
export enum RecoveryStage {
  /** Normal operation - monitoring */
  NORMAL = 0,
  /** First intervention - send continue signal */
  CONTINUE_SIGNAL = 1,
  /** Second intervention - send stronger prompt */
  STRONGER_PROMPT = 2,
  /** Third intervention - kill and restart process */
  RESTART_PROCESS = 3,
  /** Final stage - run doctor and report */
  DIAGNOSE = 4,
  /** No more recovery possible */
  ABORT = 5,
}

/** Configuration for auto-recovery behavior */
export interface AutoRecoveryConfig {
  /** Time without activity before sending continue signal (default: 2 minutes) */
  idleTimeoutMs: number;
  /** Time to wait after continue signal before escalating (default: 2 minutes) */
  continueGraceMs: number;
  /** Time to wait after stronger prompt before escalating (default: 2 minutes) */
  strongerPromptGraceMs: number;
  /** Maximum number of restarts before aborting (default: 2) */
  maxRestarts: number;
  /** Whether to run doctor on persistent failures (default: true) */
  runDoctorOnFailure: boolean;
  /** Patterns indicating long-running operations (won't trigger idle) */
  longOperationPatterns: RegExp[];
  /** Grace period for long operations (default: 10 minutes) */
  longOperationGraceMs: number;
  /** Enable verbose logging */
  verbose: boolean;
}

/** Default auto-recovery configuration */
export const DEFAULT_AUTO_RECOVERY_CONFIG: AutoRecoveryConfig = {
  idleTimeoutMs: 2 * 60 * 1000,          // 2 minutes - idle detection
  continueGraceMs: 2 * 60 * 1000,        // 2 minutes after continue
  strongerPromptGraceMs: 2 * 60 * 1000,  // 2 minutes after stronger prompt
  maxRestarts: 2,
  runDoctorOnFailure: true,
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
  longOperationGraceMs: 10 * 60 * 1000,  // 10 minutes for long ops
  verbose: false,
};

/** State tracking for a single lane's recovery */
export interface LaneRecoveryState {
  laneName: string;
  stage: RecoveryStage;
  lastActivityTime: number;
  lastBytesReceived: number;
  totalBytesReceived: number;
  lastOutput: string;
  restartCount: number;
  continueSignalsSent: number;
  lastStageChangeTime: number;
  diagnosticInfo?: DiagnosticInfo;
  isLongOperation: boolean;
  failureHistory: FailureRecord[];
}

/** Diagnostic information from doctor */
export interface DiagnosticInfo {
  timestamp: number;
  agentHealthy: boolean;
  authHealthy: boolean;
  systemHealthy: boolean;
  suggestedAction: string;
  details: string;
}

/** Recovery action result */
export interface RecoveryActionResult {
  success: boolean;
  action: string;
  message: string;
  shouldContinue: boolean;
  nextStage?: RecoveryStage;
  diagnostic?: DiagnosticInfo;
}

/** Record of a failure for POF */
export interface FailureRecord {
  timestamp: number;
  stage: RecoveryStage;
  action: string;
  message: string;
  idleTimeMs: number;
  bytesReceived: number;
  lastOutput: string;
}

/** POF (Post-mortem of Failure) entry */
export interface POFEntry {
  title: string;
  runId: string;
  failureTime: string;
  detectedAt: string;
  summary: string;
  rootCause: {
    type: string;
    description: string;
    symptoms: string[];
  };
  affectedLanes: Array<{
    name: string;
    status: string;
    task: string;
    taskIndex: number;
    pid?: number;
    reason: string;
    recoveryAttempts: FailureRecord[];
  }>;
  possibleCauses: string[];
  recovery: {
    command: string;
    description: string;
    alternativeCommand?: string;
    alternativeDescription?: string;
  };
  previousFailures?: POFEntry[];
}

// ============================================================================
// Guidance Messages for Git Issues
// ============================================================================

/** Generate guidance message for git push failure */
export function getGitPushFailureGuidance(): string {
  return `[SYSTEM INTERVENTION] Git push가 실패했습니다. 다음 단계를 수행해주세요:

1. 먼저 원격 변경사항을 가져오세요:
   \`\`\`bash
   git fetch origin
   git pull --rebase origin HEAD
   \`\`\`

2. 충돌이 발생하면 해결하세요:
   - 충돌 파일을 확인하고 수정
   - git add로 스테이징
   - git rebase --continue 실행

3. 다시 푸시하세요:
   \`\`\`bash
   git push origin HEAD
   \`\`\`

작업을 계속 진행해주세요.`;
}

/** Generate guidance message for merge conflict */
export function getMergeConflictGuidance(): string {
  return `[SYSTEM INTERVENTION] Merge conflict가 발생했습니다. 다음 단계를 수행해주세요:

1. 충돌 파일 확인:
   \`\`\`bash
   git status
   \`\`\`

2. 각 충돌 파일을 열어서 수동으로 해결:
   - <<<<<<< 와 >>>>>>> 사이의 내용을 확인
   - 적절한 코드를 선택하거나 병합
   - 충돌 마커 제거

3. 해결 후 스테이징 및 커밋:
   \`\`\`bash
   git add -A
   git commit -m "chore: resolve merge conflict"
   git push origin HEAD
   \`\`\`

작업을 계속 진행해주세요.`;
}

/** Generate guidance message for general git error */
export function getGitErrorGuidance(errorMessage: string): string {
  return `[SYSTEM INTERVENTION] Git 작업 중 오류가 발생했습니다:
${errorMessage}

다음을 시도해주세요:
1. git status로 현재 상태 확인
2. 필요시 git reset --hard HEAD로 초기화
3. 원격 저장소와 동기화: git fetch origin && git pull --rebase

작업을 계속 진행해주세요.`;
}

// ============================================================================
// Recovery State Manager
// ============================================================================

/**
 * Manages recovery state for all lanes
 */
export class AutoRecoveryManager {
  private config: AutoRecoveryConfig;
  private laneStates: Map<string, LaneRecoveryState> = new Map();
  private eventHandlers: Map<string, () => void> = new Map();

  constructor(config: Partial<AutoRecoveryConfig> = {}) {
    this.config = { ...DEFAULT_AUTO_RECOVERY_CONFIG, ...config };
  }

  /**
   * Register a lane for recovery monitoring
   */
  registerLane(laneName: string): void {
    const now = Date.now();
    this.laneStates.set(laneName, {
      laneName,
      stage: RecoveryStage.NORMAL,
      lastActivityTime: now,
      lastBytesReceived: 0,
      totalBytesReceived: 0,
      lastOutput: '',
      restartCount: 0,
      continueSignalsSent: 0,
      lastStageChangeTime: now,
      isLongOperation: false,
      failureHistory: [],
    });
    
    if (this.config.verbose) {
      logger.info(`[AutoRecovery] Registered lane: ${laneName}`);
    }
  }

  /**
   * Unregister a lane from recovery monitoring
   */
  unregisterLane(laneName: string): void {
    this.laneStates.delete(laneName);
    
    const handler = this.eventHandlers.get(laneName);
    if (handler) {
      this.eventHandlers.delete(laneName);
    }
  }

  /**
   * Record activity for a lane
   */
  recordActivity(laneName: string, bytesReceived: number = 0, output?: string): void {
    const state = this.laneStates.get(laneName);
    if (!state) return;

    const now = Date.now();
    state.lastActivityTime = now;
    
    if (bytesReceived > 0) {
      state.lastBytesReceived = bytesReceived;
      state.totalBytesReceived += bytesReceived;
    }
    
    if (output) {
      state.lastOutput = output;
      // Check if this is a long operation
      state.isLongOperation = this.config.longOperationPatterns.some(p => p.test(output));
    }
    
    // Reset stage if we got meaningful activity
    if (bytesReceived > 0 && state.stage !== RecoveryStage.NORMAL) {
      if (this.config.verbose) {
        logger.info(`[AutoRecovery] [${laneName}] Activity detected, resetting to NORMAL stage`);
      }
      state.stage = RecoveryStage.NORMAL;
      state.lastStageChangeTime = now;
    }
  }

  /**
   * Get current recovery state for a lane
   */
  getState(laneName: string): LaneRecoveryState | undefined {
    return this.laneStates.get(laneName);
  }

  /**
   * Check if a lane needs recovery intervention
   */
  needsIntervention(laneName: string): boolean {
    const state = this.laneStates.get(laneName);
    if (!state) return false;

    const now = Date.now();
    const idleTime = now - state.lastActivityTime;
    
    // Use longer timeout for long operations
    const effectiveTimeout = state.isLongOperation 
      ? this.config.longOperationGraceMs 
      : this.config.idleTimeoutMs;

    // Check based on current stage
    switch (state.stage) {
      case RecoveryStage.NORMAL:
        return idleTime > effectiveTimeout;
        
      case RecoveryStage.CONTINUE_SIGNAL:
        return (now - state.lastStageChangeTime) > this.config.continueGraceMs;
        
      case RecoveryStage.STRONGER_PROMPT:
        return (now - state.lastStageChangeTime) > this.config.strongerPromptGraceMs;
        
      case RecoveryStage.RESTART_PROCESS:
        // After restart, use normal timeout to detect if it's working
        return idleTime > effectiveTimeout;
        
      case RecoveryStage.DIAGNOSE:
      case RecoveryStage.ABORT:
        return false; // No more interventions
        
      default:
        return false;
    }
  }

  /**
   * Get the next recovery action for a lane
   */
  async getRecoveryAction(
    laneName: string, 
    laneRunDir: string,
    child?: ChildProcess
  ): Promise<RecoveryActionResult> {
    const state = this.laneStates.get(laneName);
    if (!state) {
      return {
        success: false,
        action: 'none',
        message: 'Lane not registered',
        shouldContinue: false,
      };
    }

    const now = Date.now();
    const idleTime = now - state.lastActivityTime;
    const idleSeconds = Math.round(idleTime / 1000);

    switch (state.stage) {
      case RecoveryStage.NORMAL:
        // Escalate to CONTINUE_SIGNAL
        return await this.sendContinueSignal(laneName, laneRunDir, state, idleSeconds);

      case RecoveryStage.CONTINUE_SIGNAL:
        // Try a stronger prompt
        return await this.sendStrongerPrompt(laneName, laneRunDir, state);

      case RecoveryStage.STRONGER_PROMPT:
        // Try restarting the process
        if (state.restartCount < this.config.maxRestarts) {
          return await this.requestRestart(laneName, state, child);
        }
        // Fall through to diagnose
        state.stage = RecoveryStage.DIAGNOSE;
        state.lastStageChangeTime = now;
        return await this.runDiagnosis(laneName, laneRunDir, state);

      case RecoveryStage.RESTART_PROCESS:
        // After restart, if still no response, diagnose
        if (state.restartCount >= this.config.maxRestarts) {
          state.stage = RecoveryStage.DIAGNOSE;
          state.lastStageChangeTime = now;
          return await this.runDiagnosis(laneName, laneRunDir, state);
        }
        // Try continue signal again after restart
        return await this.sendContinueSignal(laneName, laneRunDir, state, idleSeconds);

      case RecoveryStage.DIAGNOSE:
        // Final stage - abort
        state.stage = RecoveryStage.ABORT;
        state.lastStageChangeTime = now;
        return {
          success: false,
          action: 'abort',
          message: `Lane ${laneName} failed after all recovery attempts`,
          shouldContinue: false,
          nextStage: RecoveryStage.ABORT,
          diagnostic: state.diagnosticInfo,
        };

      default:
        return {
          success: false,
          action: 'abort',
          message: 'Recovery exhausted',
          shouldContinue: false,
        };
    }
  }

  /**
   * Send a continue signal to the lane
   */
  private async sendContinueSignal(
    laneName: string,
    laneRunDir: string,
    state: LaneRecoveryState,
    idleSeconds: number
  ): Promise<RecoveryActionResult> {
    const interventionPath = safeJoin(laneRunDir, 'intervention.txt');
    
    try {
      fs.writeFileSync(interventionPath, 'continue');
      
      state.stage = RecoveryStage.CONTINUE_SIGNAL;
      state.lastStageChangeTime = Date.now();
      state.continueSignalsSent++;
      
      // Record failure history
      state.failureHistory.push({
        timestamp: Date.now(),
        stage: RecoveryStage.CONTINUE_SIGNAL,
        action: 'continue_signal',
        message: `Idle for ${idleSeconds}s`,
        idleTimeMs: idleSeconds * 1000,
        bytesReceived: state.totalBytesReceived,
        lastOutput: state.lastOutput,
      });

      const message = `[${laneName}] Idle for ${idleSeconds}s - sent continue signal (#${state.continueSignalsSent})`;
      logger.warn(message);
      
      events.emit('recovery.continue_signal', {
        laneName,
        idleSeconds,
        signalCount: state.continueSignalsSent,
      });

      return {
        success: true,
        action: 'continue_signal',
        message,
        shouldContinue: true,
        nextStage: RecoveryStage.CONTINUE_SIGNAL,
      };
    } catch (error: any) {
      logger.error(`[AutoRecovery] Failed to send continue signal to ${laneName}: ${error.message}`);
      return {
        success: false,
        action: 'continue_signal',
        message: `Failed to send continue signal: ${error.message}`,
        shouldContinue: true,
      };
    }
  }

  /**
   * Send a stronger prompt to nudge the agent
   */
  private async sendStrongerPrompt(
    laneName: string,
    laneRunDir: string,
    state: LaneRecoveryState
  ): Promise<RecoveryActionResult> {
    const interventionPath = safeJoin(laneRunDir, 'intervention.txt');
    
    const strongerPrompt = `[SYSTEM INTERVENTION] You seem to be stuck or waiting. 
Please continue with your current task immediately. 
If you're waiting for something, explain what you need and proceed with what you can do now.
If you've completed the task, please summarize your work and finish.
If you encountered a git error, resolve it and continue.`;
    
    try {
      fs.writeFileSync(interventionPath, strongerPrompt);
      
      state.stage = RecoveryStage.STRONGER_PROMPT;
      state.lastStageChangeTime = Date.now();
      
      // Record failure history
      state.failureHistory.push({
        timestamp: Date.now(),
        stage: RecoveryStage.STRONGER_PROMPT,
        action: 'stronger_prompt',
        message: 'Still idle after continue signal',
        idleTimeMs: Date.now() - state.lastActivityTime,
        bytesReceived: state.totalBytesReceived,
        lastOutput: state.lastOutput,
      });

      const message = `[${laneName}] Still idle after continue signal - sent stronger prompt`;
      logger.warn(message);
      
      events.emit('recovery.stronger_prompt', {
        laneName,
        prompt: strongerPrompt,
      });

      return {
        success: true,
        action: 'stronger_prompt',
        message,
        shouldContinue: true,
        nextStage: RecoveryStage.STRONGER_PROMPT,
      };
    } catch (error: any) {
      logger.error(`[AutoRecovery] Failed to send stronger prompt to ${laneName}: ${error.message}`);
      return {
        success: false,
        action: 'stronger_prompt',
        message: `Failed to send stronger prompt: ${error.message}`,
        shouldContinue: true,
      };
    }
  }

  /**
   * Request process restart
   */
  private async requestRestart(
    laneName: string,
    state: LaneRecoveryState,
    child?: ChildProcess
  ): Promise<RecoveryActionResult> {
    state.restartCount++;
    state.stage = RecoveryStage.RESTART_PROCESS;
    state.lastStageChangeTime = Date.now();
    
    // Record failure history
    state.failureHistory.push({
      timestamp: Date.now(),
      stage: RecoveryStage.RESTART_PROCESS,
      action: 'restart',
      message: `Restart attempt ${state.restartCount}/${this.config.maxRestarts}`,
      idleTimeMs: Date.now() - state.lastActivityTime,
      bytesReceived: state.totalBytesReceived,
      lastOutput: state.lastOutput,
    });

    // Kill the current process if provided
    if (child && child.pid && !child.killed) {
      try {
        child.kill('SIGKILL');
        logger.info(`[AutoRecovery] [${laneName}] Killed process ${child.pid}`);
      } catch (error: any) {
        logger.warn(`[AutoRecovery] [${laneName}] Failed to kill process: ${error.message}`);
      }
    }

    const message = `[${laneName}] Restarting lane (attempt ${state.restartCount}/${this.config.maxRestarts})`;
    logger.warn(message);
    
    events.emit('recovery.restart', {
      laneName,
      restartCount: state.restartCount,
      maxRestarts: this.config.maxRestarts,
    });

    return {
      success: true,
      action: 'restart',
      message,
      shouldContinue: true,
      nextStage: RecoveryStage.RESTART_PROCESS,
    };
  }

  /**
   * Run diagnostic checks
   */
  private async runDiagnosis(
    laneName: string,
    laneRunDir: string,
    state: LaneRecoveryState
  ): Promise<RecoveryActionResult> {
    if (!this.config.runDoctorOnFailure) {
      return {
        success: false,
        action: 'diagnose',
        message: 'Diagnosis skipped (disabled in config)',
        shouldContinue: false,
      };
    }

    logger.info(`[AutoRecovery] [${laneName}] Running diagnostic checks...`);

    try {
      // Run health checks
      const [agentHealth, authHealth] = await Promise.all([
        checkAgentHealth(),
        checkAuthHealth(),
      ]);

      const systemHealth = await runHealthCheck({ skipRemote: true, skipAuth: true });

      const diagnostic: DiagnosticInfo = {
        timestamp: Date.now(),
        agentHealthy: agentHealth.ok,
        authHealthy: authHealth.ok,
        systemHealthy: systemHealth.healthy,
        suggestedAction: '',
        details: '',
      };

      // Analyze and suggest action
      const issues: string[] = [];
      
      if (!agentHealth.ok) {
        issues.push(`Agent: ${agentHealth.message}`);
      }
      
      if (!authHealth.ok) {
        issues.push(`Auth: ${authHealth.message}`);
        diagnostic.suggestedAction = 'Please sign in to Cursor IDE and verify authentication';
      }
      
      if (!systemHealth.healthy) {
        const failedChecks = systemHealth.checks.filter(c => !c.ok);
        issues.push(`System: ${failedChecks.map(c => c.message).join(', ')}`);
      }

      if (issues.length === 0) {
        diagnostic.details = 'All health checks passed. The issue may be with the AI model or network.';
        diagnostic.suggestedAction = 'Try resuming with a different model or wait and retry.';
      } else {
        diagnostic.details = issues.join('\n');
      }

      state.diagnosticInfo = diagnostic;
      
      // Record failure history
      state.failureHistory.push({
        timestamp: Date.now(),
        stage: RecoveryStage.DIAGNOSE,
        action: 'diagnose',
        message: diagnostic.details,
        idleTimeMs: Date.now() - state.lastActivityTime,
        bytesReceived: state.totalBytesReceived,
        lastOutput: state.lastOutput,
      });

      // Save diagnostic to file
      const diagnosticPath = safeJoin(laneRunDir, 'diagnostic.json');
      fs.writeFileSync(diagnosticPath, JSON.stringify(diagnostic, null, 2));

      const message = `[${laneName}] Diagnostic complete:\n${diagnostic.details}\nSuggested action: ${diagnostic.suggestedAction}`;
      logger.error(message);

      events.emit('recovery.diagnosed', {
        laneName,
        diagnostic,
      });

      return {
        success: true,
        action: 'diagnose',
        message,
        shouldContinue: false,
        diagnostic,
      };
    } catch (error: any) {
      logger.error(`[AutoRecovery] Diagnostic failed: ${error.message}`);
      return {
        success: false,
        action: 'diagnose',
        message: `Diagnostic failed: ${error.message}`,
        shouldContinue: false,
      };
    }
  }

  /**
   * Get failure history for a lane
   */
  getFailureHistory(laneName: string): FailureRecord[] {
    const state = this.laneStates.get(laneName);
    return state?.failureHistory || [];
  }

  /**
   * Get configuration
   */
  getConfig(): AutoRecoveryConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AutoRecoveryConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

// ============================================================================
// POF (Post-mortem of Failure) Management
// ============================================================================

/**
 * Save a POF entry to the pof directory
 */
export function savePOF(
  runId: string,
  pofDir: string,
  entry: POFEntry
): string {
  // Ensure pof directory exists
  if (!fs.existsSync(pofDir)) {
    fs.mkdirSync(pofDir, { recursive: true });
  }

  const pofPath = safeJoin(pofDir, `pof-${runId}.json`);
  
  let existingPOF: POFEntry | null = null;
  try {
    const data = fs.readFileSync(pofPath, 'utf8');
    existingPOF = JSON.parse(data);
  } catch {
    // File doesn't exist or is invalid JSON - ignore
  }

  // If there's an existing POF, add it to previousFailures
  if (existingPOF) {
    entry.previousFailures = entry.previousFailures || [];
    entry.previousFailures.unshift(existingPOF);
  }

  // Use atomic write: write to temp file then rename
  const tempPath = `${pofPath}.${Math.random().toString(36).substring(2, 7)}.tmp`;
  try {
    fs.writeFileSync(tempPath, JSON.stringify(entry, null, 2), 'utf8');
    fs.renameSync(tempPath, pofPath);
  } catch (err) {
    // If temp file was created, try to clean it up
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch { /* ignore */ }
    throw err;
  }
  
  logger.info(`[POF] Saved post-mortem to ${pofPath}`);
  
  return pofPath;
}

/**
 * Create a POF entry from recovery state
 */
export function createPOFFromRecoveryState(
  runId: string,
  runDir: string,
  laneName: string,
  state: LaneRecoveryState,
  laneState: LaneState | null,
  diagnostic?: DiagnosticInfo
): POFEntry {
  const now = new Date();
  
  // Determine root cause type
  let rootCauseType = 'AGENT_NO_RESPONSE';
  let rootCauseDescription = 'Agent stopped responding and did not recover after multiple interventions';
  const symptoms: string[] = [];
  
  if (state.totalBytesReceived === 0) {
    rootCauseType = 'AGENT_NO_RESPONSE';
    rootCauseDescription = 'Agent produced 0 bytes of output - possible API or network issue';
    symptoms.push('No bytes received from agent');
  } else if (state.restartCount >= 2) {
    rootCauseType = 'ZOMBIE_PROCESS';
    rootCauseDescription = 'Lane processes repeatedly failed to make progress after restarts';
    symptoms.push(`Restarted ${state.restartCount} times without success`);
  }
  
  symptoms.push(`Total bytes received: ${state.totalBytesReceived}`);
  symptoms.push(`Continue signals sent: ${state.continueSignalsSent}`);
  symptoms.push(`Last output: ${state.lastOutput.substring(0, 100)}...`);
  
  // Possible causes based on diagnostic
  const possibleCauses: string[] = [
    'Model API rate limiting or quota exceeded',
    'Cursor authentication token expired',
    'Network connectivity issues',
    'Agent process hung waiting for stdin/stdout',
  ];
  
  if (diagnostic) {
    if (!diagnostic.agentHealthy) {
      possibleCauses.unshift('cursor-agent CLI is not responding properly');
    }
    if (!diagnostic.authHealthy) {
      possibleCauses.unshift('Cursor authentication failed or expired');
    }
  }

  const entry: POFEntry = {
    title: 'Run Failure Post-mortem',
    runId,
    failureTime: now.toISOString(),
    detectedAt: now.toISOString(),
    summary: `Lane ${laneName} failed after ${state.restartCount} restart(s) and ${state.continueSignalsSent} continue signal(s)`,
    rootCause: {
      type: rootCauseType,
      description: rootCauseDescription,
      symptoms,
    },
    affectedLanes: [
      {
        name: laneName,
        status: 'failed',
        task: laneState ? `[${(laneState.currentTaskIndex || 0) + 1}/${laneState.totalTasks}]` : 'unknown',
        taskIndex: laneState?.currentTaskIndex || 0,
        pid: laneState?.pid,
        reason: rootCauseDescription,
        recoveryAttempts: state.failureHistory,
      },
    ],
    possibleCauses,
    recovery: {
      command: `cursorflow resume --all --run-dir ${runDir}`,
      description: 'Resume all failed lanes from their last checkpoint',
      alternativeCommand: `cursorflow resume --all --restart --run-dir ${runDir}`,
      alternativeDescription: 'Restart all failed lanes from the beginning',
    },
  };

  return entry;
}

/**
 * Load existing POF entries for a run
 */
export function loadPOF(pofDir: string, runId: string): POFEntry | null {
  const pofPath = safeJoin(pofDir, `pof-${runId}.json`);
  
  if (!fs.existsSync(pofPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(pofPath, 'utf8'));
  } catch (error: any) {
    logger.warn(`[POF] Failed to load POF from ${pofPath}: ${error.message}`);
    return null;
  }
}

/**
 * List all POF files in a directory
 */
export function listPOFs(pofDir: string): string[] {
  if (!fs.existsSync(pofDir)) {
    return [];
  }

  return fs.readdirSync(pofDir)
    .filter(f => f.startsWith('pof-') && f.endsWith('.json'))
    .map(f => safeJoin(pofDir, f));
}

// ============================================================================
// Exports
// ============================================================================

/** Singleton instance for easy access */
let defaultManager: AutoRecoveryManager | null = null;

/**
 * Get or create the default auto-recovery manager
 */
export function getAutoRecoveryManager(config?: Partial<AutoRecoveryConfig>): AutoRecoveryManager {
  if (!defaultManager) {
    defaultManager = new AutoRecoveryManager(config);
  } else if (config) {
    defaultManager.updateConfig(config);
  }
  return defaultManager;
}

/**
 * Reset the default manager (for testing)
 */
export function resetAutoRecoveryManager(): void {
  defaultManager = null;
}

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
import { 
  createInterventionRequest, 
  InterventionType,
  createContinueMessage,
  createStrongerPromptMessage,
  createRestartMessage,
} from './intervention';

// ============================================================================
// Types & Constants
// ============================================================================

/** State tracking for a single lane's recovery */
export interface LaneRecoveryState {
  laneName: string;
  runId: string;
  stage: number;
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

/** Record of a failure for POF */
export interface FailureRecord {
  timestamp: number;
  stage: number;
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
// Post-Mortem of Failure (POF) Management
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

// AutoRecoveryManager class removed. All stall detection and recovery logic
// has been moved to StallDetectionService in ./stall-detection.ts.
// Utility functions for POF and git guidance are kept below.


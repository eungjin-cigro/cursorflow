/**
 * CursorFlow signal command
 * 
 * 실행 중인 lane에 즉각적인 개입 메시지 전송
 * 
 * 동작 방식:
 * - 현재 실행 중인 cursor-agent 프로세스를 중단 (SIGTERM)
 * - 개입 메시지를 pending-intervention.json에 저장
 * - Orchestrator가 프로세스 종료를 감지하고 개입 메시지와 함께 resume
 */

import * as fs from 'fs';
import * as logger from '../utils/logger';
import { loadConfig, getLogsDir } from '../utils/config';
import { appendLog, createConversationEntry, loadState } from '../utils/state';
import { safeJoin } from '../utils/path';
import { LaneState } from '../types';
import {
  executeUserIntervention,
  isProcessAlive,
  InterventionResult,
} from '../core/intervention';

interface SignalOptions {
  lane: string | null;
  message: string | null;
  timeout: number | null;
  runDir: string | null;
  force: boolean;  // 프로세스 종료 없이 대기 모드로 전송
  help: boolean;
}

function printHelp(): void {
  console.log(`
Usage: cursorflow signal <lane> "<message>" [options]
       cursorflow signal <lane> --timeout <ms>

Directly intervene in a running lane. The agent will be interrupted immediately
and resume with your intervention message.

Arguments:
  <lane>                 Lane name to signal
  "<message>"            Message text to send to the agent

Options:
  --timeout <ms>         Update execution timeout (in milliseconds)
  --run-dir <path>       Use a specific run directory (default: latest)
  --force                Send signal without interrupting current process
                         (message will be picked up on next task)
  --help, -h             Show help

Examples:
  cursorflow signal lane-1 "Please focus on error handling first"
  cursorflow signal lane-2 "Skip the optional tasks and finish" 
  cursorflow signal lane-1 --timeout 600000   # Set 10 minute timeout
  cursorflow signal lane-1 "Continue" --force # Don't interrupt, wait for next turn
  `);
}

function parseArgs(args: string[]): SignalOptions {
  const runDirIdx = args.indexOf('--run-dir');
  const timeoutIdx = args.indexOf('--timeout');
  
  // First non-option is lane, second (or rest joined) is message
  const nonOptions = args.filter(a => !a.startsWith('--'));
  
  return {
    lane: nonOptions[0] || null,
    message: nonOptions.slice(1).join(' ') || null,
    timeout: timeoutIdx >= 0 ? parseInt(args[timeoutIdx + 1] || '0') || null : null,
    runDir: runDirIdx >= 0 ? args[runDirIdx + 1] || null : null,
    force: args.includes('--force'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

function findLatestRunDir(logsDir: string): string | null {
  const runsDir = safeJoin(logsDir, 'runs');
  if (!fs.existsSync(runsDir)) return null;
  
  const runs = fs.readdirSync(runsDir)
    .filter(d => d.startsWith('run-'))
    .sort()
    .reverse();
    
  return runs.length > 0 ? safeJoin(runsDir, runs[0]!) : null;
}

/**
 * Lane 상태 및 PID 확인
 */
function getLaneStatus(laneDir: string): { state: LaneState | null; isRunning: boolean; pid?: number } {
  const statePath = safeJoin(laneDir, 'state.json');
  
  if (!fs.existsSync(statePath)) {
    return { state: null, isRunning: false };
  }

  const state = loadState<LaneState>(statePath);
  if (!state) {
    return { state: null, isRunning: false };
  }

  const pid = state.pid;
  const isRunning = pid ? isProcessAlive(pid) : false;

  return { state, isRunning, pid };
}

/**
 * 기존 방식으로 intervention.txt만 작성 (--force 옵션용)
 */
function sendLegacyIntervention(laneDir: string, message: string): void {
  const interventionPath = safeJoin(laneDir, 'intervention.txt');
  const convoPath = safeJoin(laneDir, 'conversation.jsonl');
  
  fs.writeFileSync(interventionPath, message);
  
  const entry = createConversationEntry('intervention', `[HUMAN INTERVENTION]: ${message}`, {
    task: 'DIRECT_SIGNAL'
  });
  appendLog(convoPath, entry);
}

async function signal(args: string[]): Promise<void> {
  const options = parseArgs(args);
  
  if (options.help) {
    printHelp();
    return;
  }

  const config = loadConfig();
  const logsDir = getLogsDir(config);
  
  if (!options.lane) {
    throw new Error('Lane name required: cursorflow signal <lane> ...');
  }
  
  let runDir = options.runDir;
  if (!runDir) {
    runDir = findLatestRunDir(logsDir);
  }
  
  if (!runDir || !fs.existsSync(runDir)) {
    throw new Error(`Run directory not found: ${runDir || 'latest'}`);
  }

  const laneDir = safeJoin(runDir, 'lanes', options.lane);
  if (!fs.existsSync(laneDir)) {
    throw new Error(`Lane directory not found: ${laneDir}`);
  }

  // Case 1: Timeout update (기존 로직 유지)
  if (options.timeout !== null) {
    const timeoutPath = safeJoin(laneDir, 'timeout.txt');
    fs.writeFileSync(timeoutPath, String(options.timeout));
    logger.success(`⏱ Timeout update signal sent to ${options.lane}: ${options.timeout}ms`);
    return;
  }

  // Case 2: Intervention message
  if (options.message) {
    const { state, isRunning, pid } = getLaneStatus(laneDir);
    const convoPath = safeJoin(laneDir, 'conversation.jsonl');
    
    logger.info(`📨 Sending intervention to lane: ${options.lane}`);
    logger.info(`   Message: "${options.message.substring(0, 50)}${options.message.length > 50 ? '...' : ''}"`);
    
    // Log to conversation for history
    const entry = createConversationEntry('intervention', `[HUMAN INTERVENTION]: ${options.message}`, {
      task: 'DIRECT_SIGNAL'
    });
    appendLog(convoPath, entry);

    // --force: 기존 방식 (프로세스 중단 없이 파일만 작성)
    if (options.force) {
      sendLegacyIntervention(laneDir, options.message);
      logger.success('✅ Signal queued (--force mode). Message will be applied on next task.');
      return;
    }

    // Lane이 실행 중이 아닌 경우
    if (!isRunning) {
      if (state?.status === 'completed') {
        logger.warn(`⚠ Lane ${options.lane} is already completed.`);
        return;
      }
      
      // 실행 중이 아니면 다음 resume 시 적용되도록 파일만 작성
      sendLegacyIntervention(laneDir, options.message);
      logger.info(`ℹ Lane ${options.lane} is not currently running (status: ${state?.status || 'unknown'}).`);
      logger.success('✅ Signal queued. Message will be applied when lane resumes.');
      return;
    }

    // 즉각 개입 실행: 프로세스 종료 + pending-intervention.json 생성
    logger.info(`🛑 Interrupting running process (PID: ${pid})...`);
    
    const result: InterventionResult = await executeUserIntervention(laneDir, options.message, pid);
    
    if (result.success) {
      if (result.killedPid) {
        logger.success(`✅ Process ${result.killedPid} interrupted successfully.`);
        logger.info('   The agent will resume with your intervention message.');
        logger.info('   Monitor progress with: cursorflow monitor');
      } else {
        logger.success('✅ Intervention request created.');
        logger.info('   Message will be applied on next agent turn.');
      }
    } else {
      logger.error(`❌ Failed to send intervention: ${result.error}`);
      
      // 실패해도 파일은 작성되었으므로 다음 기회에 적용됨
      if (result.pendingFile) {
        logger.info('   Intervention file was created and will be applied on next opportunity.');
      }
    }
    
    return;
  }

  throw new Error('Either a message or --timeout is required.');
}

export = signal;

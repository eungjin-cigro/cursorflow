/**
 * CursorFlow Hook System - Context Builders
 * 
 * 각 Hook Point에 대한 컨텍스트를 생성하는 빌더 함수들입니다.
 */

import {
  HookContext,
  BeforeTaskContext,
  AfterTaskContext,
  OnErrorContext,
  OnStallContext,
  OnLaneEndContext,
  TaskDefinition,
  TaskResult,
  DependencyResult,
  FlowController,
  HookDataAccessor,
} from '../types';
import { createDataAccessor, DataAccessorOptions } from '../data-accessor';
import { createFlowController, FlowControllerOptions, FlowControllerImpl } from '../flow-controller';

// ============================================================================
// Base Context Builder Options
// ============================================================================

export interface BaseContextOptions {
  /** Lane 이름 */
  laneName: string;
  /** Run ID */
  runId: string;
  /** 현재 태스크 인덱스 */
  taskIndex: number;
  /** 전체 태스크 수 */
  totalTasks: number;
  /** 현재 태스크 */
  task: {
    name: string;
    prompt: string;
    model: string;
    dependsOn?: string[];
  };
  /** Worktree 디렉토리 */
  worktreeDir: string;
  /** Run 디렉토리 */
  runDir: string;
  /** 태스크 브랜치 */
  taskBranch: string;
  /** 파이프라인 브랜치 */
  pipelineBranch: string;
  /** 태스크 파일 경로 */
  tasksFile: string;
  /** Chat ID */
  chatId: string;
  /** 태스크 목록 (수정 가능 참조) */
  tasks: TaskDefinition[];
  /** 완료된 태스크 목록 */
  completedTasks: TaskResult[];
  /** 의존성 결과 */
  dependencyResults: DependencyResult[];
  /** 태스크 시작 시간 */
  taskStartTime: number;
  /** Lane 시작 시간 */
  laneStartTime: number;
  /** AgentSupervisor 인스턴스 */
  agentSupervisor?: any;
  /** Run Root */
  runRoot?: string;
}

// ============================================================================
// Context Builders
// ============================================================================

/**
 * 기본 컨텍스트 생성
 */
function createBaseContext(options: BaseContextOptions): {
  context: Omit<HookContext, 'flow' | 'getData'>;
  flowController: FlowControllerImpl;
  dataAccessor: HookDataAccessor;
} {
  // FlowController 생성
  const flowControllerOptions: FlowControllerOptions = {
    laneName: options.laneName,
    runDir: options.runDir,
    worktreeDir: options.worktreeDir,
    currentTaskIndex: options.taskIndex,
    tasks: options.tasks,
    tasksFile: options.tasksFile,
    chatId: options.chatId,
    agentSupervisor: options.agentSupervisor,
  };
  
  const flowController = createFlowController(flowControllerOptions);
  
  // DataAccessor 생성
  const dataAccessorOptions: DataAccessorOptions = {
    worktreeDir: options.worktreeDir,
    runDir: options.runDir,
    taskBranch: options.taskBranch,
    pipelineBranch: options.pipelineBranch,
    laneName: options.laneName,
    taskName: options.task.name,
    completedTasks: options.completedTasks,
    pendingTasks: options.tasks.slice(options.taskIndex + 1),
    dependencyResults: options.dependencyResults,
    taskStartTime: options.taskStartTime,
    laneStartTime: options.laneStartTime,
    runRoot: options.runRoot,
  };
  
  const dataAccessor = createDataAccessor(dataAccessorOptions);
  
  // 기본 컨텍스트
  const context = {
    laneName: options.laneName,
    runId: options.runId,
    taskIndex: options.taskIndex,
    totalTasks: options.totalTasks,
    task: options.task,
  };
  
  return { context, flowController, dataAccessor };
}

/**
 * beforeTask 컨텍스트 생성
 */
export function createBeforeTaskContext(options: BaseContextOptions): {
  context: BeforeTaskContext;
  flowController: FlowControllerImpl;
} {
  const { context, flowController, dataAccessor } = createBaseContext(options);
  
  return {
    context: {
      ...context,
      flow: flowController,
      getData: dataAccessor,
    },
    flowController,
  };
}

/**
 * afterTask 컨텍스트 생성
 */
export function createAfterTaskContext(
  options: BaseContextOptions,
  result: {
    status: 'success' | 'error' | 'blocked';
    exitCode?: number;
    error?: string;
  }
): {
  context: AfterTaskContext;
  flowController: FlowControllerImpl;
} {
  const { context, flowController, dataAccessor } = createBaseContext(options);
  
  return {
    context: {
      ...context,
      flow: flowController,
      getData: dataAccessor,
      result,
    },
    flowController,
  };
}

/**
 * onError 컨텍스트 생성
 */
export function createOnErrorContext(
  options: BaseContextOptions,
  error: {
    type: 'agent_error' | 'git_error' | 'timeout' | 'unknown';
    message: string;
    stack?: string;
    retryable: boolean;
  }
): {
  context: OnErrorContext;
  flowController: FlowControllerImpl;
} {
  const { context, flowController, dataAccessor } = createBaseContext(options);
  
  return {
    context: {
      ...context,
      flow: flowController,
      getData: dataAccessor,
      error,
    },
    flowController,
  };
}

/**
 * onStall 컨텍스트 생성
 */
export function createOnStallContext(
  options: BaseContextOptions,
  stall: {
    idleTimeMs: number;
    lastActivity: string;
    bytesReceived: number;
    phase: 'initial' | 'warning' | 'critical';
  }
): {
  context: OnStallContext;
  flowController: FlowControllerImpl;
} {
  const { context, flowController, dataAccessor } = createBaseContext(options);
  
  return {
    context: {
      ...context,
      flow: flowController,
      getData: dataAccessor,
      stall,
    },
    flowController,
  };
}

/**
 * onLaneEnd 컨텍스트 생성
 */
export function createOnLaneEndContext(
  options: BaseContextOptions,
  summary: {
    status: 'completed' | 'failed' | 'aborted';
    completedTasks: number;
    failedTasks: number;
    totalDuration: number;
  }
): {
  context: OnLaneEndContext;
  flowController: FlowControllerImpl;
} {
  const { context, flowController, dataAccessor } = createBaseContext(options);
  
  return {
    context: {
      ...context,
      flow: flowController,
      getData: dataAccessor,
      summary,
    },
    flowController,
  };
}


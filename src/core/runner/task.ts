import * as path from 'path';
import * as git from '../../utils/git';
import * as logger from '../../utils/logger';
import { events } from '../../utils/events';
import { safeJoin } from '../../utils/path';
import { appendLog, createConversationEntry } from '../../utils/state';
import { Task, RunnerConfig, TaskExecutionResult } from '../../types';
import { waitForTaskDependencies as waitForDeps, DependencyWaitOptions } from '../../utils/dependency';
import { extractDependencyRequest } from './agent';
import { 
  wrapPrompt, 
  applyDependencyFilePermissions 
} from './prompt';
import { 
  loadDependencyResults, 
  saveTaskResult, 
  readDependencyRequestFile, 
  clearDependencyRequestFile,
  DependencyResult
} from './utils';
import { AgentSupervisor } from '../agent-supervisor';

/**
 * Wait for task-level dependencies to be completed by other lanes
 * Now uses the enhanced dependency module with timeout support
 */
export async function waitForTaskDependencies(
  deps: string[], 
  runDir: string,
  options: DependencyWaitOptions = {}
): Promise<void> {
  if (!deps || deps.length === 0) return;

  const lanesRoot = path.dirname(runDir);
  
  const result = await waitForDeps(deps, lanesRoot, {
    timeoutMs: options.timeoutMs || 30 * 60 * 1000, // 30 minutes default
    pollIntervalMs: options.pollIntervalMs || 5000,
    onTimeout: options.onTimeout || 'fail',
    onProgress: (pending, completed) => {
      if (completed.length > 0) {
        logger.info(`Dependencies progress: ${completed.length}/${deps.length} completed`);
      }
    },
  });
  
  if (!result.success) {
    if (result.timedOut) {
      throw new Error(`Dependency wait timed out after ${Math.round(result.elapsedMs / 1000)}s. Pending: ${result.failedDependencies.join(', ')}`);
    }
    throw new Error(`Dependencies failed: ${result.failedDependencies.join(', ')}`);
  }
}

/**
 * Run a single task
 */
export async function runTask({
  task,
  config,
  index,
  worktreeDir,
  pipelineBranch,
  taskBranch,
  chatId,
  runDir,
  runRoot,
  agentSupervisor,
  laneName,
}: {
  task: Task;
  config: RunnerConfig;
  index: number;
  worktreeDir: string;
  pipelineBranch: string;
  taskBranch: string;
  chatId: string;
  runDir: string;
  runRoot?: string;
  agentSupervisor: AgentSupervisor;
  laneName: string;
}): Promise<TaskExecutionResult> {
  // Calculate runRoot if not provided (runDir is lanes/{laneName}/, runRoot is parent of lanes/)
  const calculatedRunRoot = runRoot || path.dirname(path.dirname(runDir));
  const model = task.model || config.model || 'sonnet-4.5';
  const timeout = task.timeout || config.timeout;
  const convoPath = safeJoin(runDir, 'conversation.jsonl');
  
  logger.section(`[${index + 1}/${config.tasks.length}] ${task.name}`);
  logger.info(`Model: ${model}`);
  logger.info(`Branch: ${taskBranch}`);
  
  events.emit('task.started', {
    taskName: task.name,
    taskBranch,
    index,
  });

  // Sync pipelineBranch with remote before starting
  logger.info(`🔄 Syncing ${pipelineBranch} with remote...`);
  
  // Fetch latest from remote
  try {
    git.runGit(['fetch', 'origin', pipelineBranch], { cwd: worktreeDir, silent: true });
  } catch {
    // Branch might not exist on remote yet - that's OK
    logger.info(`  Branch ${pipelineBranch} not yet on remote, skipping sync`);
  }
  
  // Try to fast-forward if behind
  const syncResult = git.syncBranchWithRemote(pipelineBranch, { cwd: worktreeDir, createIfMissing: true });
  if (syncResult.updated) {
    logger.info(`  ✓ Updated ${pipelineBranch} with ${syncResult.behind || 0} new commits from remote`);
  } else if (syncResult.error) {
    logger.warn(`  ⚠️ Could not sync: ${syncResult.error}`);
  }

  // Checkout task branch from pipeline branch
  logger.info(`🌿 Forking task branch: ${taskBranch} from ${pipelineBranch}`);
  git.runGit(['checkout', '-B', taskBranch, pipelineBranch], { cwd: worktreeDir });
  
  // Apply dependency permissions
  applyDependencyFilePermissions(worktreeDir, config.dependencyPolicy);
  
  // Load dependency results if this task has dependsOn
  let dependencyResults: DependencyResult[] = [];
  if (task.dependsOn && task.dependsOn.length > 0) {
    dependencyResults = loadDependencyResults(task.dependsOn, calculatedRunRoot);
  }

  // Wrap prompt with context, dependency results, and completion instructions
  const wrappedPrompt = wrapPrompt(task.prompt, config, { 
    isWorktree: true,
    dependencyResults,
    worktreePath: worktreeDir,
    taskBranch,
    pipelineBranch,
  });
  
  // Log ONLY the original prompt to keep logs clean
  appendLog(convoPath, createConversationEntry('user', task.prompt, {
    task: task.name,
    model,
  }));
  
  logger.info('Sending prompt to agent...');
  const r1 = await agentSupervisor.sendTaskPrompt({
    workspaceDir: worktreeDir,
    chatId,
    prompt: wrappedPrompt,
    model,
    laneName,
    signalDir: runDir,
    timeout,
    enableIntervention: config.enableIntervention,
    outputFormat: config.agentOutputFormat,
    taskName: task.name,
    browser: task.browser || config.browser,
    autoApproveCommands: config.autoApproveCommands,
    autoApproveMcps: config.autoApproveMcps,
  });

  appendLog(convoPath, createConversationEntry('assistant', r1.resultText || r1.error || 'No response', {
    task: task.name,
    model,
  }));
  
  if (!r1.ok) {
    events.emit('task.failed', {
      taskName: task.name,
      taskBranch,
      error: r1.error,
    });
    return {
      taskName: task.name,
      taskBranch,
      status: 'ERROR',
      error: r1.error,
    };
  }
  
  // Check for dependency request (file-based takes priority, then text-based)
  const fileDepReq = readDependencyRequestFile(worktreeDir);
  const textDepReq = extractDependencyRequest(r1.resultText || '');
  
  // Determine which request to use (file-based is preferred as it's more structured)
  const depReq = fileDepReq.required ? fileDepReq : textDepReq;
  
  if (depReq.required) {
    logger.info(`📦 Dependency change requested: ${depReq.plan?.reason || 'No reason provided'}`);
    
    if (depReq.plan) {
      logger.info(`   Commands: ${depReq.plan.commands.join(', ')}`);
    }
    
    if (!config.dependencyPolicy.allowDependencyChange) {
      // Clear the file so it doesn't persist after resolution
      clearDependencyRequestFile(worktreeDir);
      
      return {
        taskName: task.name,
        taskBranch,
        status: 'BLOCKED_DEPENDENCY',
        dependencyRequest: depReq.plan || null,
      };
    }
  }
  
  // Push task branch
  git.push(taskBranch, { cwd: worktreeDir, setUpstream: true });
  
  // Save task result for dependency handoff
  saveTaskResult(runDir, index, task.name, r1.resultText || '');
  
  events.emit('task.completed', {
    taskName: task.name,
    taskBranch,
    status: 'FINISHED',
  });

  return {
    taskName: task.name,
    taskBranch,
    status: 'FINISHED',
  };
}

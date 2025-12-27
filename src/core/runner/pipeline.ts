import * as fs from 'fs';
import * as path from 'path';
import * as git from '../../utils/git';
import * as logger from '../../utils/logger';
import { ensureCursorAgent, checkCursorAuth, printAuthHelp } from '../../utils/cursor-agent';
import { saveState, loadState, validateLaneState, repairLaneState, stateNeedsRecovery } from '../../utils/state';
import { events } from '../../utils/events';
import { preflightCheck, printPreflightReport } from '../../utils/health';
import { createCheckpoint, getLatestCheckpoint } from '../../utils/checkpoint';
import { safeJoin } from '../../utils/path';
import { 
  RunnerConfig, 
  TaskExecutionResult, 
  LaneState
} from '../../types';
import { AgentSupervisor } from '../agent-supervisor';
import { 
  runTask, 
  waitForTaskDependencies
} from './task';
import { GitPipelineCoordinator } from '../git-pipeline-coordinator';

/**
 * Validate task configuration
 */
function validateTaskConfig(config: RunnerConfig): void {
  if (!config.tasks || config.tasks.length === 0) {
    throw new Error('No tasks defined in configuration');
  }
  
  for (let i = 0; i < config.tasks.length; i++) {
    const task = config.tasks[i]!;
    if (!task.name) throw new Error(`Task at index ${i} has no name`);
    if (!task.prompt) throw new Error(`Task "${task.name}" has no prompt`);
  }
}

/**
 * Run all tasks in sequence
 */
export async function runTasks(tasksFile: string, config: RunnerConfig, runDir: string, options: { startIndex?: number; skipPreflight?: boolean } = {}): Promise<TaskExecutionResult[]> {
  const startIndex = options.startIndex || 0;
  
  // Ensure paths are absolute before potentially changing directory
  runDir = path.resolve(runDir);
  tasksFile = path.resolve(tasksFile);
  
  // Validate configuration before starting
  logger.info('Validating task configuration...');
  try {
    validateTaskConfig(config);
    logger.success('✓ Configuration valid');
  } catch (validationError: any) {
    logger.error('❌ Configuration validation failed');
    logger.error(`   ${validationError.message}`);
    throw validationError;
  }
  
  // Run preflight checks (can be skipped for resume)
  if (!options.skipPreflight && startIndex === 0) {
    logger.info('Running preflight checks...');
    const preflight = await preflightCheck({
      requireRemote: true,
      requireAuth: true,
    });
    
    if (!preflight.canProceed) {
      printPreflightReport(preflight);
      throw new Error('Preflight check failed. Please fix the blockers above.');
    }
    
    if (preflight.warnings.length > 0) {
      for (const warning of preflight.warnings) {
        logger.warn(`⚠️  ${warning}`);
      }
    }
    
    logger.success('✓ Preflight checks passed');
  }
  
  // Warn if baseBranch is set in config (it will be ignored)
  if (config.baseBranch) {
    logger.warn(`⚠️  config.baseBranch="${config.baseBranch}" will be ignored. Using current branch instead.`);
  }

  // Set verbose git logging
  git.setVerboseGit(config.verboseGit || false);
  
  // Ensure cursor-agent is installed
  ensureCursorAgent();
  
  // Check authentication before starting
  logger.info('Checking Cursor authentication...');
  const authStatus = checkCursorAuth();
  
  if (!authStatus.authenticated) {
    logger.error('❌ Cursor authentication failed');
    logger.error(`   ${authStatus.message}`);
    
    if (authStatus.details) {
      logger.error(`   Details: ${authStatus.details}`);
    }
    
    if (authStatus.help) {
      logger.error(`   ${authStatus.help}`);
    }
    
    console.log('');
    printAuthHelp();
    
    throw new Error('Cursor authentication required. Please authenticate and try again.');
  }
  
  logger.success('✓ Cursor authentication OK');
  
  const repoRoot = git.getMainRepoRoot();
  
  // ALWAYS use current branch as base - ignore config.baseBranch
  // This ensures dependency structure is maintained in the worktree
  const currentBranch = git.getCurrentBranch(repoRoot);
  logger.info(`📍 Base branch: ${currentBranch} (current branch)`);
  
  // Load existing state if resuming
  const statePath = safeJoin(runDir, 'state.json');
  let state: LaneState | null = null;
  
  if (fs.existsSync(statePath)) {
    // Check if state needs recovery
    if (stateNeedsRecovery(statePath)) {
      logger.warn('State file indicates incomplete previous run. Attempting recovery...');
      const repairedState = repairLaneState(statePath);
      if (repairedState) {
        state = repairedState;
        logger.success('✓ State recovered');
      } else {
        logger.warn('Could not recover state. Starting fresh.');
      }
    } else {
      state = loadState<LaneState>(statePath);
      
      // Validate loaded state
      if (state) {
        const validation = validateLaneState(statePath, {
          checkWorktree: true,
          checkBranch: true,
          autoRepair: true,
        });
        
        if (!validation.valid) {
          logger.warn(`State validation issues: ${validation.issues.join(', ')}`);
          if (validation.repaired) {
            logger.info('State was auto-repaired');
            state = validation.repairedState || state;
          }
        }
      }
    }
  }
  
  const randomSuffix = Math.random().toString(36).substring(2, 7);
  const pipelineBranch = state?.pipelineBranch || config.pipelineBranch || `${config.branchPrefix || 'cursorflow/'}${Date.now().toString(36)}-${randomSuffix}`;
  
  // Flatten the path by replacing slashes with hyphens to avoid race conditions in parent directory creation
  const worktreeDir = state?.worktreeDir || config.worktreeDir || safeJoin(repoRoot, config.worktreeRoot || '_cursorflow/worktrees', pipelineBranch.replace(/\//g, '-'));
  
  if (startIndex === 0) {
    logger.section('🚀 Starting Pipeline');
  } else {
    logger.section(`🔁 Resuming Pipeline from task ${startIndex + 1}`);
  }
  
  logger.info(`Pipeline Branch: ${pipelineBranch}`);
  logger.info(`Worktree: ${worktreeDir}`);
  logger.info(`Tasks: ${config.tasks.length}`);
  
  const gitCoordinator = new GitPipelineCoordinator();
  await gitCoordinator.ensureWorktree({
    worktreeDir,
    pipelineBranch,
    repoRoot,
    baseBranch: currentBranch,
  });
  
  // Change current directory to worktree for all subsequent operations
  // This ensures that all spawned processes (like git or npm) inherit the correct CWD
  logger.info(`Changing directory to worktree: ${worktreeDir}`);
  process.chdir(worktreeDir);
  
  // Create chat
  logger.info('Creating chat session...');
  const agentSupervisor = new AgentSupervisor();
  const chatId = agentSupervisor.createChat(worktreeDir);
  
  // Initialize state if not loaded
  if (!state) {
    state = {
      status: 'running',
      pipelineBranch,
      worktreeDir,
      totalTasks: config.tasks.length,
      currentTaskIndex: 0,
      label: pipelineBranch,
      startTime: Date.now(),
      endTime: null,
      error: null,
      dependencyRequest: null,
      tasksFile, // Store tasks file for resume
      completedTasks: [],
    };
  } else {
    state.status = 'running';
    state.error = null;
    state.dependencyRequest = null;
    state.pipelineBranch = pipelineBranch;
    state.worktreeDir = worktreeDir;
    state.label = state.label || pipelineBranch;
    state.completedTasks = state.completedTasks || [];
  }
  
  saveState(statePath, state);
  
  // Run tasks
  const results: TaskExecutionResult[] = [];
  const laneName = state.label || path.basename(runDir);
  let previousTaskBranch: string | null = null;
  
  for (let i = startIndex; i < config.tasks.length; i++) {
    // Re-read tasks file to allow dynamic updates to future tasks
    try {
      const currentConfig = JSON.parse(fs.readFileSync(tasksFile, 'utf8')) as RunnerConfig;
      if (currentConfig.tasks && currentConfig.tasks.length > i) {
        // Update the current and future tasks from the file
        config.tasks[i] = currentConfig.tasks[i]!;
        // Also update future tasks in case the user added/removed tasks
        for (let j = i + 1; j < currentConfig.tasks.length; j++) {
          config.tasks[j] = currentConfig.tasks[j]!;
        }
        // Sync the length if tasks were added
        if (currentConfig.tasks.length > config.tasks.length) {
          for (let j = config.tasks.length; j < currentConfig.tasks.length; j++) {
            config.tasks.push(currentConfig.tasks[j]!);
          }
        }
        // Update total tasks count in state if it changed
        if (state && state.totalTasks !== currentConfig.tasks.length) {
          state.totalTasks = currentConfig.tasks.length;
          saveState(statePath, state);
          logger.info(`📋 Task list updated. New total tasks: ${state.totalTasks}`);
        }
      }
    } catch (e) {
      logger.warn(`⚠️ Could not reload tasks from ${tasksFile}. Using existing configuration. (${e instanceof Error ? e.message : String(e)})`);
    }

    const task = config.tasks[i]!;
    const taskBranch = `${pipelineBranch}--${String(i + 1).padStart(2, '0')}-${task.name}`;

    // Delete previous task branch if it exists (Task 1 deleted when Task 2 starts, etc.)
    if (previousTaskBranch) {
      logger.info(`🧹 Deleting previous task branch: ${previousTaskBranch}`);
      try {
        // Only delete if it's not the current branch
        const current = git.getCurrentBranch(worktreeDir);
        if (current !== previousTaskBranch) {
          git.deleteBranch(previousTaskBranch, { cwd: worktreeDir, force: true });
        }
      } catch (e) {
        logger.warn(`Failed to delete previous branch ${previousTaskBranch}: ${e}`);
      }
    }

    // Create checkpoint before each task
    try {
      await createCheckpoint(laneName, runDir, worktreeDir, {
        description: `Before task ${i + 1}: ${task.name}`,
        maxCheckpoints: 5,
      });
    } catch (e: any) {
      logger.warn(`Failed to create checkpoint: ${e.message}`);
    }

    // Handle task-level dependencies
    if (task.dependsOn && task.dependsOn.length > 0) {
      state.status = 'waiting';
      state.waitingFor = task.dependsOn;
      saveState(statePath, state);

      try {
        // Use enhanced dependency wait with timeout
        await waitForTaskDependencies(task.dependsOn, runDir, {
          timeoutMs: config.timeout || 30 * 60 * 1000,
          onTimeout: 'fail',
        });
        
        await gitCoordinator.mergeDependencyBranches(task.dependsOn, runDir, worktreeDir, pipelineBranch);
        
        state.status = 'running';
        state.waitingFor = [];
        saveState(statePath, state);
      } catch (e: any) {
        state.status = 'failed';
        state.waitingFor = [];
        state.error = e.message;
        saveState(statePath, state);
        logger.error(`Task dependency wait/merge failed: ${e.message}`);
        
        // Try to restore from checkpoint
        const latestCheckpoint = getLatestCheckpoint(runDir);
        if (latestCheckpoint) {
          logger.info(`💾 Checkpoint available: ${latestCheckpoint.id}`);
          logger.info(`   Resume with: cursorflow resume --checkpoint ${latestCheckpoint.id}`);
        }
        
        process.exit(1);
      }
    }
    
    const result = await runTask({
      task,
      config,
      index: i,
      worktreeDir,
      pipelineBranch,
      taskBranch,
      chatId,
      runDir,
      agentSupervisor,
      laneName,
    });
    
    results.push(result);
    
    // Update state
    state.currentTaskIndex = i + 1;
    state.completedTasks = state.completedTasks || [];
    if (!state.completedTasks.includes(task.name)) {
      state.completedTasks.push(task.name);
    }
    saveState(statePath, state);
    
    // Handle blocked or error
    if (result.status === 'BLOCKED_DEPENDENCY') {
      state.status = 'failed';
      state.dependencyRequest = result.dependencyRequest || null;
      saveState(statePath, state);
      
      if (result.dependencyRequest) {
        events.emit('lane.dependency_requested', {
          laneName: state.label,
          dependencyRequest: result.dependencyRequest,
        });
      }
      
      logger.warn('Task blocked on dependency change');
      process.exit(2);
    }
    
    if (result.status !== 'FINISHED') {
      state.status = 'failed';
      state.error = result.error || 'Unknown error';
      saveState(statePath, state);
      logger.error(`Task failed: ${result.error}`);
      process.exit(1);
    }
    
    // Merge into pipeline
    try {
      gitCoordinator.mergeTaskIntoPipeline({
        taskName: task.name,
        taskBranch,
        pipelineBranch,
        worktreeDir,
      });
    } catch (e: any) {
      state.status = 'failed';
      state.error = e.message;
      saveState(statePath, state);
      process.exit(1);
    }

    git.push(pipelineBranch, { cwd: worktreeDir });
    
    // Set previousTaskBranch for cleanup in the next iteration
    previousTaskBranch = taskBranch;
  }
  
  // Final Consolidation: Create flow branch and cleanup
  const flowBranch = laneName;
  logger.section(`🏁 Final Consolidation: ${flowBranch}`);
  
  // 1. Delete the very last task branch
  if (previousTaskBranch) {
    logger.info(`🧹 Deleting last task branch: ${previousTaskBranch}`);
    try {
      git.deleteBranch(previousTaskBranch, { cwd: worktreeDir, force: true });
    } catch (e) {
      logger.warn(`   Failed to delete last task branch: ${e}`);
    }
  }

  // 2. Create flow branch from pipelineBranch and cleanup
  gitCoordinator.finalizeFlowBranch({
    flowBranch,
    pipelineBranch,
    worktreeDir,
  });

  // Complete
  state.status = 'completed';
  state.endTime = Date.now();
  saveState(statePath, state);
  
  // Log final file summary
  try {
    // Always use current branch for comparison (already captured at start)
    const finalStats = git.runGit(['diff', '--stat', currentBranch, pipelineBranch], { cwd: repoRoot, silent: true });
    if (finalStats) {
      logger.info('Final Workspace Summary:\n' + finalStats);
    }
  } catch (e) {
    // Ignore
  }
  
  logger.success('All tasks completed!');
  return results;
}

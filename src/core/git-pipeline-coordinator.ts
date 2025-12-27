import * as fs from 'fs';
import * as path from 'path';
import * as git from '../utils/git';
import * as logger from '../utils/logger';
import { events } from '../utils/events';
import { safeJoin } from '../utils/path';
import { loadState } from '../utils/state';
import { LaneState } from '../types';

export interface WorktreeSetupOptions {
  worktreeDir: string;
  pipelineBranch: string;
  repoRoot: string;
  baseBranch: string;
}

export class GitPipelineCoordinator {
  async ensureWorktree(options: WorktreeSetupOptions): Promise<void> {
    const { worktreeDir, pipelineBranch, repoRoot, baseBranch } = options;
    const worktreeNeedsCreation = !fs.existsSync(worktreeDir);
    const worktreeIsInvalid = !worktreeNeedsCreation && !git.isValidWorktree(worktreeDir);

    if (worktreeIsInvalid) {
      logger.warn(`⚠️ Directory exists but is not a valid worktree: ${worktreeDir}`);
      logger.info(`   Cleaning up invalid directory and recreating worktree...`);
      try {
        git.cleanupInvalidWorktreeDir(worktreeDir);
      } catch (e: any) {
        logger.error(`Failed to cleanup invalid worktree directory: ${e.message}`);
        throw new Error(`Cannot proceed: worktree directory is invalid and cleanup failed`);
      }
    }

    if (worktreeNeedsCreation || worktreeIsInvalid) {
      let retries = 3;
      let lastError: Error | null = null;

      while (retries > 0) {
        try {
          const worktreeParent = path.dirname(worktreeDir);
          if (!fs.existsSync(worktreeParent)) {
            fs.mkdirSync(worktreeParent, { recursive: true });
          }

          await git.createWorktreeAsync(worktreeDir, pipelineBranch, {
            baseBranch,
            cwd: repoRoot,
          });
          return;
        } catch (e: any) {
          lastError = e;
          retries--;
          if (retries > 0) {
            const delay = Math.floor(Math.random() * 1000) + 500;
            logger.warn(`Worktree creation failed, retrying in ${delay}ms... (${retries} retries left)`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      if (retries === 0 && lastError) {
        throw new Error(`Failed to create Git worktree after retries: ${lastError.message}`);
      }
    } else {
      logger.info(`Reusing existing worktree: ${worktreeDir}`);
      try {
        git.runGit(['checkout', pipelineBranch], { cwd: worktreeDir });
      } catch (e) {
        logger.warn(`Failed to checkout branch ${pipelineBranch} in existing worktree: ${e}`);
      }
    }
  }

  async mergeDependencyBranches(
    deps: string[],
    runDir: string,
    worktreeDir: string,
    pipelineBranch: string
  ): Promise<void> {
    if (!deps || deps.length === 0) return;

    const lanesRoot = path.dirname(runDir);
    const lanesToMerge = new Set(deps.map(d => d.split(':')[0]!));

    logger.info(`🔄 Syncing with ${pipelineBranch} before merging dependencies`);
    git.runGit(['checkout', pipelineBranch], { cwd: worktreeDir });

    for (const laneName of lanesToMerge) {
      const depStatePath = safeJoin(lanesRoot, laneName, 'state.json');
      if (!fs.existsSync(depStatePath)) continue;

      try {
        const state = loadState<LaneState>(depStatePath);
        if (!state?.pipelineBranch) continue;

        logger.info(`Merging branch from ${laneName}: ${state.pipelineBranch}`);
        git.runGit(['fetch', 'origin', state.pipelineBranch], { cwd: worktreeDir, silent: true });

        const remoteBranchRef = `origin/${state.pipelineBranch}`;
        const conflictCheck = git.checkMergeConflict(remoteBranchRef, { cwd: worktreeDir });

        if (conflictCheck.willConflict) {
          logger.warn(`⚠️ Pre-check: Merge conflict detected with ${laneName}`);
          logger.warn(`   Conflicting files: ${conflictCheck.conflictingFiles.join(', ')}`);

          events.emit('merge.conflict_detected', {
            laneName,
            targetBranch: state.pipelineBranch,
            conflictingFiles: conflictCheck.conflictingFiles,
            preCheck: true,
          });

          throw new Error(
            `Pre-merge conflict check failed: ${conflictCheck.conflictingFiles.join(', ')}. ` +
              'Consider rebasing or resolving conflicts manually.'
          );
        }

        const mergeResult = git.safeMerge(remoteBranchRef, {
          cwd: worktreeDir,
          noFf: true,
          message: `chore: merge task dependency from ${laneName}`,
          abortOnConflict: true,
        });

        if (!mergeResult.success) {
          if (mergeResult.conflict) {
            logger.error(`Merge conflict with ${laneName}: ${mergeResult.conflictingFiles.join(', ')}`);
            throw new Error(`Merge conflict: ${mergeResult.conflictingFiles.join(', ')}`);
          }
          throw new Error(mergeResult.error || 'Merge failed');
        }

        logger.success(`✓ Merged ${laneName}`);
      } catch (e) {
        logger.error(`Failed to merge branch from ${laneName}: ${e}`);
        throw e;
      }
    }
  }

  mergeTaskIntoPipeline({
    taskName,
    taskBranch,
    pipelineBranch,
    worktreeDir,
  }: {
    taskName: string;
    taskBranch: string;
    pipelineBranch: string;
    worktreeDir: string;
  }): void {
    logger.info(`Merging ${taskBranch} → ${pipelineBranch}`);
    logger.info(`🔄 Switching to pipeline branch ${pipelineBranch} to integrate changes`);
    git.runGit(['checkout', pipelineBranch], { cwd: worktreeDir });

    const conflictCheck = git.checkMergeConflict(taskBranch, { cwd: worktreeDir });
    if (conflictCheck.willConflict) {
      logger.warn(`⚠️ Unexpected conflict detected when merging ${taskBranch}`);
      logger.warn(`   Conflicting files: ${conflictCheck.conflictingFiles.join(', ')}`);
      logger.warn(`   This may indicate concurrent modifications to ${pipelineBranch}`);

      events.emit('merge.conflict_detected', {
        taskName,
        taskBranch,
        pipelineBranch,
        conflictingFiles: conflictCheck.conflictingFiles,
        preCheck: true,
      });
    }

    logger.info(`🔀 Merging task ${taskName} (${taskBranch}) into ${pipelineBranch}`);
    const mergeResult = git.safeMerge(taskBranch, {
      cwd: worktreeDir,
      noFf: true,
      message: `chore: merge task ${taskName} into pipeline`,
      abortOnConflict: true,
    });

    if (!mergeResult.success) {
      if (mergeResult.conflict) {
        logger.error(`❌ Merge conflict: ${mergeResult.conflictingFiles.join(', ')}`);
        throw new Error(
          `Merge conflict when integrating task ${taskName}: ${mergeResult.conflictingFiles.join(', ')}`
        );
      }
      throw new Error(mergeResult.error || 'Merge failed');
    }

    const stats = git.getLastOperationStats(worktreeDir);
    if (stats) {
      logger.info('Changed files:\n' + stats);
    }
  }

  finalizeFlowBranch({
    flowBranch,
    pipelineBranch,
    worktreeDir,
  }: {
    flowBranch: string;
    pipelineBranch: string;
    worktreeDir: string;
  }): void {
    if (flowBranch === pipelineBranch) return;

    logger.info(`🌿 Creating final flow branch: ${flowBranch}`);
    try {
      git.runGit(['checkout', '-B', flowBranch, pipelineBranch], { cwd: worktreeDir });
      git.push(flowBranch, { cwd: worktreeDir, setUpstream: true });

      logger.info(`🗑️ Deleting local pipeline branch: ${pipelineBranch}`);
      git.runGit(['checkout', flowBranch], { cwd: worktreeDir });
      git.deleteBranch(pipelineBranch, { cwd: worktreeDir, force: true });

      logger.success(`✓ Flow branch '${flowBranch}' created. Remote pipeline branch preserved for dependencies.`);
    } catch (e) {
      logger.error(`❌ Failed during final consolidation: ${e}`);
    }
  }
}

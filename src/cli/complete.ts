/**
 * CursorFlow 'complete' command
 * 
 * Consolidates all lanes of a flow into a single branch and cleans up.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as logger from '../utils/logger';
import * as git from '../utils/git';
import { loadConfig, getLogsDir } from '../utils/config';
import { safeJoin } from '../utils/path';
import { createRunService } from '../utils/run-service';
import { findFlowDir, findLatestFlowOrTask } from '../utils/flow';
import { getAllLaneProcessStatuses, getFlowSummary } from '../services/process';

interface CompleteOptions {
  flowDir?: string;
  targetBranch?: string;
  force: boolean;
  help: boolean;
  dryRun: boolean;
  noCleanup: boolean;
}

function printHelp(): void {
  console.log(`
\x1b[1mcursorflow complete\x1b[0m - Flow 통합 및 마무리

\x1b[1m사용법:\x1b[0m
  cursorflow complete <flow-dir> [options]

\x1b[1m설명:\x1b[0m
  모든 레인의 작업이 완료된 후, 각 레인의 브랜치들을 하나의 통합 브랜치로 병합합니다.
  병합이 성공하면 임시로 사용된 레인 브랜치들과 워크트리들을 삭제합니다.
  
  \x1b[33m참고:\x1b[0m Flow가 성공적으로 완료되면 자동으로 통합됩니다.
  이 명령어는 자동 통합이 실패했을 때 수동으로 복구하거나,
  특정 옵션으로 통합하고 싶을 때 사용합니다.

\x1b[1m옵션:\x1b[0m
  --branch <name>    통합 브랜치 이름 지정 (기본값: feature/<FlowName>-integrated)
  --force            완료되지 않은 레인이 있어도 강제로 진행
  --dry-run          실제로 병합하거나 삭제하지 않고 계획만 출력
  --no-cleanup       병합 후 브랜치 및 워크트리를 삭제하지 않음
  --help, -h         도움말 출력

\x1b[1m예시:\x1b[0m
  # 자동 통합 실패 후 수동 복구
  cursorflow complete ShopFeature
  
  # 특정 브랜치 이름으로 통합
  cursorflow complete ShopFeature --branch feat/shop-v1
  
  # 정리 없이 통합만 수행
  cursorflow complete ShopFeature --no-cleanup
  `);
}

function parseArgs(args: string[]): CompleteOptions {
  const branchIdx = args.indexOf('--branch');
  
  return {
    flowDir: args.find(a => !a.startsWith('--')),
    targetBranch: branchIdx >= 0 ? args[branchIdx + 1] : undefined,
    force: args.includes('--force'),
    help: args.includes('--help') || args.includes('-h'),
    dryRun: args.includes('--dry-run'),
    noCleanup: args.includes('--no-cleanup'),
  };
}

async function complete(args: string[]): Promise<void> {
  const options = parseArgs(args);

  if (options.help) {
    printHelp();
    return;
  }

  const config = loadConfig();
  git.setVerboseGit(config.verboseGit || false);
  const repoRoot = git.getRepoRoot();
  const logsDir = getLogsDir(config);
  const runService = createRunService(config.projectRoot);

  // 1. Find Flow Directory
  let flowDir = '';
  if (!options.flowDir) {
    flowDir = findLatestFlowOrTask(config) || '';
  } else {
    const flowsDir = safeJoin(config.projectRoot, config.flowsDir);
    flowDir = findFlowDir(flowsDir, options.flowDir) || path.resolve(options.flowDir);
  }

  if (!flowDir || !fs.existsSync(flowDir)) {
    throw new Error(`Flow 디렉토리를 찾을 수 없습니다: ${options.flowDir || 'latest'}`);
  }

  logger.section(`🏁 Completing Flow: ${path.basename(flowDir)}`);

  // 2. Find Latest Run
  const runs = runService.listRuns().filter(run => {
    // Check if this run belongs to the target flowDir
    // We look at the first lane's state to check tasksFile
    if (run.lanes.length === 0) return false;
    const laneDir = safeJoin(run.path, 'lanes', run.lanes[0]!.name);
    const statePath = safeJoin(laneDir, 'state.json');
    if (!fs.existsSync(statePath)) return false;
    try {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      return state.tasksFile && path.resolve(path.dirname(state.tasksFile)) === path.resolve(flowDir);
    } catch {
      return false;
    }
  });

  if (runs.length === 0) {
    throw new Error(`이 Flow에 대한 실행 기록(Run)을 찾을 수 없습니다.`);
  }

  const latestRun = runs[0]!;
  logger.info(`Run ID: ${latestRun.id}`);

  // 3. Verify Status
  const summary = getFlowSummary(latestRun.path);
  logger.info(`Status: ${summary.completed}/${summary.total} lanes completed`);

  if (summary.completed < summary.total && !options.force) {
    logger.error(`모든 레인이 완료되지 않았습니다 (${summary.completed}/${summary.total}).`);
    logger.info('완료되지 않은 레인:');
    const statuses = getAllLaneProcessStatuses(latestRun.path);
    for (const s of statuses) {
      if (s.actualStatus !== 'completed') {
        logger.info(`  - ${s.laneName}: ${s.actualStatus}`);
      }
    }
    logger.info('\n강제로 통합하려면 --force 옵션을 사용하세요.');
    process.exit(1);
  }

  // 4. Determine Target Branch Name
  const flowName = path.basename(flowDir).replace(/^\d+_/, '');
  const targetBranch = options.targetBranch || `feature/${flowName}-integrated`;
  
  // 5. Get Base Branch from flow.meta.json
  let baseBranch = 'main';
  const metaPath = safeJoin(flowDir, 'flow.meta.json');
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      baseBranch = meta.baseBranch || 'main';
    } catch (e) {
      logger.warn(`flow.meta.json 읽기 실패, 기본값 main 사용: ${e}`);
    }
  }

  logger.info(`Target Branch: ${targetBranch}`);
  logger.info(`Base Branch: ${baseBranch}`);

  const laneBranches = latestRun.lanes
    .filter(l => l.pipelineBranch)
    .map(l => l.pipelineBranch!);

  if (laneBranches.length === 0) {
    throw new Error(`통합할 브랜치가 없습니다.`);
  }

  logger.info(`Lanes to merge: ${laneBranches.length}`);
  for (const b of laneBranches) {
    logger.info(`  - ${b}`);
  }

  if (options.dryRun) {
    logger.section('🧪 Dry Run: No changes will be made');
    logger.info(`Would create branch '${targetBranch}' from '${baseBranch}'`);
    for (const b of laneBranches) {
      logger.info(`Would merge '${b}' into '${targetBranch}'`);
    }
    if (!options.noCleanup) {
      logger.info(`Would delete ${laneBranches.length} lane branches and ${latestRun.worktrees.length} worktrees`);
    }
    return;
  }

  // 6. Perform Merges
  try {
    // Ensure we are on a clean state in the main repo
    const currentBranch = git.getCurrentBranch(repoRoot);
    if (git.hasUncommittedChanges(repoRoot)) {
      throw new Error('메인 저장소에 커밋되지 않은 변경사항이 있습니다. 커밋하거나 스태시한 후 다시 시도하세요.');
    }

    // Checkout base branch and create target branch
    logger.info(`Creating target branch '${targetBranch}' from '${baseBranch}'...`);
    git.runGit(['checkout', baseBranch], { cwd: repoRoot });
    git.runGit(['checkout', '-B', targetBranch], { cwd: repoRoot });

    // Merge each lane branch
    for (const branch of laneBranches) {
      logger.info(`Merging ${branch}...`);
      
      // Determine what ref to use for merge
      let branchRef: string;
      
      if (git.branchExists(branch, { cwd: repoRoot })) {
        // Local branch exists, use it directly
        branchRef = branch;
      } else {
        // Local branch doesn't exist - fetch from remote with proper refspec
        // Note: `git fetch origin <branch>` only updates FETCH_HEAD, not origin/<branch>
        // We must use refspec to update the remote tracking ref
        logger.info(`  Fetching ${branch} from remote...`);
        try {
          git.runGit(['fetch', 'origin', `${branch}:refs/remotes/origin/${branch}`], { cwd: repoRoot });
          branchRef = `origin/${branch}`;
        } catch (e) {
          // Fallback: try fetching and use FETCH_HEAD directly
          logger.warn(`  Failed to fetch with refspec, trying FETCH_HEAD: ${e}`);
          try {
            git.runGit(['fetch', 'origin', branch], { cwd: repoRoot });
            branchRef = 'FETCH_HEAD';
          } catch (e2) {
            logger.warn(`  Failed to fetch ${branch}: ${e2}`);
            throw new Error(`Cannot fetch branch ${branch} from remote`);
          }
        }
      }
      
      const mergeResult = git.safeMerge(branchRef, {
        cwd: repoRoot,
        noFf: true,
        message: `chore: merge lane ${branch} into flow integration`,
        abortOnConflict: false, // We'll handle it below
      });

      if (!mergeResult.success) {
        if (mergeResult.conflict) {
          logger.error(`❌ '${branch}' 병합 중 충돌이 발생했습니다.`);
          logger.error(`충돌 파일: ${mergeResult.conflictingFiles.join(', ')}`);
          logger.info('\n충돌을 해결한 후 다시 시도하거나, 수동으로 마무리하세요.');
          // Don't abort here, let the user see the state or suggest cleanup
          throw new Error('Merge conflict occurred during integration.');
        } else {
          throw new Error(`병합 실패 (${branch}): ${mergeResult.error}`);
        }
      }
      logger.success(`✓ Merged ${branch}`);
    }

    // 7. Push final branch
    logger.info(`Pushing '${targetBranch}' to remote...`);
    git.push(targetBranch, { cwd: repoRoot, setUpstream: true });
    logger.success(`✓ Pushed ${targetBranch}`);

    // 8. Cleanup
    if (!options.noCleanup) {
      logger.section('🧹 Cleaning Up');
      
      // Delete local and remote lane branches
      for (const branch of laneBranches) {
        // Delete local branch (if exists - lane runner may have already deleted it)
        if (git.branchExists(branch, { cwd: repoRoot })) {
          logger.info(`Deleting local branch: ${branch}`);
          try {
            git.deleteBranch(branch, { cwd: repoRoot, force: true });
          } catch (e) {
            logger.warn(`  Failed to delete local branch ${branch}: ${e}`);
          }
        }
        
        // Delete remote branch (always try - it should exist)
        logger.info(`Deleting remote branch: ${branch}`);
        try {
          git.deleteBranch(branch, { cwd: repoRoot, remote: true });
        } catch {
          // Might not exist on remote or no permission - this is OK
        }
      }

      // Remove worktrees
      for (const wtPath of latestRun.worktrees) {
        if (fs.existsSync(wtPath)) {
          logger.info(`Removing worktree: ${wtPath}`);
          try {
            git.removeWorktree(wtPath, { cwd: repoRoot, force: true });
            if (fs.existsSync(wtPath)) {
              fs.rmSync(wtPath, { recursive: true, force: true });
            }
          } catch (e) {
            logger.warn(`  Failed to remove worktree ${wtPath}: ${e}`);
          }
        }
      }

      // Optional: Delete run directory? Maybe keep logs for a while.
      // logger.info(`Deleting run directory: ${latestRun.path}`);
      // fs.rmSync(latestRun.path, { recursive: true, force: true });
    }

    // 9. Update flow status in meta
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        meta.status = 'completed';
        meta.integratedBranch = targetBranch;
        meta.integratedAt = new Date().toISOString();
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
      } catch (e) {
        logger.warn(`flow.meta.json 업데이트 실패: ${e}`);
      }
    }

    logger.section(`🎉 Flow Completion Success!`);
    logger.info(`Final integrated branch: ${targetBranch}`);
    logger.info(`You are now on branch: ${targetBranch}`);

  } catch (error: any) {
    logger.error(`\n❌ Flow completion failed: ${error.message}`);
    process.exit(1);
  }
}

export = complete;


/**
 * Git Lifecycle Manager
 * 
 * Git 파이프라인의 생명주기를 명확하게 관리합니다.
 * 
 * 작업 흐름:
 * 1. 작업 시작 (startWork): 브랜치 생성 및 체크아웃
 * 2. 작업 중 (saveProgress): 주기적 커밋 (선택적)
 * 3. 작업 종료 (finalizeWork): 남은 변경사항 커밋 및 푸시
 * 4. 머지 (mergeToTarget): 다음 단계로 머지
 * 
 * 생명주기 상태:
 * - IDLE: 초기 상태 / 작업 종료 후
 * - PREPARING: 브랜치 준비 중
 * - WORKING: 작업 진행 중
 * - COMMITTING: 커밋 중
 * - PUSHING: 푸시 중
 * - MERGING: 머지 중
 * - ERROR: 오류 발생
 */

import * as fs from 'fs';
import * as path from 'path';

import * as git from '../utils/git';
import * as logger from '../utils/logger';
import { events } from '../utils/events';
import { safeJoin } from '../utils/path';
import { GitEventType } from '../types/event-categories';

// ============================================================================
// Types & Enums
// ============================================================================

/**
 * Git 작업 생명주기 상태
 */
export enum GitLifecyclePhase {
  /** 대기 상태 */
  IDLE = 'IDLE',
  /** 브랜치/워크트리 준비 중 */
  PREPARING = 'PREPARING',
  /** 작업 진행 중 */
  WORKING = 'WORKING',
  /** 커밋 중 */
  COMMITTING = 'COMMITTING',
  /** 푸시 중 */
  PUSHING = 'PUSHING',
  /** 머지 중 */
  MERGING = 'MERGING',
  /** 오류 발생 */
  ERROR = 'ERROR',
}

/**
 * 브랜치 유형
 */
export enum BranchType {
  /** Pipeline 브랜치 (Lane당 하나) */
  PIPELINE = 'pipeline',
  /** Task 브랜치 (Task당 하나) */
  TASK = 'task',
  /** Flow 브랜치 (최종 결과) */
  FLOW = 'flow',
}

/**
 * 작업 시작 옵션
 */
export interface StartWorkOptions {
  /** 워크트리 디렉토리 */
  worktreeDir: string;
  /** 생성할 브랜치 이름 */
  branchName: string;
  /** 베이스 브랜치 */
  baseBranch: string;
  /** Repository 루트 */
  repoRoot: string;
  /** Lane 이름 (로깅용) */
  laneName?: string;
  /** Task 이름 (로깅용) */
  taskName?: string;
  /** 브랜치 유형 */
  branchType?: BranchType;
  /** 의존성 브랜치들 (머지할 브랜치들) */
  dependencyBranches?: string[];
}

/**
 * 작업 종료 옵션
 */
export interface FinalizeWorkOptions {
  /** 워크트리 디렉토리 */
  worktreeDir: string;
  /** 현재 브랜치 이름 */
  branchName: string;
  /** 커밋 메시지 */
  commitMessage?: string;
  /** Lane 이름 (로깅용) */
  laneName?: string;
  /** Task 이름 (로깅용) */
  taskName?: string;
  /** 푸시 여부 (기본: true) */
  push?: boolean;
  /** 원격 이름 (기본: origin) */
  remote?: string;
  /** 변경사항 없으면 스킵 */
  skipIfClean?: boolean;
}

/**
 * 머지 옵션
 */
export interface MergeOptions {
  /** 워크트리 디렉토리 */
  worktreeDir: string;
  /** 소스 브랜치 */
  sourceBranch: string;
  /** 타겟 브랜치 */
  targetBranch: string;
  /** 커밋 메시지 */
  commitMessage?: string;
  /** Lane 이름 (로깅용) */
  laneName?: string;
  /** 머지 유형 */
  mergeType?: 'task_to_pipeline' | 'dependency' | 'final';
  /** 충돌 시 중단 */
  abortOnConflict?: boolean;
  /** 푸시 여부 */
  push?: boolean;
}

/**
 * 작업 결과
 */
export interface GitOperationResult {
  /** 성공 여부 */
  success: boolean;
  /** 오류 메시지 */
  error?: string;
  /** 생성된 커밋 해시 */
  commitHash?: string;
  /** 변경된 파일 수 */
  filesChanged?: number;
  /** 추가 정보 */
  details?: Record<string, any>;
}

/**
 * Lane별 Git 상태 추적
 */
interface LaneGitState {
  laneName: string;
  phase: GitLifecyclePhase;
  currentBranch: string | null;
  pipelineBranch: string | null;
  worktreeDir: string | null;
  lastCommitHash: string | null;
  uncommittedChanges: boolean;
  lastOperation: string | null;
  lastOperationTime: number | null;
  error: string | null;
}

// ============================================================================
// Git Lifecycle Manager
// ============================================================================

/**
 * Git 파이프라인 생명주기 관리자
 * 
 * 사용 예:
 * ```typescript
 * const gitManager = GitLifecycleManager.getInstance();
 * 
 * // 1. 작업 시작
 * await gitManager.startWork({
 *   worktreeDir: '/path/to/worktree',
 *   branchName: 'cursorflow/task-1',
 *   baseBranch: 'main',
 *   repoRoot: '/path/to/repo',
 *   laneName: 'lane-1'
 * });
 * 
 * // 2. 작업 진행...
 * 
 * // 3. 작업 종료 (모든 변경사항 커밋 및 푸시)
 * await gitManager.finalizeWork({
 *   worktreeDir: '/path/to/worktree',
 *   branchName: 'cursorflow/task-1',
 *   commitMessage: 'feat: implement feature',
 *   laneName: 'lane-1'
 * });
 * 
 * // 4. 파이프라인 브랜치로 머지
 * await gitManager.mergeToTarget({
 *   worktreeDir: '/path/to/worktree',
 *   sourceBranch: 'cursorflow/task-1',
 *   targetBranch: 'cursorflow/pipeline',
 *   laneName: 'lane-1',
 *   mergeType: 'task_to_pipeline'
 * });
 * ```
 */
export class GitLifecycleManager {
  private static instance: GitLifecycleManager | null = null;
  
  /** Lane별 상태 추적 */
  private laneStates: Map<string, LaneGitState> = new Map();
  
  /** 디버그 모드 */
  private verbose: boolean = false;
  
  private constructor() {
    this.verbose = process.env['DEBUG_GIT'] === 'true';
  }
  
  /**
   * 싱글톤 인스턴스 획득
   */
  static getInstance(): GitLifecycleManager {
    if (!GitLifecycleManager.instance) {
      GitLifecycleManager.instance = new GitLifecycleManager();
    }
    return GitLifecycleManager.instance;
  }
  
  /**
   * 인스턴스 리셋 (테스트용)
   */
  static resetInstance(): void {
    GitLifecycleManager.instance = null;
  }
  
  // --------------------------------------------------------------------------
  // Lane State Management
  // --------------------------------------------------------------------------
  
  /**
   * Lane의 Git 상태 초기화
   */
  initializeLane(laneName: string, pipelineBranch: string, worktreeDir?: string): void {
    this.laneStates.set(laneName, {
      laneName,
      phase: GitLifecyclePhase.IDLE,
      currentBranch: null,
      pipelineBranch,
      worktreeDir: worktreeDir || null,
      lastCommitHash: null,
      uncommittedChanges: false,
      lastOperation: null,
      lastOperationTime: null,
      error: null,
    });
    
    this.log(`[${laneName}] Git state initialized (pipeline: ${pipelineBranch})`);
  }
  
  /**
   * Lane의 Git 상태 조회
   */
  getLaneState(laneName: string): LaneGitState | undefined {
    return this.laneStates.get(laneName);
  }
  
  /**
   * Lane 상태 업데이트
   */
  private updateLaneState(laneName: string, updates: Partial<LaneGitState>): void {
    const state = this.laneStates.get(laneName);
    if (state) {
      Object.assign(state, updates, { lastOperationTime: Date.now() });
    }
  }
  
  // --------------------------------------------------------------------------
  // 1. Work Start (작업 시작)
  // --------------------------------------------------------------------------
  
  /**
   * 작업 시작 - 브랜치 생성 및 체크아웃
   * 
   * 1. 워크트리가 없으면 생성
   * 2. 브랜치가 없으면 baseBranch에서 생성
   * 3. 의존성 브랜치들 머지 (있는 경우)
   * 4. 브랜치 체크아웃
   */
  async startWork(options: StartWorkOptions): Promise<GitOperationResult> {
    const { 
      worktreeDir, 
      branchName, 
      baseBranch, 
      repoRoot,
      laneName = 'unknown',
      taskName,
      branchType = BranchType.TASK,
      dependencyBranches = [],
    } = options;
    
    this.updateLaneState(laneName, {
      phase: GitLifecyclePhase.PREPARING,
      lastOperation: 'startWork',
      error: null,
    });
    
    try {
      // 1. 워크트리 확인/생성
      const worktreeResult = await this.ensureWorktree(worktreeDir, branchName, baseBranch, repoRoot, laneName);
      if (!worktreeResult.success) {
        return worktreeResult;
      }
      
      // 2. 브랜치 체크아웃
      this.log(`[${laneName}] Checking out branch: ${branchName}`);
      git.runGit(['checkout', branchName], { cwd: worktreeDir });
      
      events.emit(GitEventType.BRANCH_CHECKED_OUT as any, {
        laneName,
        branchName,
      });
      
      // 3. 의존성 브랜치 머지 (있는 경우)
      if (dependencyBranches.length > 0) {
        for (const depBranch of dependencyBranches) {
          const mergeResult = await this.mergeDependencyBranch(worktreeDir, depBranch, branchName, laneName);
          if (!mergeResult.success) {
            this.log(`[${laneName}] Warning: Failed to merge dependency ${depBranch}: ${mergeResult.error}`);
            // 의존성 머지 실패는 경고만 하고 계속 진행
          }
        }
      }
      
      // 4. 상태 업데이트
      this.updateLaneState(laneName, {
        phase: GitLifecyclePhase.WORKING,
        currentBranch: branchName,
        worktreeDir,
        uncommittedChanges: false,
      });
      
      this.log(`[${laneName}] Work started on branch: ${branchName}`);
      
      return { success: true, details: { branchName, branchType } };
      
    } catch (error: any) {
      const errorMsg = `Failed to start work: ${error.message}`;
      this.updateLaneState(laneName, {
        phase: GitLifecyclePhase.ERROR,
        error: errorMsg,
      });
      
      events.emit(GitEventType.ERROR as any, {
        laneName,
        operation: 'startWork',
        error: errorMsg,
        recoverable: true,
      });
      
      return { success: false, error: errorMsg };
    }
  }
  
  /**
   * 워크트리 확인 및 생성
   */
  private async ensureWorktree(
    worktreeDir: string, 
    branchName: string, 
    baseBranch: string, 
    repoRoot: string,
    laneName: string
  ): Promise<GitOperationResult> {
    const worktreeExists = fs.existsSync(worktreeDir);
    const worktreeIsValid = worktreeExists && git.isValidWorktree(worktreeDir);
    
    if (worktreeExists && !worktreeIsValid) {
      this.log(`[${laneName}] Invalid worktree detected, cleaning up: ${worktreeDir}`);
      try {
        git.cleanupInvalidWorktreeDir(worktreeDir);
      } catch (e: any) {
        return { success: false, error: `Failed to cleanup invalid worktree: ${e.message}` };
      }
    }
    
    if (!worktreeExists || !worktreeIsValid) {
      this.log(`[${laneName}] Creating worktree: ${worktreeDir} (branch: ${branchName})`);
      
      // 부모 디렉토리 생성
      const worktreeParent = path.dirname(worktreeDir);
      if (!fs.existsSync(worktreeParent)) {
        fs.mkdirSync(worktreeParent, { recursive: true });
      }
      
      // 재시도 로직
      let retries = 3;
      let lastError: Error | null = null;
      
      while (retries > 0) {
        try {
          await git.createWorktreeAsync(worktreeDir, branchName, {
            baseBranch,
            cwd: repoRoot,
          });
          
          events.emit(GitEventType.WORKTREE_CREATED as any, {
            laneName,
            worktreeDir,
            branchName,
          });
          
          events.emit(GitEventType.BRANCH_CREATED as any, {
            laneName,
            branchName,
            baseBranch,
            worktreeDir,
          });
          
          return { success: true };
        } catch (e: any) {
          lastError = e;
          retries--;
          if (retries > 0) {
            const delay = Math.floor(Math.random() * 1000) + 500;
            this.log(`[${laneName}] Worktree creation failed, retrying in ${delay}ms... (${retries} retries left)`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }
      
      return { success: false, error: `Failed to create worktree after retries: ${lastError?.message}` };
    }
    
    // 기존 워크트리 재사용
    this.log(`[${laneName}] Reusing existing worktree: ${worktreeDir}`);
    return { success: true };
  }
  
  /**
   * 의존성 브랜치 머지
   */
  private async mergeDependencyBranch(
    worktreeDir: string,
    depBranch: string,
    currentBranch: string,
    laneName: string
  ): Promise<GitOperationResult> {
    try {
      // 원격에서 fetch
      git.runGit(['fetch', 'origin', depBranch], { cwd: worktreeDir, silent: true });
      
      const remoteBranch = `origin/${depBranch}`;
      
      // 충돌 사전 체크
      const conflictCheck = git.checkMergeConflict(remoteBranch, { cwd: worktreeDir });
      
      if (conflictCheck.willConflict) {
        events.emit(GitEventType.MERGE_CONFLICT as any, {
          laneName,
          sourceBranch: depBranch,
          targetBranch: currentBranch,
          conflictingFiles: conflictCheck.conflictingFiles,
          preCheck: true,
        });
        
        return { 
          success: false, 
          error: `Merge conflict detected: ${conflictCheck.conflictingFiles.join(', ')}` 
        };
      }
      
      // 머지 실행
      const mergeResult = git.safeMerge(remoteBranch, {
        cwd: worktreeDir,
        noFf: true,
        message: `chore: merge dependency from ${depBranch}`,
        abortOnConflict: true,
      });
      
      if (!mergeResult.success) {
        return { success: false, error: mergeResult.error || 'Merge failed' };
      }
      
      events.emit(GitEventType.DEPENDENCY_SYNCED as any, {
        laneName,
        sourceBranch: depBranch,
        targetBranch: currentBranch,
      });
      
      return { success: true };
      
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
  
  // --------------------------------------------------------------------------
  // 2. Save Progress (진행 상황 저장 - 선택적)
  // --------------------------------------------------------------------------
  
  /**
   * 진행 상황 저장 (중간 커밋)
   * 
   * 장기 작업 중 주기적으로 호출하여 진행 상황을 저장할 수 있습니다.
   */
  async saveProgress(
    worktreeDir: string,
    message: string,
    laneName: string = 'unknown'
  ): Promise<GitOperationResult> {
    try {
      // 변경사항 확인
      const status = git.runGit(['status', '--porcelain'], { cwd: worktreeDir });
      if (!status.trim()) {
        this.log(`[${laneName}] No changes to save`);
        return { success: true, filesChanged: 0 };
      }
      
      this.updateLaneState(laneName, {
        phase: GitLifecyclePhase.COMMITTING,
        lastOperation: 'saveProgress',
      });
      
      // Stage all changes
      git.runGit(['add', '-A'], { cwd: worktreeDir });
      
      // Commit
      git.runGit(['commit', '-m', message], { cwd: worktreeDir });
      
      const commitHash = git.runGit(['rev-parse', 'HEAD'], { cwd: worktreeDir }).trim();
      
      // 변경된 파일 수 계산
      const filesChangedOutput = git.runGit(
        ['diff', '--stat', 'HEAD~1', 'HEAD'], 
        { cwd: worktreeDir, silent: true }
      );
      const filesChanged = (filesChangedOutput.match(/\d+ file/g) || []).length || 1;
      
      this.updateLaneState(laneName, {
        phase: GitLifecyclePhase.WORKING,
        lastCommitHash: commitHash,
        uncommittedChanges: false,
      });
      
      events.emit(GitEventType.COMMITTED as any, {
        laneName,
        branchName: this.getLaneState(laneName)?.currentBranch || 'unknown',
        commitHash,
        message,
        filesChanged,
      });
      
      this.log(`[${laneName}] Progress saved: ${commitHash.substring(0, 7)}`);
      
      return { success: true, commitHash, filesChanged };
      
    } catch (error: any) {
      const errorMsg = `Failed to save progress: ${error.message}`;
      this.updateLaneState(laneName, {
        phase: GitLifecyclePhase.WORKING, // 복구 가능한 오류
        error: errorMsg,
      });
      
      return { success: false, error: errorMsg };
    }
  }
  
  // --------------------------------------------------------------------------
  // 3. Finalize Work (작업 종료)
  // --------------------------------------------------------------------------
  
  /**
   * 작업 종료 - 모든 변경사항 커밋 및 푸시
   * 
   * 1. 남은 변경사항 모두 스테이징
   * 2. 커밋 생성
   * 3. 원격으로 푸시
   */
  async finalizeWork(options: FinalizeWorkOptions): Promise<GitOperationResult> {
    const {
      worktreeDir,
      branchName,
      commitMessage = 'chore: finalize work',
      laneName = 'unknown',
      taskName,
      push = true,
      remote = 'origin',
      skipIfClean = false,
    } = options;
    
    try {
      // 1. 변경사항 확인
      const status = git.runGit(['status', '--porcelain'], { cwd: worktreeDir });
      const hasChanges = !!status.trim();
      
      if (!hasChanges && skipIfClean) {
        this.log(`[${laneName}] No changes to finalize, skipping`);
        return { success: true, filesChanged: 0 };
      }
      
      let commitHash: string | undefined;
      let filesChanged = 0;
      
      // 2. 변경사항이 있으면 커밋
      if (hasChanges) {
        this.updateLaneState(laneName, {
          phase: GitLifecyclePhase.COMMITTING,
          lastOperation: 'finalizeWork',
        });
        
        // Stage all changes
        git.runGit(['add', '-A'], { cwd: worktreeDir });
        
        // Commit
        const fullMessage = taskName 
          ? `${commitMessage}\n\nTask: ${taskName}`
          : commitMessage;
          
        git.runGit(['commit', '-m', fullMessage], { cwd: worktreeDir });
        
        commitHash = git.runGit(['rev-parse', 'HEAD'], { cwd: worktreeDir }).trim();
        
        // 변경된 파일 수 계산
        const filesChangedOutput = git.runGit(
          ['diff', '--stat', 'HEAD~1', 'HEAD'], 
          { cwd: worktreeDir, silent: true }
        );
        filesChanged = (filesChangedOutput.match(/\d+ file/g) || []).length || 1;
        
        events.emit(GitEventType.COMMITTED as any, {
          laneName,
          branchName,
          commitHash,
          message: commitMessage,
          filesChanged,
        });
        
        this.log(`[${laneName}] Changes committed: ${commitHash.substring(0, 7)} (${filesChanged} files)`);
      }
      
      // 3. 푸시
      if (push) {
        this.updateLaneState(laneName, {
          phase: GitLifecyclePhase.PUSHING,
        });
        
        try {
          git.push(branchName, { cwd: worktreeDir, setUpstream: true });
          
          events.emit(GitEventType.PUSHED as any, {
            laneName,
            branchName,
            remote,
            commitHash: commitHash || git.runGit(['rev-parse', 'HEAD'], { cwd: worktreeDir }).trim(),
          });
          
          this.log(`[${laneName}] Pushed to ${remote}/${branchName}`);
          
        } catch (pushError: any) {
          // 푸시 실패 처리
          events.emit(GitEventType.PUSH_REJECTED as any, {
            laneName,
            branchName,
            reason: pushError.message,
            hint: 'Try pulling remote changes first',
          });
          
          // 푸시 실패는 별도 처리 가능하도록 세부 정보 반환
          return { 
            success: false, 
            error: `Push failed: ${pushError.message}`,
            commitHash,
            filesChanged,
            details: { pushFailed: true },
          };
        }
      }
      
      // 4. 상태 업데이트
      this.updateLaneState(laneName, {
        phase: GitLifecyclePhase.IDLE,
        lastCommitHash: commitHash || this.getLaneState(laneName)?.lastCommitHash,
        uncommittedChanges: false,
        error: null,
      });
      
      return { success: true, commitHash, filesChanged };
      
    } catch (error: any) {
      const errorMsg = `Failed to finalize work: ${error.message}`;
      this.updateLaneState(laneName, {
        phase: GitLifecyclePhase.ERROR,
        error: errorMsg,
      });
      
      events.emit(GitEventType.ERROR as any, {
        laneName,
        operation: 'finalizeWork',
        error: errorMsg,
        recoverable: true,
      });
      
      return { success: false, error: errorMsg };
    }
  }
  
  // --------------------------------------------------------------------------
  // 4. Merge to Target (머지)
  // --------------------------------------------------------------------------
  
  /**
   * 타겟 브랜치로 머지
   * 
   * 사용 사례:
   * - Task → Pipeline 머지
   * - 의존성 브랜치 머지
   * - 최종 Flow 브랜치 생성
   */
  async mergeToTarget(options: MergeOptions): Promise<GitOperationResult> {
    const {
      worktreeDir,
      sourceBranch,
      targetBranch,
      commitMessage,
      laneName = 'unknown',
      mergeType = 'task_to_pipeline',
      abortOnConflict = true,
      push = true,
    } = options;
    
    this.updateLaneState(laneName, {
      phase: GitLifecyclePhase.MERGING,
      lastOperation: 'mergeToTarget',
    });
    
    try {
      // 1. 타겟 브랜치로 체크아웃
      this.log(`[${laneName}] Checking out ${targetBranch} for merge`);
      git.runGit(['checkout', targetBranch], { cwd: worktreeDir });
      
      events.emit(GitEventType.MERGE_STARTED as any, {
        laneName,
        sourceBranch,
        targetBranch,
        mergeType,
      });
      
      // 2. 충돌 사전 체크
      const conflictCheck = git.checkMergeConflict(sourceBranch, { cwd: worktreeDir });
      
      if (conflictCheck.willConflict) {
        events.emit(GitEventType.MERGE_CONFLICT as any, {
          laneName,
          sourceBranch,
          targetBranch,
          conflictingFiles: conflictCheck.conflictingFiles,
          preCheck: true,
        });
        
        if (abortOnConflict) {
          this.updateLaneState(laneName, {
            phase: GitLifecyclePhase.ERROR,
            error: `Merge conflict: ${conflictCheck.conflictingFiles.join(', ')}`,
          });
          
          return {
            success: false,
            error: `Merge conflict detected: ${conflictCheck.conflictingFiles.join(', ')}`,
            details: { conflictingFiles: conflictCheck.conflictingFiles },
          };
        }
      }
      
      // 3. 머지 실행
      const mergeMsg = commitMessage || `chore: merge ${sourceBranch} into ${targetBranch}`;
      
      const mergeResult = git.safeMerge(sourceBranch, {
        cwd: worktreeDir,
        noFf: true,
        message: mergeMsg,
        abortOnConflict,
      });
      
      if (!mergeResult.success) {
        if (mergeResult.conflict) {
          events.emit(GitEventType.MERGE_CONFLICT as any, {
            laneName,
            sourceBranch,
            targetBranch,
            conflictingFiles: mergeResult.conflictingFiles,
            preCheck: false,
          });
        }
        
        this.updateLaneState(laneName, {
          phase: GitLifecyclePhase.ERROR,
          error: mergeResult.error || 'Merge failed',
        });
        
        return {
          success: false,
          error: mergeResult.error || 'Merge failed',
          details: { conflictingFiles: mergeResult.conflictingFiles },
        };
      }
      
      const mergeCommit = git.runGit(['rev-parse', 'HEAD'], { cwd: worktreeDir }).trim();
      
      // 변경된 파일 수 계산
      const stats = git.getLastOperationStats(worktreeDir);
      const filesChangedMatch = stats?.match(/(\d+) file/);
      const filesChanged = filesChangedMatch ? parseInt(filesChangedMatch[1]!, 10) : 0;
      
      events.emit(GitEventType.MERGE_COMPLETED as any, {
        laneName,
        sourceBranch,
        targetBranch,
        mergeCommit,
        filesChanged,
      });
      
      this.log(`[${laneName}] Merged ${sourceBranch} → ${targetBranch} (${mergeCommit.substring(0, 7)})`);
      
      // 4. 푸시
      if (push) {
        this.updateLaneState(laneName, {
          phase: GitLifecyclePhase.PUSHING,
        });
        
        try {
          git.push(targetBranch, { cwd: worktreeDir, setUpstream: true });
          
          events.emit(GitEventType.PUSHED as any, {
            laneName,
            branchName: targetBranch,
            remote: 'origin',
            commitHash: mergeCommit,
          });
          
        } catch (pushError: any) {
          events.emit(GitEventType.PUSH_REJECTED as any, {
            laneName,
            branchName: targetBranch,
            reason: pushError.message,
          });
          
          return {
            success: false,
            error: `Merge succeeded but push failed: ${pushError.message}`,
            commitHash: mergeCommit,
            filesChanged,
            details: { pushFailed: true },
          };
        }
      }
      
      // 5. 상태 업데이트
      this.updateLaneState(laneName, {
        phase: GitLifecyclePhase.IDLE,
        currentBranch: targetBranch,
        lastCommitHash: mergeCommit,
        error: null,
      });
      
      return { success: true, commitHash: mergeCommit, filesChanged };
      
    } catch (error: any) {
      const errorMsg = `Failed to merge: ${error.message}`;
      this.updateLaneState(laneName, {
        phase: GitLifecyclePhase.ERROR,
        error: errorMsg,
      });
      
      events.emit(GitEventType.ERROR as any, {
        laneName,
        operation: 'mergeToTarget',
        error: errorMsg,
        recoverable: true,
      });
      
      return { success: false, error: errorMsg };
    }
  }
  
  // --------------------------------------------------------------------------
  // 5. Cleanup (정리)
  // --------------------------------------------------------------------------
  
  /**
   * 워크트리 정리
   */
  async cleanupWorktree(worktreeDir: string, laneName: string = 'unknown'): Promise<GitOperationResult> {
    try {
      if (!fs.existsSync(worktreeDir)) {
        return { success: true };
      }
      
      git.cleanupInvalidWorktreeDir(worktreeDir);
      
      events.emit(GitEventType.WORKTREE_CLEANED as any, {
        laneName,
        worktreeDir,
      });
      
      this.log(`[${laneName}] Worktree cleaned: ${worktreeDir}`);
      
      return { success: true };
      
    } catch (error: any) {
      return { success: false, error: `Failed to cleanup worktree: ${error.message}` };
    }
  }
  
  /**
   * Lane 상태 정리
   */
  cleanupLane(laneName: string): void {
    this.laneStates.delete(laneName);
    this.log(`[${laneName}] Git state cleaned up`);
  }
  
  // --------------------------------------------------------------------------
  // Utility Methods
  // --------------------------------------------------------------------------
  
  /**
   * 현재 브랜치에 미커밋 변경사항이 있는지 확인
   */
  hasUncommittedChanges(worktreeDir: string): boolean {
    try {
      const status = git.runGit(['status', '--porcelain'], { cwd: worktreeDir });
      return !!status.trim();
    } catch {
      return false;
    }
  }
  
  /**
   * 안전하게 모든 변경사항 커밋 (오류 무시)
   */
  async safeCommitAll(
    worktreeDir: string, 
    message: string,
    laneName: string = 'unknown'
  ): Promise<GitOperationResult> {
    try {
      if (!this.hasUncommittedChanges(worktreeDir)) {
        return { success: true, filesChanged: 0 };
      }
      
      git.runGit(['add', '-A'], { cwd: worktreeDir });
      git.runGit(['commit', '-m', message, '--no-verify'], { cwd: worktreeDir });
      
      const commitHash = git.runGit(['rev-parse', 'HEAD'], { cwd: worktreeDir }).trim();
      
      return { success: true, commitHash };
      
    } catch (error: any) {
      // 오류 무시하고 반환
      return { success: false, error: error.message };
    }
  }
  
  /**
   * 브랜치가 원격에 존재하는지 확인
   */
  branchExistsRemote(branchName: string, worktreeDir: string): boolean {
    try {
      git.runGit(['ls-remote', '--heads', 'origin', branchName], { cwd: worktreeDir });
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * 로깅 헬퍼
   */
  private log(message: string): void {
    if (this.verbose) {
      logger.debug(`[GitLifecycle] ${message}`, { context: 'git' });
    } else {
      logger.info(`[GitLifecycle] ${message}`, { context: 'git' });
    }
  }
  
  /**
   * 디버그 모드 설정
   */
  setVerbose(verbose: boolean): void {
    this.verbose = verbose;
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * 싱글톤 인스턴스 획득
 */
export function getGitLifecycleManager(): GitLifecycleManager {
  return GitLifecycleManager.getInstance();
}

/**
 * 인스턴스 리셋 (테스트용)
 */
export function resetGitLifecycleManager(): void {
  GitLifecycleManager.resetInstance();
}


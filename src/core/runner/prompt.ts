import * as fs from 'fs';
import * as logger from '../../utils/logger';
import { safeJoin } from '../../utils/path';
import { DependencyPolicy, RunnerConfig } from '../../types';
import { DependencyResult } from './utils';

/**
 * Dependency request file name - agent writes here when dependency changes are needed
 */
export const DEPENDENCY_REQUEST_FILE = '_cursorflow/dependency-request.json';

/**
 * Wrap prompt with dependency policy instructions (legacy, used by tests)
 */
export function wrapPromptForDependencyPolicy(prompt: string, policy: DependencyPolicy): string {
  if (policy.allowDependencyChange && !policy.lockfileReadOnly) {
    return prompt;
  }
  
  let wrapped = `### 📦 Dependency Policy\n`;
  wrapped += `- allowDependencyChange: ${policy.allowDependencyChange}\n`;
  wrapped += `- lockfileReadOnly: ${policy.lockfileReadOnly}\n\n`;
  wrapped += prompt;
  
  return wrapped;
}

/**
 * Wrap prompt with global context, dependency policy, and worktree instructions
 */
export function wrapPrompt(
  prompt: string, 
  config: RunnerConfig, 
  options: { 
    noGit?: boolean; 
    isWorktree?: boolean;
    dependencyResults?: DependencyResult[];
    worktreePath?: string;
    taskBranch?: string;
    pipelineBranch?: string;
  } = {}
): string {
  const { noGit = false, isWorktree = true, dependencyResults = [], worktreePath, taskBranch, pipelineBranch } = options;
  
  // 1. PREFIX: Environment & Worktree context
  let wrapped = `### 🛠 Environment & Context\n`;
  wrapped += `- **Workspace**: 당신은 독립된 **Git 워크트리** (프로젝트 루트)에서 작업 중입니다.\n`;
  wrapped += `- **CWD**: 현재 터미널과 작업 경로는 이미 워크트리 루트(\`${worktreePath || 'current'}\`)로 설정되어 있습니다.\n`;
  
  if (taskBranch && !noGit) {
    wrapped += `- **Current Branch**: \`${taskBranch}\` (현재 작업 중인 브랜치)\n`;
    wrapped += `- **Branch Check**: 만약 브랜치가 다르다면 \`git checkout ${taskBranch}\`를 실행하세요.\n`;
  }
  if (pipelineBranch && !noGit) {
    wrapped += `- **Base Branch**: \`${pipelineBranch}\` (이 작업의 기준이 되는 상위 브랜치)\n`;
  }

  if (worktreePath) {
    wrapped += `- **Worktree Path**: \`${worktreePath}\`\n`;
    wrapped += `- **CRITICAL**: 터미널 명령어 실행 시 반드시 워크트리 루트 내에서 실행되고 있는지 확인하세요.\n`;
  }
  
  wrapped += `- **Path Rule**: 모든 파일 참조는 워크트리 루트 기준입니다.\n`;
  
  if (isWorktree) {
    wrapped += `- **File Availability**: Git 추적 파일만 존재합니다. (node_modules, .env 등은 기본적으로 없음)\n`;
    
    // Add environment file copy instructions
    if (worktreePath) {
      // Extract main repo path from worktree path (remove _cursorflow/worktrees/xxx part)
      const mainRepoPath = worktreePath.replace(/\/_cursorflow\/worktrees\/[^/]+$/, '');
      wrapped += `\n### 🔐 Environment Files Setup\n`;
      wrapped += `워크트리에 환경변수 파일이 없다면, 메인 레포에서 복사하세요:\n`;
      wrapped += `\`\`\`bash\n`;
      wrapped += `# 메인 레포 경로: ${mainRepoPath}\n`;
      wrapped += `예시 커맨드: [ ! -f .env ] && [ -f "${mainRepoPath}/.env" ] && cp "${mainRepoPath}/.env" .env\n`;
      wrapped += `예시 커맨드: [ ! -f .env.local ] && [ -f "${mainRepoPath}/.env.local" ] && cp "${mainRepoPath}/.env.local" .env.local\n`;
      wrapped += `\`\`\`\n`;
      wrapped += `⚠️ 이 작업은 **터미널 명령어 실행 전** 반드시 확인하세요!\n`;
    }
  }

  // 2. Dependency Task Results (if available)
  if (dependencyResults.length > 0) {
    wrapped += `\n### 📋 의존 태스크 결과\n`;
    wrapped += `이 태스크가 의존하는 이전 태스크들의 작업 결과입니다.\n\n`;
    
    for (const dep of dependencyResults) {
      wrapped += `#### ${dep.taskId}\n`;
      wrapped += `${dep.resultText}\n\n`;
    }
    wrapped += `---\n`;
  }
  
  // 3. Dependency Policy (Integrated)
  const policy = config.dependencyPolicy;
  wrapped += `\n### 📦 Dependency Policy\n`;
  wrapped += `- allowDependencyChange: ${policy.allowDependencyChange}\n`;
  wrapped += `- lockfileReadOnly: ${policy.lockfileReadOnly}\n`;
  
  if (noGit) {
    wrapped += `- NO_GIT_MODE: Git 명령어를 사용하지 마세요. 파일 수정만 가능합니다.\n`;
  }

  wrapped += `\n**📦 Dependency Change Rules:**\n`;
  wrapped += `1. 코드를 수정하기 전, 의존성 변경이 필요한지 **먼저** 판단하세요.\n`;
  wrapped += `2. 의존성 변경이 필요하다면:\n`;
  wrapped += `   - **다른 파일을 절대 수정하지 마세요.**\n`;
  wrapped += `   - 아래 JSON을 \`./${DEPENDENCY_REQUEST_FILE}\` 파일에 저장하세요:\n`;
  wrapped += `     \`\`\`json\n`;
  wrapped += `     {\n`;
  wrapped += `       "reason": "왜 이 의존성이 필요한지 설명",\n`;
  wrapped += `       "changes": ["add lodash@^4.17.21", "remove unused-pkg"],\n`;
  wrapped += `       "commands": ["pnpm add lodash@^4.17.21", "pnpm remove unused-pkg"],\n`;
  wrapped += `       "notes": "추가 참고사항 (선택)"  \n`;
  wrapped += `     }\n`;
  wrapped += `     \`\`\`\n`;
  wrapped += `   - 파일 저장 후 **즉시 작업을 종료**하세요. 오케스트레이터가 처리합니다.\n`;
  wrapped += `3. 의존성 변경이 불필요하면 바로 본 작업을 진행하세요.\n`;

  wrapped += `\n---\n\n${prompt}\n\n---\n`;

  // 4. SUFFIX: Task Completion & Git Requirements
  wrapped += `\n### 📝 Task Completion Requirements\n`;
  wrapped += `**반드시 다음 순서로 작업을 마무리하세요 (매우 중요):**\n\n`;
  
  if (!noGit) {
    wrapped += `1. **변경 사항 확인**: \`git status\`와 \`git diff\`로 수정된 내용을 최종 확인하세요.\n`;
    wrapped += `2. **Git Commit & Push** (필수!):\n`;
    wrapped += `   \`\`\`bash\n`;
    wrapped += `   git add -A\n`;
    wrapped += `   git commit -m "feat: <작업 내용 요약>"\n`;
    wrapped += `   git push origin HEAD\n`;
    wrapped += `   \`\`\`\n`;
    wrapped += `   ⚠️ **주의**: 커밋과 푸시를 생략하면 오케스트레이터가 변경 사항을 인식하지 못하며 작업이 손실됩니다.\n\n`;
  }
  
  wrapped += `3. **최종 요약**: 작업 완료 후 아래 형식을 포함하여 요약해 주세요:\n`;
  wrapped += `   - **수정된 파일**: [파일명1, 파일명2, ...]\n`;
  wrapped += `   - **작업 결과**: [핵심 변경 사항 요약]\n`;
  wrapped += `   - **커밋 정보**: [git log --oneline -1 결과]\n\n`;
  wrapped += `4. 지시된 문서(docs/...)를 찾을 수 없거나 예기치 못한 오류가 발생하면 즉시 보고하세요.\n`;

  return wrapped;
}

/**
 * Apply file permissions based on dependency policy
 */
export function applyDependencyFilePermissions(worktreeDir: string, policy: DependencyPolicy): void {
  const targets: string[] = [];
  
  if (!policy.allowDependencyChange) {
    targets.push('package.json');
  }
  
  if (policy.lockfileReadOnly) {
    targets.push('pnpm-lock.yaml', 'package-lock.json', 'yarn.lock');
  }
  
  for (const file of targets) {
    const filePath = safeJoin(worktreeDir, file);
    if (!fs.existsSync(filePath)) continue;
    
    try {
      const stats = fs.statSync(filePath);
      const mode = stats.mode & 0o777;
      fs.chmodSync(filePath, mode & ~0o222); // Remove write bits
    } catch {
      // Best effort
    }
  }
}


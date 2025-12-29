/**
 * CursorFlow Hook System - Data Accessor Implementation
 * 
 * Hook에서 Git, 대화 기록, 로그 등의 데이터에 접근하기 위한 구현체입니다.
 * 모든 메서드는 Lazy Loading으로 필요할 때만 데이터를 로드합니다.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as git from '../utils/git';
import { safeJoin } from '../utils/path';
import {
  HookDataAccessor,
  ChangedFile,
  Commit,
  Message,
  TaskResult,
  TaskDefinition,
  ToolCall,
  ErrorLog,
  DependencyResult,
} from './types';

// ============================================================================
// Data Accessor Options
// ============================================================================

export interface DataAccessorOptions {
  /** Worktree 디렉토리 */
  worktreeDir: string;
  /** Run 디렉토리 (로그 파일 위치) */
  runDir: string;
  /** 현재 태스크 브랜치 */
  taskBranch: string;
  /** 파이프라인 브랜치 */
  pipelineBranch: string;
  /** Lane 이름 */
  laneName: string;
  /** 현재 태스크 이름 */
  taskName: string;
  /** 완료된 태스크 목록 */
  completedTasks: TaskResult[];
  /** 남은 태스크 목록 */
  pendingTasks: TaskDefinition[];
  /** 의존성 결과 */
  dependencyResults: DependencyResult[];
  /** 태스크 시작 시간 */
  taskStartTime: number;
  /** Lane 시작 시간 */
  laneStartTime: number;
  /** Run Root (lanes 디렉토리의 부모) */
  runRoot?: string;
}

// ============================================================================
// Data Accessor Implementation
// ============================================================================

/**
 * HookDataAccessor 구현체
 */
export class HookDataAccessorImpl implements HookDataAccessor {
  private options: DataAccessorOptions;
  
  // 캐시
  private cachedChangedFiles: ChangedFile[] | null = null;
  private cachedDiff: string | null = null;
  private cachedMessages: Message[] | null = null;
  private cachedToolCalls: ToolCall[] | null = null;
  private cachedRawOutput: string | null = null;
  
  constructor(options: DataAccessorOptions) {
    this.options = options;
  }
  
  // ==========================================================================
  // Git Data Access
  // ==========================================================================
  
  git = {
    getChangedFiles: async (): Promise<ChangedFile[]> => {
      if (this.cachedChangedFiles) {
        return this.cachedChangedFiles;
      }
      
      try {
        const { worktreeDir, pipelineBranch, taskBranch } = this.options;
        
        // Get diff stat between pipeline and task branch
        const diffStat = git.runGit(
          ['diff', '--numstat', pipelineBranch, taskBranch],
          { cwd: worktreeDir, silent: true }
        );
        
        const files: ChangedFile[] = [];
        
        if (diffStat) {
          const lines = diffStat.trim().split('\n').filter(l => l);
          
          for (const line of lines) {
            const [additions, deletions, filePath] = line.split('\t');
            if (!filePath) continue;
            
            // Get file status
            let status: ChangedFile['status'] = 'modified';
            try {
              const statusOutput = git.runGit(
                ['diff', '--name-status', pipelineBranch, taskBranch, '--', filePath],
                { cwd: worktreeDir, silent: true }
              );
              if (statusOutput) {
                const statusChar = statusOutput.charAt(0);
                if (statusChar === 'A') status = 'added';
                else if (statusChar === 'D') status = 'deleted';
                else if (statusChar === 'R') status = 'renamed';
              }
            } catch {
              // Ignore status detection errors
            }
            
            files.push({
              path: filePath,
              status,
              additions: additions === '-' ? 0 : parseInt(additions, 10) || 0,
              deletions: deletions === '-' ? 0 : parseInt(deletions, 10) || 0,
            });
          }
        }
        
        this.cachedChangedFiles = files;
        return files;
      } catch (error) {
        console.error('Failed to get changed files:', error);
        return [];
      }
    },
    
    getDiff: async (): Promise<string> => {
      if (this.cachedDiff !== null) {
        return this.cachedDiff;
      }
      
      try {
        const { worktreeDir, pipelineBranch, taskBranch } = this.options;
        
        const diff = git.runGit(
          ['diff', pipelineBranch, taskBranch],
          { cwd: worktreeDir, silent: true }
        );
        
        this.cachedDiff = diff || '';
        return this.cachedDiff;
      } catch (error) {
        console.error('Failed to get diff:', error);
        return '';
      }
    },
    
    getRecentCommits: async (count: number = 10): Promise<Commit[]> => {
      try {
        const { worktreeDir } = this.options;
        
        // Get commit log with format
        const logOutput = git.runGit(
          ['log', `-${count}`, '--pretty=format:%H|%s|%an|%aI', '--name-only'],
          { cwd: worktreeDir, silent: true }
        );
        
        if (!logOutput) return [];
        
        const commits: Commit[] = [];
        const entries = logOutput.split('\n\n').filter(e => e.trim());
        
        for (const entry of entries) {
          const lines = entry.trim().split('\n');
          if (lines.length === 0) continue;
          
          const [firstLine, ...fileLines] = lines;
          const [hash, message, author, date] = firstLine.split('|');
          
          if (hash && message && author && date) {
            commits.push({
              hash,
              message,
              author,
              date,
              files: fileLines.filter(f => f.trim()),
            });
          }
        }
        
        return commits;
      } catch (error) {
        console.error('Failed to get recent commits:', error);
        return [];
      }
    },
    
    getCurrentBranch: (): string => {
      return this.options.taskBranch;
    },
    
    getConflictFiles: async (): Promise<string[]> => {
      try {
        const { worktreeDir } = this.options;
        
        // Check for merge conflicts
        const statusOutput = git.runGit(
          ['status', '--porcelain'],
          { cwd: worktreeDir, silent: true }
        );
        
        if (!statusOutput) return [];
        
        const conflictFiles: string[] = [];
        const lines = statusOutput.split('\n');
        
        for (const line of lines) {
          // UU = both modified (conflict)
          // AA = both added (conflict)
          if (line.startsWith('UU ') || line.startsWith('AA ')) {
            conflictFiles.push(line.substring(3).trim());
          }
        }
        
        return conflictFiles;
      } catch (error) {
        console.error('Failed to get conflict files:', error);
        return [];
      }
    },
  };
  
  // ==========================================================================
  // Conversation Data Access
  // ==========================================================================
  
  conversation = {
    getCurrentTaskMessages: async (): Promise<Message[]> => {
      const allMessages = await this.conversation.getAllMessages();
      return allMessages.filter(m => m.taskName === this.options.taskName);
    },
    
    getAllMessages: async (): Promise<Message[]> => {
      if (this.cachedMessages) {
        return this.cachedMessages;
      }
      
      try {
        const convoPath = safeJoin(this.options.runDir, 'conversation.jsonl');
        
        if (!fs.existsSync(convoPath)) {
          return [];
        }
        
        const content = fs.readFileSync(convoPath, 'utf8');
        const lines = content.split('\n').filter(l => l.trim());
        
        const messages: Message[] = [];
        
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            messages.push({
              role: entry.role || 'user',
              content: entry.content || '',
              timestamp: entry.timestamp || new Date().toISOString(),
              taskName: entry.task || entry.taskName,
              metadata: entry.metadata,
            });
          } catch {
            // Skip invalid JSON lines
          }
        }
        
        this.cachedMessages = messages;
        return messages;
      } catch (error) {
        console.error('Failed to get messages:', error);
        return [];
      }
    },
    
    getRecentMessages: async (count: number = 10): Promise<Message[]> => {
      const allMessages = await this.conversation.getAllMessages();
      return allMessages.slice(-count);
    },
    
    getLastResponse: async (): Promise<string | null> => {
      const allMessages = await this.conversation.getAllMessages();
      
      // Find last assistant message
      for (let i = allMessages.length - 1; i >= 0; i--) {
        if (allMessages[i].role === 'assistant') {
          return allMessages[i].content;
        }
      }
      
      return null;
    },
  };
  
  // ==========================================================================
  // Tasks Data Access
  // ==========================================================================
  
  tasks = {
    getCompletedTasks: (): TaskResult[] => {
      return this.options.completedTasks;
    },
    
    getPendingTasks: (): TaskDefinition[] => {
      return this.options.pendingTasks;
    },
    
    getTaskResult: (taskName: string): TaskResult | null => {
      return this.options.completedTasks.find(t => t.name === taskName) || null;
    },
    
    getDependencyResults: (): DependencyResult[] => {
      return this.options.dependencyResults;
    },
  };
  
  // ==========================================================================
  // Logs Data Access
  // ==========================================================================
  
  logs = {
    getRawOutput: async (): Promise<string> => {
      if (this.cachedRawOutput !== null) {
        return this.cachedRawOutput;
      }
      
      try {
        // Try multiple possible log file locations, preferring terminal.jsonl
        const possiblePaths = [
          safeJoin(this.options.runDir, 'terminal.jsonl'),
          safeJoin(this.options.runDir, 'terminal.log'),
          safeJoin(this.options.runDir, 'agent-output.log'),
        ];
        
        for (const logPath of possiblePaths) {
          if (fs.existsSync(logPath)) {
            const content = fs.readFileSync(logPath, 'utf8');
            this.cachedRawOutput = content;
            return content;
          }
        }
        
        return '';
      } catch (error) {
        console.error('Failed to get raw output:', error);
        return '';
      }
    },
    
    getToolCalls: async (): Promise<ToolCall[]> => {
      if (this.cachedToolCalls) {
        return this.cachedToolCalls;
      }
      
      try {
        const rawOutput = await this.logs.getRawOutput();
        const toolCalls: ToolCall[] = [];
        
        // Parse tool calls from JSONL output
        const lines = rawOutput.split('\n');
        
        for (const line of lines) {
          if (!line.trim().startsWith('{')) continue;
          
          try {
            const parsed = JSON.parse(line);
            
            // Check for tool_call type messages
            if (parsed.type === 'tool_call' || parsed.tool_calls) {
              const calls = parsed.tool_calls || [parsed];
              
              for (const call of calls) {
                if (call.name || call.function?.name) {
                  toolCalls.push({
                    name: call.name || call.function?.name,
                    parameters: call.parameters || call.function?.arguments || {},
                    result: call.result,
                    timestamp: parsed.timestamp || new Date().toISOString(),
                  });
                }
              }
            }
          } catch {
            // Skip non-JSON lines
          }
        }
        
        this.cachedToolCalls = toolCalls;
        return toolCalls;
      } catch (error) {
        console.error('Failed to get tool calls:', error);
        return [];
      }
    },
    
    getErrors: async (): Promise<ErrorLog[]> => {
      try {
        const rawOutput = await this.logs.getRawOutput();
        const errors: ErrorLog[] = [];
        
        const lines = rawOutput.split('\n');
        
        for (const line of lines) {
          // Check for error patterns
          const lowerLine = line.toLowerCase();
          
          if (lowerLine.includes('error') || lowerLine.includes('exception') || lowerLine.includes('failed')) {
            errors.push({
              level: 'error',
              message: line.trim(),
              timestamp: new Date().toISOString(),
            });
          } else if (lowerLine.includes('warning') || lowerLine.includes('warn')) {
            errors.push({
              level: 'warn',
              message: line.trim(),
              timestamp: new Date().toISOString(),
            });
          }
        }
        
        return errors;
      } catch (error) {
        console.error('Failed to get errors:', error);
        return [];
      }
    },
  };
  
  // ==========================================================================
  // Timing Data Access
  // ==========================================================================
  
  get timing() {
    const options = this.options;
    return {
      taskStartTime: options.taskStartTime,
      laneStartTime: options.laneStartTime,
      
      getElapsedTime: (): number => {
        return Date.now() - options.taskStartTime;
      },
    };
  }
  
  // ==========================================================================
  // Cache Management
  // ==========================================================================
  
  /**
   * 캐시 초기화
   */
  clearCache(): void {
    this.cachedChangedFiles = null;
    this.cachedDiff = null;
    this.cachedMessages = null;
    this.cachedToolCalls = null;
    this.cachedRawOutput = null;
  }
  
  /**
   * 옵션 업데이트 (태스크 변경 시)
   */
  updateOptions(updates: Partial<DataAccessorOptions>): void {
    this.options = { ...this.options, ...updates };
    this.clearCache();
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * HookDataAccessor 인스턴스 생성
 */
export function createDataAccessor(options: DataAccessorOptions): HookDataAccessor {
  return new HookDataAccessorImpl(options);
}


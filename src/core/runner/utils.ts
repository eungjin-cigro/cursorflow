import * as fs from 'fs';
import * as path from 'path';
import * as logger from '../../utils/logger';
import { safeJoin } from '../../utils/path';
import { DependencyRequestPlan } from '../../types';
import { DEPENDENCY_REQUEST_FILE } from './prompt';

/**
 * Task result directory name - stores task completion results
 */
export const TASK_RESULTS_DIR = 'task-results';

/**
 * Dependency result interface
 */
export interface DependencyResult {
  taskId: string
  resultText: string;  // Last response text
}

/**
 * Save task result (last response text) to file
 * Stored in runDir/task-results/{NN}-{taskName}.txt
 */
export function saveTaskResult(runDir: string, taskIndex: number, taskName: string, resultText: string): void {
  const resultsDir = safeJoin(runDir, TASK_RESULTS_DIR);
  try {
    fs.mkdirSync(resultsDir, { recursive: true });
    const paddedIndex = String(taskIndex + 1).padStart(2, '0');
    const resultPath = safeJoin(resultsDir, `${paddedIndex}-${taskName}.txt`);
    fs.writeFileSync(resultPath, resultText, 'utf8');
    logger.info(`📝 Task result saved: ${resultPath}`);
  } catch (e) {
    logger.warn(`Failed to save task result: ${e}`);
  }
}

/**
 * Find task result file by task name (handles NN-taskName.txt format)
 */
export function findTaskResultFile(resultsDir: string, taskName: string): string | null {
  if (!fs.existsSync(resultsDir)) {
    return null;
  }
  
  try {
    const files = fs.readdirSync(resultsDir);
    // Match pattern: NN-taskName.txt (e.g., 01-setup.txt, 02-implement.txt)
    const pattern = new RegExp(`^\\d+-${taskName}\\.txt$`);
    const matchedFile = files.find(f => pattern.test(f));
    
    if (matchedFile) {
      return safeJoin(resultsDir, matchedFile);
    }
  } catch (e) {
    logger.warn(`Failed to scan task results directory: ${e}`);
  }
  
  return null;
}

/**
 * Load dependency results based on dependsOn list
 * Reads from runRoot/lanes/{laneName}/task-results/{NN}-{taskName}.txt
 */
export function loadDependencyResults(dependsOn: string[], runRoot: string): DependencyResult[] {
  const results: DependencyResult[] = [];
  
  for (const dep of dependsOn) {
    const parts = dep.split(':');
    if (parts.length !== 2) {
      logger.warn(`Invalid dependency format: ${dep} (expected "lane:task")`);
      results.push({ taskId: dep, resultText: '(잘못된 의존성 형식)' });
      continue;
    }
    
    const [laneName, taskName] = parts;
    const resultsDir = safeJoin(runRoot, 'lanes', laneName!, TASK_RESULTS_DIR);
    const resultPath = findTaskResultFile(resultsDir, taskName!);
    
    if (resultPath && fs.existsSync(resultPath)) {
      try {
        const text = fs.readFileSync(resultPath, 'utf8');
        results.push({ taskId: dep, resultText: text });
        logger.info(`📖 Loaded dependency result: ${dep}`);
      } catch (e) {
        logger.warn(`Failed to read dependency result ${dep}: ${e}`);
        results.push({ taskId: dep, resultText: '(읽기 실패)' });
      }
    } else {
      logger.warn(`Dependency result not found for: ${dep}`);
      results.push({ taskId: dep, resultText: '(결과 없음)' });
    }
  }
  
  return results;
}

/**
 * Read dependency request from file if it exists
 */
export function readDependencyRequestFile(worktreeDir: string): { required: boolean; plan?: DependencyRequestPlan } {
  const filePath = safeJoin(worktreeDir, DEPENDENCY_REQUEST_FILE);
  
  if (!fs.existsSync(filePath)) {
    return { required: false };
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const plan = JSON.parse(content) as DependencyRequestPlan;
    
    // Validate required fields
    if (plan.reason && Array.isArray(plan.commands) && plan.commands.length > 0) {
      logger.info(`📦 Dependency request file detected: ${filePath}`);
      return { required: true, plan };
    }
    
    logger.warn(`Invalid dependency request file format: ${filePath}`);
    return { required: false };
  } catch (e) {
    logger.warn(`Failed to parse dependency request file: ${e}`);
    return { required: false };
  }
}

/**
 * Clear dependency request file after processing
 */
export function clearDependencyRequestFile(worktreeDir: string): void {
  const filePath = safeJoin(worktreeDir, DEPENDENCY_REQUEST_FILE);
  
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      logger.info(`🗑️ Cleared dependency request file: ${filePath}`);
    } catch (e) {
      logger.warn(`Failed to clear dependency request file: ${e}`);
    }
  }
}


/**
 * TaskService - Manages CursorFlow task directories and validation
 * 
 * Provides:
 * - List prepared task directories
 * - Get task details (lanes, dependencies)
 * - Validate tasks (doctor integration)
 * - Check run eligibility
 */

import * as fs from 'fs';
import * as path from 'path';
import { TaskDirInfo, LaneFileInfo, ValidationStatus, Task } from './types';

// Re-export types for consumers
export { TaskDirInfo, LaneFileInfo, ValidationStatus } from './types';
import * as logger from './logger';

export interface ValidationResult {
  /** Combined errors + warnings for backwards compatibility */
  issues: string[];
  status: ValidationStatus;
  errors: string[];
  warnings: string[];
  lastValidated: number;
}

// Cache for validation results
const validationCache = new Map<string, ValidationResult>();

export class TaskService {
  private tasksDir: string;

  constructor(tasksDir: string) {
    this.tasksDir = tasksDir;
  }

  /**
   * List all prepared task directories
   */
  listTaskDirs(): TaskDirInfo[] {
    if (!fs.existsSync(this.tasksDir)) {
      return [];
    }

    const dirs = fs.readdirSync(this.tasksDir)
      .filter(name => {
        const dirPath = path.join(this.tasksDir, name);
        return fs.statSync(dirPath).isDirectory() && !name.startsWith('.');
      })
      .sort((a, b) => b.localeCompare(a)); // Most recent first (assuming timestamp prefix)

    return dirs.map(name => this.getTaskDirInfo(name)).filter((t): t is TaskDirInfo => t !== null);
  }

  /**
   * Get detailed information about a task directory
   */
  getTaskDirInfo(taskName: string): TaskDirInfo | null {
    const taskPath = path.join(this.tasksDir, taskName);
    
    if (!fs.existsSync(taskPath)) {
      return null;
    }

    try {
      const stat = fs.statSync(taskPath);
      const timestamp = this.parseTimestampFromName(taskName) || stat.mtime;
      const featureName = this.extractFeatureName(taskName);
      const lanes = this.scanLaneFiles(taskPath);
      
      // Get cached validation status
      const cached = validationCache.get(taskName);
      const validationStatus = cached?.status || 'unknown';
      const lastValidated = cached?.lastValidated;

      return {
        name: taskName,
        path: taskPath,
        timestamp,
        featureName,
        lanes,
        validationStatus,
        lastValidated,
      };
    } catch (error) {
      logger.debug(`Failed to read task dir ${taskName}: ${error}`);
      return null;
    }
  }

  /**
   * Scan lane files in a task directory
   */
  private scanLaneFiles(taskPath: string): LaneFileInfo[] {
    const files = fs.readdirSync(taskPath)
      .filter(name => name.endsWith('.json'))
      .sort();

    const lanes: LaneFileInfo[] = [];

    for (const fileName of files) {
      try {
        const filePath = path.join(taskPath, fileName);
        const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        
        const laneName = this.extractLaneName(fileName);
        const tasks = content.tasks || [];
        const preset = this.detectPreset(tasks);
        const taskFlow = this.generateTaskFlow(tasks);

        lanes.push({
          fileName,
          laneName,
          preset,
          taskCount: tasks.length,
          taskFlow,
        });
      } catch (error) {
        logger.debug(`Failed to parse lane file ${fileName}: ${error}`);
      }
    }

    return lanes;
  }

  /**
   * Extract lane name from filename (e.g., "01-lane-1.json" -> "lane-1")
   */
  private extractLaneName(fileName: string): string {
    const baseName = fileName.replace('.json', '');
    // Remove numeric prefix if present (e.g., "01-lane-1" -> "lane-1")
    const match = baseName.match(/^\d+-(.+)$/);
    return match ? match[1] : baseName;
  }

  /**
   * Parse timestamp from task name (format: YYMMDDHHMM_FeatureName)
   */
  private parseTimestampFromName(taskName: string): Date | null {
    const match = taskName.match(/^(\d{10})_/);
    if (!match) return null;

    const ts = match[1];
    const year = 2000 + parseInt(ts.substring(0, 2), 10);
    const month = parseInt(ts.substring(2, 4), 10) - 1;
    const day = parseInt(ts.substring(4, 6), 10);
    const hour = parseInt(ts.substring(6, 8), 10);
    const minute = parseInt(ts.substring(8, 10), 10);

    return new Date(year, month, day, hour, minute);
  }

  /**
   * Extract feature name from task directory name
   */
  private extractFeatureName(taskName: string): string {
    const parts = taskName.split('_');
    if (parts.length >= 2) {
      return parts.slice(1).join('_');
    }
    return taskName;
  }

  /**
   * Detect task preset based on task structure
   */
  private detectPreset(tasks: Task[]): string {
    if (tasks.length === 0) return 'empty';
    
    const taskNames = tasks.map(t => t.name.toLowerCase());
    
    if (taskNames.includes('plan') && taskNames.includes('implement') && taskNames.includes('test')) {
      return 'complex';
    }
    if (taskNames.includes('implement') && taskNames.includes('test') && !taskNames.includes('plan')) {
      return 'simple';
    }
    if (taskNames.includes('merge')) {
      return 'merge';
    }
    
    return 'custom';
  }

  /**
   * Generate task flow string (e.g., "plan → implement → test")
   */
  private generateTaskFlow(tasks: Task[]): string {
    if (tasks.length === 0) return '';
    return tasks.map(t => t.name).join(' → ');
  }

  /**
   * Validate a task directory
   */
  validateTaskDir(taskName: string): ValidationResult {
    const taskInfo = this.getTaskDirInfo(taskName);
    
    if (!taskInfo) {
      return {
        status: 'errors',
        errors: [`Task directory not found: ${taskName}`],
        warnings: [],
        issues: [`Task directory not found: ${taskName}`],
        lastValidated: Date.now(),
      };
    }

    const errors: string[] = [];
    const warnings: string[] = [];

    // Check if there are any lane files
    if (taskInfo.lanes.length === 0) {
      errors.push('No lane files found in task directory');
    }

    // Validate each lane file
    for (const lane of taskInfo.lanes) {
      // Check task count
      if (lane.taskCount === 0) {
        errors.push(`Lane ${lane.fileName} has no tasks defined`);
      }

      // Validate lane file structure
      try {
        const filePath = path.join(taskInfo.path, lane.fileName);
        const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        
        // Check tasks array
        if (!Array.isArray(content.tasks)) {
          errors.push(`Lane ${lane.fileName}: 'tasks' must be an array`);
        } else {
          // Validate each task
          for (let i = 0; i < content.tasks.length; i++) {
            const task = content.tasks[i];
            if (!task.name) {
              errors.push(`Lane ${lane.fileName}: Task ${i + 1} missing 'name'`);
            }
            if (!task.prompt) {
              errors.push(`Lane ${lane.fileName}: Task ${i + 1} missing 'prompt'`);
            }
          }
        }
      } catch (error) {
        errors.push(`Lane ${lane.fileName}: Invalid JSON - ${error}`);
      }
    }

    // Check for circular task-level dependencies
    const circularDeps = this.detectTaskCircularDependencies(taskInfo);
    if (circularDeps.length > 0) {
      errors.push(`Circular task dependencies detected: ${circularDeps.join(' -> ')}`);
    }

    // Determine overall status
    let status: ValidationStatus = 'valid';
    if (errors.length > 0) {
      status = 'errors';
    } else if (warnings.length > 0) {
      status = 'warnings';
    }

    const issues = [...errors, ...warnings];
    const result: ValidationResult = {
      issues,
      status,
      errors,
      warnings,
      lastValidated: Date.now(),
    };

    // Cache the result
    validationCache.set(taskName, result);

    return result;
  }

  /**
   * Detect circular dependencies in task-level dependency graph
   */
  private detectTaskCircularDependencies(taskInfo: TaskDirInfo): string[] {
    // Build task graph from all lane files
    const taskGraph = new Map<string, string[]>(); // taskId -> dependencies
    
    for (const lane of taskInfo.lanes) {
      try {
        const filePath = path.join(taskInfo.path, lane.fileName);
        const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        // Use the extracted laneName which already handles numeric prefix removal
        const laneName = lane.laneName;
        
        if (Array.isArray(content.tasks)) {
          for (const task of content.tasks) {
            const taskId = `${laneName}:${task.name}`;
            const deps = task.dependsOn || [];
            taskGraph.set(taskId, deps);
          }
        }
      } catch {
        // Skip invalid files
      }
    }
    
    // DFS to detect cycles
    const visited = new Set<string>();
    const stack = new Set<string>();
    const cycle: string[] = [];
    
    const dfs = (taskId: string): boolean => {
      if (stack.has(taskId)) {
        cycle.push(taskId);
        return true;
      }
      if (visited.has(taskId)) {
        return false;
      }
      
      visited.add(taskId);
      stack.add(taskId);
      
      const deps = taskGraph.get(taskId) || [];
      for (const dep of deps) {
        if (dfs(dep)) {
          cycle.unshift(taskId);
          return true;
        }
      }
      
      stack.delete(taskId);
      return false;
    };
    
    for (const taskId of taskGraph.keys()) {
      if (dfs(taskId)) {
        break;
      }
    }
    
    return cycle;
  }

  /**
   * Get cached validation status
   */
  getValidationStatus(taskName: string): ValidationStatus {
    const cached = validationCache.get(taskName);
    return cached?.status || 'unknown';
  }

  /**
   * Check if a task can be run
   */
  canRun(taskName: string): { ok: boolean; issues: string[] } {
    const validation = this.validateTaskDir(taskName);
    
    if (validation.status === 'errors') {
      return { ok: false, issues: validation.errors };
    }

    return { ok: true, issues: validation.warnings };
  }

  /**
   * Clear validation cache
   */
  clearCache(): void {
    validationCache.clear();
  }
}

/**
 * Create a TaskService instance with default paths
 */
export function createTaskService(projectRoot?: string): TaskService {
  const root = projectRoot || process.cwd();
  const tasksDir = path.join(root, '_cursorflow', 'tasks');
  return new TaskService(tasksDir);
}

import * as fs from 'fs';
import * as path from 'path';
import { safeJoin } from './path';
import { runDoctor, DoctorReport } from './doctor';

export type ValidationStatus = 'valid' | 'warnings' | 'errors' | 'unknown';

export interface LaneFileInfo {
  fileName: string;              // 01-lane-1.json
  laneName: string;              // lane-1
  preset: string;                // complex | simple | merge | custom
  taskCount: number;
  taskFlow: string;              // "plan → implement → test"
  dependsOn: string[];
}

export interface TaskDirInfo {
  name: string;                  // 2412221530_AuthSystem
  path: string;
  timestamp: Date;
  featureName: string;           // AuthSystem
  lanes: LaneFileInfo[];
  validationStatus: ValidationStatus;
  validationReport?: DoctorReport;
  lastValidated?: number;
}

export class TaskService {
  private tasksDir: string;
  private validationCache: Map<string, { report: DoctorReport; time: number }> = new Map();
  private CACHE_TTL = 5 * 60 * 1000;  // 5 minutes

  constructor(tasksDir: string) {
    this.tasksDir = tasksDir;
  }

  /**
   * List all task directories in _cursorflow/tasks/
   */
  listTaskDirs(): TaskDirInfo[] {
    if (!fs.existsSync(this.tasksDir)) return [];
    
    const dirs = fs.readdirSync(this.tasksDir)
      .filter(d => {
        const fullPath = safeJoin(this.tasksDir, d);
        if (!fs.statSync(fullPath).isDirectory() || d === 'example') return false;

        // Robust check: must match YYMMDDHHMM_ prefix OR contain at least one .json file
        const hasTimestamp = /^\d{10}_/.test(d);
        const hasJsonFiles = fs.readdirSync(fullPath).some(f => f.endsWith('.json'));
        
        return hasTimestamp || hasJsonFiles;
      })
      .map(name => this.getTaskDirInfo(name))
      .filter((t): t is TaskDirInfo => t !== null)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());  // Newest first
    
    return dirs;
  }

  /**
   * Get detailed information for a single task directory
   */
  getTaskDirInfo(taskName: string): TaskDirInfo | null {
    const taskPath = safeJoin(this.tasksDir, taskName);
    if (!fs.existsSync(taskPath)) return null;
    
    // Extract timestamp and feature name from name (YYMMDDHHMM_FeatureName)
    const match = taskName.match(/^(\d{10})_(.+)$/);
    let timestamp: Date;
    let featureName: string;
    
    if (match) {
      const [, ts, name] = match;
      // Parse YYMMDDHHMM
      const year = 2000 + parseInt(ts!.substring(0, 2));
      const month = parseInt(ts!.substring(2, 4)) - 1;
      const day = parseInt(ts!.substring(4, 6));
      const hour = parseInt(ts!.substring(6, 8));
      const min = parseInt(ts!.substring(8, 10));
      timestamp = new Date(year, month, day, hour, min);
      featureName = name!;
    } else {
      timestamp = fs.statSync(taskPath).mtime;
      featureName = taskName;
    }
    
    // Parse lane files
    const lanes = this.parseLaneFiles(taskPath);
    
    // Check cached validation results
    const cached = this.validationCache.get(taskName);
    let validationStatus: ValidationStatus = 'unknown';
    let validationReport: DoctorReport | undefined;
    let lastValidated: number | undefined;
    
    if (cached && Date.now() - cached.time < this.CACHE_TTL) {
      validationReport = cached.report;
      lastValidated = cached.time;
      validationStatus = this.getStatusFromReport(cached.report);
    }
    
    return {
      name: taskName,
      path: taskPath,
      timestamp,
      featureName,
      lanes,
      validationStatus,
      validationReport,
      lastValidated,
    };
  }

  /**
   * Parse lane JSON files in a task directory
   */
  private parseLaneFiles(taskPath: string): LaneFileInfo[] {
    if (!fs.existsSync(taskPath)) return [];

    const files = fs.readdirSync(taskPath)
      .filter(f => f.endsWith('.json'))
      .sort();
    
    const lanes: LaneFileInfo[] = [];
    
    for (const fileName of files) {
      try {
        const filePath = safeJoin(taskPath, fileName);
        const json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        
        const tasks = json.tasks || [];
        const taskNames = tasks.map((t: any) => t.name || 'unnamed');
        const taskFlow = taskNames.join(' → ');
        
        // Preset detection
        let preset = 'custom';
        const names = new Set(taskNames);
        if (names.has('plan') && names.has('implement') && names.has('test')) {
          preset = 'complex';
        } else if (names.has('merge') && names.has('test')) {
          preset = 'merge';
        } else if (names.has('implement') && names.has('test') && !names.has('plan')) {
          preset = 'simple';
        }
        
        lanes.push({
          fileName,
          laneName: path.basename(fileName, '.json'),
          preset,
          taskCount: tasks.length,
          taskFlow,
          dependsOn: json.dependsOn || [],
        });
      } catch {
        // Fallback on parse error
        lanes.push({
          fileName,
          laneName: path.basename(fileName, '.json'),
          preset: 'unknown',
          taskCount: 0,
          taskFlow: '(parse error)',
          dependsOn: [],
        });
      }
    }
    
    return lanes;
  }

  /**
   * Run doctor for a task directory and cache the results
   */
  validateTaskDir(taskName: string): DoctorReport {
    const taskPath = safeJoin(this.tasksDir, taskName);
    
    const report = runDoctor({
      cwd: process.cwd(),
      tasksDir: taskPath,
      includeCursorAgentChecks: false,  // Fast validation
    });
    
    // Save to cache
    this.validationCache.set(taskName, { report, time: Date.now() });
    
    return report;
  }

  /**
   * Get cached validation status
   */
  getValidationStatus(taskName: string): ValidationStatus {
    const cached = this.validationCache.get(taskName);
    if (!cached || Date.now() - cached.time > this.CACHE_TTL) {
      return 'unknown';
    }
    return this.getStatusFromReport(cached.report);
  }

  /**
   * Check if a task directory is ready to run
   */
  canRun(taskName: string): { ok: boolean; issues: string[] } {
    const report = this.validateTaskDir(taskName);
    const errors = report.issues.filter(i => i.severity === 'error');
    
    return {
      ok: errors.length === 0,
      issues: errors.map(i => i.message),
    };
  }

  /**
   * Extract validation status from a doctor report
   */
  private getStatusFromReport(report: DoctorReport): ValidationStatus {
    const errors = report.issues.filter(i => i.severity === 'error').length;
    const warnings = report.issues.filter(i => i.severity === 'warn').length;
    
    if (errors > 0) return 'errors';
    if (warnings > 0) return 'warnings';
    return 'valid';
  }

  /**
   * Get status icon for validation status
   */
  static getStatusIcon(status: ValidationStatus): string {
    const icons: Record<ValidationStatus, string> = {
      'valid': '✅',
      'warnings': '⚠️',
      'errors': '❌',
      'unknown': '❓',
    };
    return icons[status] || '❓';
  }
}

/**
 * Singleton factory
 */
export function createTaskService(tasksDir: string): TaskService {
  return new TaskService(tasksDir);
}

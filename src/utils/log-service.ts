/**
 * Log Service - Helpers for log processing and filtering
 */

import { JsonLogEntry } from './enhanced-logger';
import { LogImportance } from './types';

export interface MergedLogEntry extends JsonLogEntry {
  laneName: string;
  laneColor: string;
}

export class LogService {
  /**
   * Determine importance level of a log entry
   */
  static getLogImportance(entry: JsonLogEntry): LogImportance {
    if (entry.level === 'error') return LogImportance.CRITICAL;
    if (entry.level === 'stderr') return LogImportance.HIGH;
    
    const msg = entry.message.toLowerCase();
    if (msg.includes('error') || msg.includes('fail')) return LogImportance.HIGH;
    if (msg.includes('warn')) return LogImportance.MEDIUM;
    if (msg.includes('success') || msg.includes('done') || msg.includes('completed')) return LogImportance.LOW;
    
    if (entry.level === 'debug') return LogImportance.DEBUG;
    return LogImportance.INFO;
  }

  /**
   * Check if an entry meets the minimum importance level
   */
  static meetsImportanceLevel(entry: JsonLogEntry, minLevel: LogImportance): boolean {
    const entryLevel = this.getLogImportance(entry);
    const levels = [
      LogImportance.DEBUG,
      LogImportance.INFO,
      LogImportance.LOW,
      LogImportance.MEDIUM,
      LogImportance.HIGH,
      LogImportance.CRITICAL
    ];
    
    const entryIdx = levels.indexOf(entryLevel);
    const minIdx = levels.indexOf(minLevel);
    
    return entryIdx >= minIdx;
  }
}

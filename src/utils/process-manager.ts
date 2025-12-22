import { spawnSync } from 'child_process';
import * as os from 'os';

export class ProcessManager {
  /**
   * Check if a process is running by its PID
   */
  static isProcessRunning(pid: number): boolean {
    try {
      // Signal 0 checks for process existence without killing it
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Kill a process by its PID
   * @param pid Process ID
   * @param signal Signal to send (default: SIGTERM)
   */
  static killProcess(pid: number, signal: string = 'SIGTERM'): boolean {
    try {
      if (os.platform() === 'win32') {
        // Windows doesn't support signals in the same way, use taskkill
        const result = spawnSync('taskkill', ['/F', '/PID', String(pid)]);
        return result.status === 0;
      } else {
        process.kill(pid, signal as NodeJS.Signals);
        return true;
      }
    } catch (e) {
      return false;
    }
  }

  /**
   * Kill a process and all its child processes
   * Cross-platform implementation
   */
  static killProcessTree(pid: number): boolean {
    try {
      if (os.platform() === 'win32') {
        // Windows: /T flag kills child processes too
        const result = spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)]);
        return result.status === 0;
      } else {
        // Linux/macOS: Find and kill children recursively or use pkill
        // A simple approach is to use pgrep to find children
        const result = spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' });
        if (result.status === 0 && result.stdout) {
          const children = result.stdout.split('\n').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
          for (const child of children) {
            this.killProcessTree(child);
          }
        }
        
        // Kill the process itself
        return this.killProcess(pid);
      }
    } catch (e) {
      // Fallback to simple kill
      return this.killProcess(pid);
    }
  }

  /**
   * Find cursorflow related processes using pgrep (Linux/macOS only)
   */
  static findCursorFlowProcesses(): number[] {
    if (os.platform() === 'win32') {
      // Basic Windows implementation using tasklist if needed, 
      // but for now focusing on core requirements
      return [];
    }

    try {
      // Find processes with 'cursorflow' in their command line, 
      // avoiding unrelated matches by looking for specific execution patterns
      const result = spawnSync('pgrep', ['-f', 'cursorflow.*(index|runner|orchestrator)'], { encoding: 'utf8' });
      if (result.status !== 0) {
        // Fallback to simpler pattern
        const fallback = spawnSync('pgrep', ['-f', 'cursorflow'], { encoding: 'utf8' });
        if (fallback.status !== 0) return [];
        return fallback.stdout
          .split('\n')
          .map(s => parseInt(s.trim()))
          .filter(n => !isNaN(n) && n !== process.pid);
      }
      
      return result.stdout
        .split('\n')
        .map(s => parseInt(s.trim()))
        .filter(n => !isNaN(n) && n !== process.pid);
    } catch (e) {
      return [];
    }
  }
}

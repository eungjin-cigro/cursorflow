import { spawnSync } from 'child_process';

export class ProcessManager {
  /**
   * Check if a process is running
   */
  static isRunning(pid: number): boolean {
    try {
      // Signal 0 checks for process existence without killing it
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Stop a process gracefully (SIGTERM)
   */
  static stop(pid: number, signal: NodeJS.Signals = 'SIGTERM'): boolean {
    try {
      process.kill(pid, signal);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Force stop a process (SIGKILL)
   */
  static forceStop(pid: number): boolean {
    return this.stop(pid, 'SIGKILL');
  }

  /**
   * Stop multiple processes
   */
  static stopMultiple(pids: number[]): { stopped: number; failed: number } {
    let stopped = 0;
    let failed = 0;
    
    for (const pid of pids) {
      if (this.stop(pid)) {
        stopped++;
      } else {
        failed++;
      }
    }
    
    return { stopped, failed };
  }

  /**
   * Find cursorflow related processes using pgrep
   */
  static findCursorFlowProcesses(): number[] {
    try {
      // Find processes with 'cursorflow' in their command line, 
      // but avoid common unrelated matches by looking for the specific bin/index path 
      // or common patterns used in our execution
      const result = spawnSync('pgrep', ['-f', 'cursorflow.*(index|runner|orchestrator)'], { encoding: 'utf8' });
      if (result.status !== 0) {
        // Fallback to simpler pattern if specific one fails
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
        .filter(n => !isNaN(n) && n !== process.pid); // Exclude current process
    } catch (e) {
      return [];
    }
  }

  /**
   * Kill a process tree (if possible)
   * Note: This is a simple implementation that tries to use pkill -P
   */
  static killProcessTree(pid: number): boolean {
    try {
      // First find children
      const result = spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' });
      if (result.status === 0) {
        const children = result.stdout.split('\n').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
        for (const child of children) {
          this.killProcessTree(child);
        }
      }
      
      // Kill the process itself
      return this.stop(pid);
    } catch (e) {
      return this.stop(pid);
    }
  }
}

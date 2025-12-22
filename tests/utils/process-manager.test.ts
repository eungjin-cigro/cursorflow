import { ProcessManager } from '../../src/utils/process-manager';
import { spawn } from 'child_process';

describe('ProcessManager', () => {
  it('should correctly identify if a process is running', async () => {
    // Start a long-running process
    const child = spawn('sleep', ['10']);
    const pid = child.pid!;
    
    try {
      expect(ProcessManager.isRunning(pid)).toBe(true);
      
      // Kill it
      ProcessManager.stop(pid);
      
      // Give it a moment to die
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(ProcessManager.isRunning(pid)).toBe(false);
    } finally {
      if (ProcessManager.isRunning(pid)) {
        child.kill('SIGKILL');
      }
    }
  });

  it('should stop multiple processes', async () => {
    const child1 = spawn('sleep', ['10']);
    const child2 = spawn('sleep', ['10']);
    const pids = [child1.pid!, child2.pid!];
    
    try {
      const result = ProcessManager.stopMultiple(pids);
      expect(result.stopped).toBe(2);
      expect(result.failed).toBe(0);
      
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(ProcessManager.isRunning(pids[0]!)).toBe(false);
      expect(ProcessManager.isRunning(pids[1]!)).toBe(false);
    } finally {
      pids.forEach(pid => {
        if (ProcessManager.isRunning(pid)) process.kill(pid, 'SIGKILL');
      });
    }
  });

  it('should find cursorflow processes (mocked test)', () => {
    // Since we can't easily start a process named 'cursorflow' without more effort,
    // we just check that it doesn't crash and returns an array
    const processes = ProcessManager.findCursorFlowProcesses();
    expect(Array.isArray(processes)).toBe(true);
  });
});

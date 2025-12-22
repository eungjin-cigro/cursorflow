import { ProcessManager } from '../../src/utils/process-manager';
import { spawn } from 'child_process';

describe('ProcessManager', () => {
  it('should correctly identify if a process is running', async () => {
    // Start a long-running process
    const child = spawn('sleep', ['10']);
    const pid = child.pid!;
    
    try {
      expect(ProcessManager.isProcessRunning(pid)).toBe(true);
      
      // Kill it
      ProcessManager.killProcess(pid);
      
      // Give it a moment to die
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(ProcessManager.isProcessRunning(pid)).toBe(false);
    } finally {
      if (ProcessManager.isProcessRunning(pid)) {
        child.kill('SIGKILL');
      }
    }
  });

  it('should kill process tree', async () => {
    // Start a shell that starts a sleep process
    const child = spawn('sh', ['-c', 'sleep 10']);
    const pid = child.pid!;
    
    try {
      expect(ProcessManager.isProcessRunning(pid)).toBe(true);
      
      // Kill the tree
      ProcessManager.killProcessTree(pid);
      
      // Give it a moment to die
      await new Promise(resolve => setTimeout(resolve, 200));
      
      expect(ProcessManager.isProcessRunning(pid)).toBe(false);
    } finally {
      if (ProcessManager.isProcessRunning(pid)) {
        child.kill('SIGKILL');
      }
    }
  });

  it('should find cursorflow processes (mocked test)', () => {
    const processes = ProcessManager.findCursorFlowProcesses();
    expect(Array.isArray(processes)).toBe(true);
  });
});

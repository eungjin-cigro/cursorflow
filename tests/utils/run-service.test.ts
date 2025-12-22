import * as fs from 'fs';
import * as path from 'path';
import { RunService } from '../../src/utils/run-service';
import { safeJoin } from '../../src/utils/path';

describe('RunService', () => {
  const testLogsDir = path.join(__dirname, 'test-logs');

  beforeEach(() => {
    if (fs.existsSync(testLogsDir)) {
      fs.rmSync(testLogsDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testLogsDir, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(testLogsDir)) {
      fs.rmSync(testLogsDir, { recursive: true, force: true });
    }
  });

  it('should list runs in the logs directory', () => {
    const runDir = safeJoin(testLogsDir, 'run-20251222-120000');
    fs.mkdirSync(runDir, { recursive: true });
    
    const service = new RunService(testLogsDir);
    const runs = service.listRuns();
    
    expect(runs.length).toBe(1);
    expect(runs[0]!.id).toBe('run-20251222-120000');
  });

  it('should correctly calculate run status from lanes', () => {
    const runId = 'run-20251222-120000';
    const runPath = safeJoin(testLogsDir, runId);
    const laneDir = safeJoin(runPath, 'lane-1');
    fs.mkdirSync(laneDir, { recursive: true });
    
    // Create a mock state.json
    const statePath = safeJoin(laneDir, 'state.json');
    fs.writeFileSync(statePath, JSON.stringify({
      label: 'lane-1',
      status: 'completed',
      currentTaskIndex: 2,
      totalTasks: 3,
      startTime: Date.now() - 10000,
      endTime: Date.now()
    }));

    const service = new RunService(testLogsDir);
    const runInfo = service.getRunInfo(runId);
    
    expect(runInfo).not.toBeNull();
    expect(runInfo!.status).toBe('completed');
    expect(runInfo!.lanes.length).toBe(1);
    expect(runInfo!.lanes[0]!.status).toBe('completed');
  });

  it('should extract task name from meta.json', () => {
    const runId = 'run-20251222-120000';
    const runPath = safeJoin(testLogsDir, runId);
    fs.mkdirSync(runPath, { recursive: true });
    
    fs.writeFileSync(safeJoin(runPath, 'meta.json'), JSON.stringify({
      taskName: 'MySpecialTask'
    }));

    const service = new RunService(testLogsDir);
    const runInfo = service.getRunInfo(runId);
    
    expect(runInfo!.taskName).toBe('MySpecialTask');
  });

  it('should return unique branches and worktrees', () => {
    const runId = 'run-20251222-120000';
    const runPath = safeJoin(testLogsDir, runId);
    
    // Two lanes sharing same branch/worktree (unlikely but possible in some configs)
    const lane1Dir = safeJoin(runPath, 'lane-1');
    const lane2Dir = safeJoin(runPath, 'lane-2');
    fs.mkdirSync(lane1Dir, { recursive: true });
    fs.mkdirSync(lane2Dir, { recursive: true });
    
    const commonBranch = 'feature/common';
    const commonWorktree = '/path/to/worktree';
    
    fs.writeFileSync(safeJoin(lane1Dir, 'state.json'), JSON.stringify({
      pipelineBranch: commonBranch,
      worktreeDir: commonWorktree,
      status: 'running'
    }));
    fs.writeFileSync(safeJoin(lane2Dir, 'state.json'), JSON.stringify({
      pipelineBranch: commonBranch,
      worktreeDir: commonWorktree,
      status: 'running'
    }));

    const service = new RunService(testLogsDir);
    const runInfo = service.getRunInfo(runId);
    
    expect(runInfo!.branches).toEqual([commonBranch]);
    expect(runInfo!.worktrees).toEqual([commonWorktree]);
  });
});

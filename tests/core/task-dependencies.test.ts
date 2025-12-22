/**
 * Task-level dependency tests
 * 
 * Tests the new fine-grained task-level dependency system that allows:
 * - Lane A task 2 completion -> Lane B task 3 can start
 * - More complex parallel execution patterns
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  parseDependency,
  isTaskDependencySatisfied,
  areLaneDependenciesSatisfied,
  listLaneFiles,
  LaneInfo,
} from '../../src/core/orchestrator';
import { LaneState } from '../../src/utils/types';

describe('Task-level Dependencies', () => {
  const testDir = path.join(__dirname, 'test-task-deps');
  const lanesDir = path.join(testDir, 'lanes');

  beforeAll(() => {
    // Create test directories
    fs.mkdirSync(testDir, { recursive: true });
    fs.mkdirSync(lanesDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('parseDependency', () => {
    test('should parse lane-level dependency (no colon)', () => {
      const result = parseDependency('lane-a');
      expect(result).toEqual({
        laneName: 'lane-a',
        isTaskLevel: false,
      });
    });

    test('should parse task-level dependency (with colon)', () => {
      const result = parseDependency('lane-a:task-1');
      expect(result).toEqual({
        laneName: 'lane-a',
        taskName: 'task-1',
        isTaskLevel: true,
      });
    });

    test('should handle task names with colons', () => {
      const result = parseDependency('lane-a:task:with:colons');
      expect(result).toEqual({
        laneName: 'lane-a',
        taskName: 'task:with:colons',
        isTaskLevel: true,
      });
    });

    test('should handle numeric task references', () => {
      const result = parseDependency('lane-a:2');
      expect(result).toEqual({
        laneName: 'lane-a',
        taskName: '2',
        isTaskLevel: true,
      });
    });
  });

  describe('isTaskDependencySatisfied', () => {
    const laneRunDirs: Record<string, string> = {};
    const completedLanes = new Set<string>();

    beforeEach(() => {
      // Setup lane directories
      const laneADir = path.join(lanesDir, 'lane-a');
      const laneBDir = path.join(lanesDir, 'lane-b');
      fs.mkdirSync(laneADir, { recursive: true });
      fs.mkdirSync(laneBDir, { recursive: true });
      
      laneRunDirs['lane-a'] = laneADir;
      laneRunDirs['lane-b'] = laneBDir;
      completedLanes.clear();
    });

    afterEach(() => {
      // Cleanup
      fs.rmSync(path.join(lanesDir, 'lane-a'), { recursive: true, force: true });
      fs.rmSync(path.join(lanesDir, 'lane-b'), { recursive: true, force: true });
    });

    test('should return true for lane-level dependency when lane is completed', () => {
      completedLanes.add('lane-a');
      
      const dep = parseDependency('lane-a');
      const result = isTaskDependencySatisfied(dep, laneRunDirs, completedLanes);
      
      expect(result).toBe(true);
    });

    test('should return false for lane-level dependency when lane is not completed', () => {
      // lane-a not in completedLanes
      const dep = parseDependency('lane-a');
      const result = isTaskDependencySatisfied(dep, laneRunDirs, completedLanes);
      
      expect(result).toBe(false);
    });

    test('should return true for task-level dependency when task is in completedTasks', () => {
      // Create state with completed task
      const state: LaneState = {
        label: 'lane-a',
        status: 'running',
        currentTaskIndex: 3,
        totalTasks: 5,
        worktreeDir: null,
        pipelineBranch: null,
        startTime: Date.now(),
        endTime: null,
        error: null,
        dependencyRequest: null,
        completedTasks: ['task-1', 'task-2', 'implement-service'],
      };
      
      fs.writeFileSync(
        path.join(laneRunDirs['lane-a']!, 'state.json'),
        JSON.stringify(state)
      );
      
      const dep = parseDependency('lane-a:implement-service');
      const result = isTaskDependencySatisfied(dep, laneRunDirs, completedLanes);
      
      expect(result).toBe(true);
    });

    test('should return false for task-level dependency when task is not completed', () => {
      // Create state without the target task
      const state: LaneState = {
        label: 'lane-a',
        status: 'running',
        currentTaskIndex: 1,
        totalTasks: 5,
        worktreeDir: null,
        pipelineBranch: null,
        startTime: Date.now(),
        endTime: null,
        error: null,
        dependencyRequest: null,
        completedTasks: ['task-1'],
      };
      
      fs.writeFileSync(
        path.join(laneRunDirs['lane-a']!, 'state.json'),
        JSON.stringify(state)
      );
      
      const dep = parseDependency('lane-a:implement-service');
      const result = isTaskDependencySatisfied(dep, laneRunDirs, completedLanes);
      
      expect(result).toBe(false);
    });

    test('should return true for numeric task index when task is past that index', () => {
      const state: LaneState = {
        label: 'lane-a',
        status: 'running',
        currentTaskIndex: 3, // Currently on task 3, so tasks 0, 1, 2 are done
        totalTasks: 5,
        worktreeDir: null,
        pipelineBranch: null,
        startTime: Date.now(),
        endTime: null,
        error: null,
        dependencyRequest: null,
        completedTasks: [],
      };
      
      fs.writeFileSync(
        path.join(laneRunDirs['lane-a']!, 'state.json'),
        JSON.stringify(state)
      );
      
      // Task at index 2 should be satisfied (currentTaskIndex=3 means we're past 2)
      const dep = parseDependency('lane-a:2');
      const result = isTaskDependencySatisfied(dep, laneRunDirs, completedLanes);
      
      expect(result).toBe(true);
    });

    test('should return false for numeric task index when task is not yet reached', () => {
      const state: LaneState = {
        label: 'lane-a',
        status: 'running',
        currentTaskIndex: 2, // Currently on task 2
        totalTasks: 5,
        worktreeDir: null,
        pipelineBranch: null,
        startTime: Date.now(),
        endTime: null,
        error: null,
        dependencyRequest: null,
        completedTasks: [],
      };
      
      fs.writeFileSync(
        path.join(laneRunDirs['lane-a']!, 'state.json'),
        JSON.stringify(state)
      );
      
      // Task at index 3 is not yet reached
      const dep = parseDependency('lane-a:3');
      const result = isTaskDependencySatisfied(dep, laneRunDirs, completedLanes);
      
      expect(result).toBe(false);
    });

    test('should return false when lane directory does not exist', () => {
      const dep = parseDependency('non-existent-lane:task-1');
      const result = isTaskDependencySatisfied(dep, laneRunDirs, completedLanes);
      
      expect(result).toBe(false);
    });

    test('should return false when state.json does not exist', () => {
      const dep = parseDependency('lane-a:task-1');
      const result = isTaskDependencySatisfied(dep, laneRunDirs, completedLanes);
      
      expect(result).toBe(false);
    });
  });

  describe('areLaneDependenciesSatisfied', () => {
    const laneRunDirs: Record<string, string> = {};
    let completedLanes: Set<string>;
    let failedLanes: Set<string>;
    let blockedLanes: Map<string, any>;

    beforeEach(() => {
      // Setup lane directories
      const laneADir = path.join(lanesDir, 'lane-a');
      const laneBDir = path.join(lanesDir, 'lane-b');
      fs.mkdirSync(laneADir, { recursive: true });
      fs.mkdirSync(laneBDir, { recursive: true });
      
      laneRunDirs['lane-a'] = laneADir;
      laneRunDirs['lane-b'] = laneBDir;
      
      completedLanes = new Set<string>();
      failedLanes = new Set<string>();
      blockedLanes = new Map<string, any>();
    });

    afterEach(() => {
      fs.rmSync(path.join(lanesDir, 'lane-a'), { recursive: true, force: true });
      fs.rmSync(path.join(lanesDir, 'lane-b'), { recursive: true, force: true });
    });

    test('should return satisfied for lane with no dependencies', () => {
      const lane: LaneInfo = {
        name: 'lane-b',
        path: '/path/to/lane-b.json',
        dependsOn: [],
      };
      
      const result = areLaneDependenciesSatisfied(
        lane, laneRunDirs, completedLanes, failedLanes, blockedLanes
      );
      
      expect(result.satisfied).toBe(true);
    });

    test('should return satisfied for lane-level dependency when lane is completed', () => {
      completedLanes.add('lane-a');
      
      const lane: LaneInfo = {
        name: 'lane-b',
        path: '/path/to/lane-b.json',
        dependsOn: ['lane-a'],
      };
      
      const result = areLaneDependenciesSatisfied(
        lane, laneRunDirs, completedLanes, failedLanes, blockedLanes
      );
      
      expect(result.satisfied).toBe(true);
    });

    test('should return not satisfied for lane-level dependency when lane is not completed', () => {
      const lane: LaneInfo = {
        name: 'lane-b',
        path: '/path/to/lane-b.json',
        dependsOn: ['lane-a'],
      };
      
      const result = areLaneDependenciesSatisfied(
        lane, laneRunDirs, completedLanes, failedLanes, blockedLanes
      );
      
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('waiting for lane-a');
    });

    test('should return satisfied for task-level dependency when task is completed', () => {
      // Create state with completed task
      const state: LaneState = {
        label: 'lane-a',
        status: 'running',
        currentTaskIndex: 2,
        totalTasks: 5,
        worktreeDir: null,
        pipelineBranch: null,
        startTime: Date.now(),
        endTime: null,
        error: null,
        dependencyRequest: null,
        completedTasks: ['implement-service'],
      };
      
      fs.writeFileSync(
        path.join(laneRunDirs['lane-a']!, 'state.json'),
        JSON.stringify(state)
      );
      
      const lane: LaneInfo = {
        name: 'lane-b',
        path: '/path/to/lane-b.json',
        dependsOn: ['lane-a:implement-service'],
      };
      
      const result = areLaneDependenciesSatisfied(
        lane, laneRunDirs, completedLanes, failedLanes, blockedLanes
      );
      
      expect(result.satisfied).toBe(true);
    });

    test('should return not satisfied for task-level dependency when task is not completed', () => {
      const state: LaneState = {
        label: 'lane-a',
        status: 'running',
        currentTaskIndex: 1,
        totalTasks: 5,
        worktreeDir: null,
        pipelineBranch: null,
        startTime: Date.now(),
        endTime: null,
        error: null,
        dependencyRequest: null,
        completedTasks: ['read-plan'],
      };
      
      fs.writeFileSync(
        path.join(laneRunDirs['lane-a']!, 'state.json'),
        JSON.stringify(state)
      );
      
      const lane: LaneInfo = {
        name: 'lane-b',
        path: '/path/to/lane-b.json',
        dependsOn: ['lane-a:implement-service'],
      };
      
      const result = areLaneDependenciesSatisfied(
        lane, laneRunDirs, completedLanes, failedLanes, blockedLanes
      );
      
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('waiting for lane-a:implement-service');
    });

    test('should return failed reason when dependency lane has failed', () => {
      failedLanes.add('lane-a');
      
      const lane: LaneInfo = {
        name: 'lane-b',
        path: '/path/to/lane-b.json',
        dependsOn: ['lane-a:some-task'],
      };
      
      const result = areLaneDependenciesSatisfied(
        lane, laneRunDirs, completedLanes, failedLanes, blockedLanes
      );
      
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('failed');
    });

    test('should return blocked reason when dependency lane is blocked', () => {
      blockedLanes.set('lane-a', { reason: 'dependency change' });
      
      const lane: LaneInfo = {
        name: 'lane-b',
        path: '/path/to/lane-b.json',
        dependsOn: ['lane-a'],
      };
      
      const result = areLaneDependenciesSatisfied(
        lane, laneRunDirs, completedLanes, failedLanes, blockedLanes
      );
      
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('blocked');
    });

    test('should check first task dependencies when lane has startIndex', () => {
      // Lane-level dependency is satisfied
      const state: LaneState = {
        label: 'lane-a',
        status: 'running',
        currentTaskIndex: 2,
        totalTasks: 5,
        worktreeDir: null,
        pipelineBranch: null,
        startTime: Date.now(),
        endTime: null,
        error: null,
        dependencyRequest: null,
        completedTasks: ['task-1'],
      };
      
      fs.writeFileSync(
        path.join(laneRunDirs['lane-a']!, 'state.json'),
        JSON.stringify(state)
      );
      
      // Lane B depends on lane-a:task-1 (satisfied) at lane level
      // But its first task depends on lane-a:task-2 (not satisfied)
      const lane: LaneInfo = {
        name: 'lane-b',
        path: '/path/to/lane-b.json',
        dependsOn: ['lane-a:task-1'],
        startIndex: 0,
        tasks: [
          { name: 'first-task', dependsOn: ['lane-a:task-2'] },
          { name: 'second-task' },
        ],
      };
      
      const result = areLaneDependenciesSatisfied(
        lane, laneRunDirs, completedLanes, failedLanes, blockedLanes
      );
      
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('first task waiting for lane-a:task-2');
    });

    test('should handle multiple dependencies (all must be satisfied)', () => {
      const stateA: LaneState = {
        label: 'lane-a',
        status: 'completed',
        currentTaskIndex: 3,
        totalTasks: 3,
        worktreeDir: null,
        pipelineBranch: null,
        startTime: Date.now(),
        endTime: Date.now(),
        error: null,
        dependencyRequest: null,
        completedTasks: ['task-1', 'task-2', 'task-3'],
      };
      
      fs.writeFileSync(
        path.join(laneRunDirs['lane-a']!, 'state.json'),
        JSON.stringify(stateA)
      );
      
      // Lane C dir
      const laneCDir = path.join(lanesDir, 'lane-c');
      fs.mkdirSync(laneCDir, { recursive: true });
      laneRunDirs['lane-c'] = laneCDir;
      
      const stateC: LaneState = {
        label: 'lane-c',
        status: 'running',
        currentTaskIndex: 1,
        totalTasks: 3,
        worktreeDir: null,
        pipelineBranch: null,
        startTime: Date.now(),
        endTime: null,
        error: null,
        dependencyRequest: null,
        completedTasks: ['setup'],
      };
      
      fs.writeFileSync(
        path.join(laneRunDirs['lane-c']!, 'state.json'),
        JSON.stringify(stateC)
      );
      
      // Lane B depends on both lane-a:task-2 and lane-c:build
      const lane: LaneInfo = {
        name: 'lane-b',
        path: '/path/to/lane-b.json',
        dependsOn: ['lane-a:task-2', 'lane-c:build'],
      };
      
      const result = areLaneDependenciesSatisfied(
        lane, laneRunDirs, completedLanes, failedLanes, blockedLanes
      );
      
      // lane-a:task-2 is satisfied, but lane-c:build is not
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('lane-c:build');
      
      // Cleanup
      fs.rmSync(laneCDir, { recursive: true, force: true });
    });
  });

  describe('listLaneFiles with task dependencies', () => {
    const tasksDir = path.join(testDir, 'tasks');

    beforeEach(() => {
      fs.mkdirSync(tasksDir, { recursive: true });
    });

    afterEach(() => {
      fs.rmSync(tasksDir, { recursive: true, force: true });
    });

    test('should load task-level dependencies from lane config', () => {
      const laneA = {
        baseBranch: 'main',
        dependencyPolicy: { allowDependencyChange: false, lockfileReadOnly: true },
        tasks: [
          { name: 'task-1', prompt: 'Do task 1' },
          { name: 'task-2', prompt: 'Do task 2' },
        ],
      };
      
      const laneB = {
        baseBranch: 'main',
        dependsOn: ['lane-a:task-1'],
        dependencyPolicy: { allowDependencyChange: false, lockfileReadOnly: true },
        tasks: [
          { name: 'task-a', prompt: 'Do task A', dependsOn: ['lane-a:task-1'] },
          { name: 'task-b', prompt: 'Do task B', dependsOn: ['lane-a:task-2'] },
        ],
      };
      
      fs.writeFileSync(
        path.join(tasksDir, 'lane-a.json'),
        JSON.stringify(laneA)
      );
      fs.writeFileSync(
        path.join(tasksDir, 'lane-b.json'),
        JSON.stringify(laneB)
      );
      
      const lanes = listLaneFiles(tasksDir);
      
      expect(lanes).toHaveLength(2);
      
      // Lane A
      const laneAResult = lanes.find(l => l.name === 'lane-a');
      expect(laneAResult).toBeDefined();
      expect(laneAResult!.dependsOn).toEqual([]);
      expect(laneAResult!.tasks).toHaveLength(2);
      
      // Lane B
      const laneBResult = lanes.find(l => l.name === 'lane-b');
      expect(laneBResult).toBeDefined();
      expect(laneBResult!.dependsOn).toEqual(['lane-a:task-1']);
      expect(laneBResult!.tasks).toHaveLength(2);
      expect(laneBResult!.tasks![0]).toEqual({
        name: 'task-a',
        dependsOn: ['lane-a:task-1'],
      });
      expect(laneBResult!.tasks![1]).toEqual({
        name: 'task-b',
        dependsOn: ['lane-a:task-2'],
      });
    });
  });

  describe('Integration: Task-level dependency scenario', () => {
    const tasksDir = path.join(testDir, 'integration-tasks');
    const runDir = path.join(testDir, 'integration-run');

    beforeEach(() => {
      fs.mkdirSync(tasksDir, { recursive: true });
      fs.mkdirSync(runDir, { recursive: true });
    });

    afterEach(() => {
      fs.rmSync(tasksDir, { recursive: true, force: true });
      fs.rmSync(runDir, { recursive: true, force: true });
    });

    test('should allow lane B to start after lane A task 2 completes (not full lane)', () => {
      // Scenario:
      // Lane A: task-1 -> task-2 -> task-3 -> task-4 -> task-5
      // Lane B: depends on lane-a:task-2
      // 
      // Lane B should be able to start as soon as lane A completes task-2,
      // without waiting for all 5 tasks in lane A.
      
      const laneAConfig = {
        baseBranch: 'main',
        dependencyPolicy: { allowDependencyChange: false, lockfileReadOnly: true },
        tasks: [
          { name: 'task-1', prompt: 'Task 1' },
          { name: 'task-2', prompt: 'Task 2' },
          { name: 'task-3', prompt: 'Task 3' },
          { name: 'task-4', prompt: 'Task 4' },
          { name: 'task-5', prompt: 'Task 5' },
        ],
      };
      
      const laneBConfig = {
        baseBranch: 'main',
        dependsOn: ['lane-a:task-2'],
        dependencyPolicy: { allowDependencyChange: false, lockfileReadOnly: true },
        tasks: [
          { name: 'task-b1', prompt: 'Task B1' },
          { name: 'task-b2', prompt: 'Task B2' },
        ],
      };
      
      fs.writeFileSync(
        path.join(tasksDir, 'lane-a.json'),
        JSON.stringify(laneAConfig)
      );
      fs.writeFileSync(
        path.join(tasksDir, 'lane-b.json'),
        JSON.stringify(laneBConfig)
      );
      
      const lanes = listLaneFiles(tasksDir);
      const laneA = lanes.find(l => l.name === 'lane-a')!;
      const laneB = lanes.find(l => l.name === 'lane-b')!;
      
      // Create run directories
      const laneARunDir = path.join(runDir, 'lane-a');
      const laneBRunDir = path.join(runDir, 'lane-b');
      fs.mkdirSync(laneARunDir, { recursive: true });
      fs.mkdirSync(laneBRunDir, { recursive: true });
      
      const laneRunDirs: Record<string, string> = {
        'lane-a': laneARunDir,
        'lane-b': laneBRunDir,
      };
      
      const completedLanes = new Set<string>();
      const failedLanes = new Set<string>();
      const blockedLanes = new Map<string, any>();
      
      // Initially, lane A has only completed task-1
      const stateAfterTask1: LaneState = {
        label: 'lane-a',
        status: 'running',
        currentTaskIndex: 1,
        totalTasks: 5,
        worktreeDir: null,
        pipelineBranch: null,
        startTime: Date.now(),
        endTime: null,
        error: null,
        dependencyRequest: null,
        completedTasks: ['task-1'],
      };
      
      fs.writeFileSync(
        path.join(laneARunDir, 'state.json'),
        JSON.stringify(stateAfterTask1)
      );
      
      // Check: Lane B should NOT be ready yet
      let result = areLaneDependenciesSatisfied(
        laneB, laneRunDirs, completedLanes, failedLanes, blockedLanes
      );
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('waiting for lane-a:task-2');
      
      // Lane A completes task-2 (but still has 3 more tasks)
      const stateAfterTask2: LaneState = {
        ...stateAfterTask1,
        currentTaskIndex: 2,
        completedTasks: ['task-1', 'task-2'],
      };
      
      fs.writeFileSync(
        path.join(laneARunDir, 'state.json'),
        JSON.stringify(stateAfterTask2)
      );
      
      // Check: Lane B should NOW be ready!
      result = areLaneDependenciesSatisfied(
        laneB, laneRunDirs, completedLanes, failedLanes, blockedLanes
      );
      expect(result.satisfied).toBe(true);
      
      // Verify that lane A is NOT in completedLanes
      // This confirms we're using task-level dependency, not lane-level
      expect(completedLanes.has('lane-a')).toBe(false);
    });

    test('should handle complex multi-lane dependency chain', () => {
      // Scenario:
      // Lane A: setup -> build -> test
      // Lane B: depends on lane-a:build, has tasks: lint -> format
      // Lane C: depends on lane-b:lint AND lane-a:test
      //
      // Expected behavior:
      // 1. Lane A starts immediately
      // 2. Lane B can start after lane A:build
      // 3. Lane C can start after BOTH lane-b:lint AND lane-a:test
      
      const laneARunDir = path.join(runDir, 'lane-a');
      const laneBRunDir = path.join(runDir, 'lane-b');
      const laneCRunDir = path.join(runDir, 'lane-c');
      
      fs.mkdirSync(laneARunDir, { recursive: true });
      fs.mkdirSync(laneBRunDir, { recursive: true });
      fs.mkdirSync(laneCRunDir, { recursive: true });
      
      const laneRunDirs: Record<string, string> = {
        'lane-a': laneARunDir,
        'lane-b': laneBRunDir,
        'lane-c': laneCRunDir,
      };
      
      const completedLanes = new Set<string>();
      const failedLanes = new Set<string>();
      const blockedLanes = new Map<string, any>();
      
      const laneC: LaneInfo = {
        name: 'lane-c',
        path: '/path/to/lane-c.json',
        dependsOn: ['lane-b:lint', 'lane-a:test'],
      };
      
      // State: Lane A completed build but not test, Lane B completed lint
      const stateA: LaneState = {
        label: 'lane-a',
        status: 'running',
        currentTaskIndex: 2,
        totalTasks: 3,
        worktreeDir: null,
        pipelineBranch: null,
        startTime: Date.now(),
        endTime: null,
        error: null,
        dependencyRequest: null,
        completedTasks: ['setup', 'build'], // test not done yet
      };
      
      const stateB: LaneState = {
        label: 'lane-b',
        status: 'running',
        currentTaskIndex: 1,
        totalTasks: 2,
        worktreeDir: null,
        pipelineBranch: null,
        startTime: Date.now(),
        endTime: null,
        error: null,
        dependencyRequest: null,
        completedTasks: ['lint'], // lint done, format not done
      };
      
      fs.writeFileSync(path.join(laneARunDir, 'state.json'), JSON.stringify(stateA));
      fs.writeFileSync(path.join(laneBRunDir, 'state.json'), JSON.stringify(stateB));
      
      // Lane C should NOT be ready (lane-a:test not done)
      let result = areLaneDependenciesSatisfied(
        laneC, laneRunDirs, completedLanes, failedLanes, blockedLanes
      );
      expect(result.satisfied).toBe(false);
      expect(result.reason).toContain('lane-a:test');
      
      // Lane A completes test
      stateA.currentTaskIndex = 3;
      stateA.completedTasks = [...(stateA.completedTasks || []), 'test'];
      fs.writeFileSync(path.join(laneARunDir, 'state.json'), JSON.stringify(stateA));
      
      // Now Lane C should be ready!
      result = areLaneDependenciesSatisfied(
        laneC, laneRunDirs, completedLanes, failedLanes, blockedLanes
      );
      expect(result.satisfied).toBe(true);
    });
  });
});


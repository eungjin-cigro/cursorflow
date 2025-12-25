import * as fs from 'fs';
import * as path from 'path';
import { TaskService } from '../../src/utils/task-service';

describe('TaskService', () => {
  const uniqueId = Math.random().toString(36).substring(2, 10);
  const tmpDir = path.join(__dirname, `tmp-task-service-${uniqueId}`);
  const tasksDir = path.join(tmpDir, 'tasks');
  let taskService: TaskService;

  beforeAll(() => {
    if (!fs.existsSync(tasksDir)) {
      fs.mkdirSync(tasksDir, { recursive: true });
    }
    taskService = new TaskService(tasksDir);
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Clear tasks directory before each test
    const items = fs.readdirSync(tasksDir);
    for (const item of items) {
      fs.rmSync(path.join(tasksDir, item), { recursive: true, force: true });
    }
    taskService.clearCache();
  });

  describe('listTaskDirs', () => {
    it('should return empty array if tasks directory does not exist', () => {
      const nonExistentService = new TaskService(path.join(tmpDir, 'non-existent'));
      expect(nonExistentService.listTaskDirs()).toEqual([]);
    });

    it('should list and sort task directories by timestamp', () => {
      const task1 = '2412201000_Task1';
      const task2 = '2412211530_Task2';
      fs.mkdirSync(path.join(tasksDir, task1));
      fs.mkdirSync(path.join(tasksDir, task2));

      const dirs = taskService.listTaskDirs();
      expect(dirs.length).toBe(2);
      expect(dirs[0]!.name).toBe(task2);
      expect(dirs[1]!.name).toBe(task1);
    });

    it('should list task directories with JSON files', () => {
      // Valid task with timestamp prefix
      fs.mkdirSync(path.join(tasksDir, '2412201000_ValidTask'));
      
      // Valid task with .json files (no timestamp prefix)
      const noTsDir = path.join(tasksDir, 'NoTimestampTask');
      fs.mkdirSync(noTsDir);
      fs.writeFileSync(path.join(noTsDir, 'lane1.json'), '{}');

      const dirs = taskService.listTaskDirs();
      expect(dirs.length).toBeGreaterThanOrEqual(2);
      expect(dirs.map(d => d.name)).toContain('2412201000_ValidTask');
      expect(dirs.map(d => d.name)).toContain('NoTimestampTask');
    });
  });

  describe('getTaskDirInfo', () => {
    it('should parse lane files correctly', () => {
      const taskName = '2412221530_AuthSystem';
      const taskPath = path.join(tasksDir, taskName);
      fs.mkdirSync(taskPath, { recursive: true });

      const lane1 = {
        tasks: [
          { name: 'plan', prompt: 'p' },
          { name: 'implement', prompt: 'i' },
          { name: 'test', prompt: 't' }
        ],
        dependsOn: []
      };
      const lane2 = {
        tasks: [
          { name: 'implement', prompt: 'i' },
          { name: 'test', prompt: 't' }
        ],
        dependsOn: ['01-lane-1']
      };

      fs.writeFileSync(path.join(taskPath, '01-lane-1.json'), JSON.stringify(lane1));
      fs.writeFileSync(path.join(taskPath, '02-lane-2.json'), JSON.stringify(lane2));

      const info = taskService.getTaskDirInfo(taskName);
      expect(info).not.toBeNull();
      expect(info!.featureName).toBe('AuthSystem');
      expect(info!.lanes.length).toBe(2);
      expect(info!.lanes[0]!.preset).toBe('complex');
      expect(info!.lanes[1]!.preset).toBe('simple');
    });

    it('should extract correct timestamp', () => {
      const taskName = '2412221530_AuthSystem';
      const taskPath = path.join(tasksDir, taskName);
      fs.mkdirSync(taskPath, { recursive: true });

      const info = taskService.getTaskDirInfo(taskName);
      expect(info!.timestamp.getFullYear()).toBe(2024);
      expect(info!.timestamp.getMonth()).toBe(11); // December is 11
      expect(info!.timestamp.getDate()).toBe(22);
    });
  });

  describe('validateTaskDir', () => {
    it('should return ValidationResult with errors for missing lanes', () => {
      const taskName = '2412221530_EmptyTask';
      const taskPath = path.join(tasksDir, taskName);
      fs.mkdirSync(taskPath, { recursive: true });

      const result = taskService.validateTaskDir(taskName);
      
      expect(result.status).toBe('errors');
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors).toContain('No lane files found in task directory');
    });

    it('should return valid status for proper task', () => {
      const taskName = '2412221530_ValidTask';
      const taskPath = path.join(tasksDir, taskName);
      fs.mkdirSync(taskPath, { recursive: true });
      
      fs.writeFileSync(path.join(taskPath, '01-lane.json'), JSON.stringify({
        tasks: [{ name: 'implement', prompt: 'p' }]
      }));

      const result = taskService.validateTaskDir(taskName);
      
      expect(result.status).toBe('valid');
      expect(result.errors.length).toBe(0);
    });
  });

  describe('canRun', () => {
    it('should return ok: false if there are errors', () => {
      const taskName = '2412221530_EmptyTask';
      const taskPath = path.join(tasksDir, taskName);
      fs.mkdirSync(taskPath, { recursive: true });

      const res = taskService.canRun(taskName);
      expect(res.ok).toBe(false);
      expect(res.issues.length).toBeGreaterThan(0);
    });

    it('should return ok: true for valid task', () => {
      const taskName = '2412221530_ValidTask';
      const taskPath = path.join(tasksDir, taskName);
      fs.mkdirSync(taskPath, { recursive: true });
      
      fs.writeFileSync(path.join(taskPath, '01-lane.json'), JSON.stringify({
        tasks: [{ name: 'implement', prompt: 'p' }]
      }));

      const res = taskService.canRun(taskName);
      expect(res.ok).toBe(true);
    });
  });
});

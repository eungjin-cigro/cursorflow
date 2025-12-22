import * as fs from 'fs';
import * as path from 'path';
import { TaskService } from '../../src/utils/task-service';
import * as doctor from '../../src/utils/doctor';

jest.mock('../../src/utils/doctor');

describe('TaskService', () => {
  const tmpDir = path.join(__dirname, 'tmp-task-service');
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

  describe('listTaskDirs', () => {
    it('should return empty array if tasks directory does not exist', () => {
      const nonExistentService = new TaskService(path.join(tmpDir, 'non-existent'));
      expect(nonExistentService.listTaskDirs()).toEqual([]);
    });

    it('should list and sort task directories by timestamp', () => {
      // Create some task directories
      const task1 = '2412201000_Task1';
      const task2 = '2412211530_Task2';
      fs.mkdirSync(path.join(tasksDir, task1));
      fs.mkdirSync(path.join(tasksDir, task2));

      const dirs = taskService.listTaskDirs();
      expect(dirs.length).toBeGreaterThanOrEqual(2);
      expect(dirs[0]!.name).toBe(task2);
      expect(dirs[1]!.name).toBe(task1);
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
      expect(info!.lanes[1]!.dependsOn).toEqual(['01-lane-1']);
    });

    it('should extract correct timestamp', () => {
      const taskName = '2412221530_AuthSystem';
      const info = taskService.getTaskDirInfo(taskName);
      expect(info!.timestamp.getFullYear()).toBe(2024);
      expect(info!.timestamp.getMonth()).toBe(11); // 12월은 11
      expect(info!.timestamp.getDate()).toBe(22);
    });
  });

  describe('validateTaskDir', () => {
    it('should call runDoctor and cache results', () => {
      const mockReport: doctor.DoctorReport = {
        ok: true,
        issues: [],
        context: { cwd: '/repo', tasksDir: '/tasks/task' }
      };
      (doctor.runDoctor as jest.Mock).mockReturnValue(mockReport);

      const taskName = '2412221530_AuthSystem';
      const report = taskService.validateTaskDir(taskName);
      
      expect(report).toEqual(mockReport);
      expect(doctor.runDoctor).toHaveBeenCalled();
      
      const status = taskService.getValidationStatus(taskName);
      expect(status).toBe('valid');
    });
  });

  describe('canRun', () => {
    it('should return ok: false if there are errors', () => {
      const mockReport: doctor.DoctorReport = {
        ok: false,
        issues: [
          { id: 'err1', severity: 'error', title: 'Error', message: 'Something is wrong' }
        ],
        context: { cwd: '/repo', tasksDir: '/tasks/task' }
      };
      (doctor.runDoctor as jest.Mock).mockReturnValue(mockReport);

      const res = taskService.canRun('2412221530_AuthSystem');
      expect(res.ok).toBe(false);
      expect(res.issues).toContain('Something is wrong');
    });
  });
});

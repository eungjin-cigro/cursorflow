import { IncomingMessage, ServerResponse } from 'http';
import { Router } from '../../src/api/router';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createTaskService } from '../../src/utils/task-service';
import { createRunService } from '../../src/utils/run-service';

// Mock the service creation functions to use our temp directory
jest.mock('../../src/utils/task-service', () => {
  const original = jest.requireActual('../../src/utils/task-service');
  return {
    ...original,
    createTaskService: jest.fn(),
  };
});

jest.mock('../../src/utils/run-service', () => {
  const original = jest.requireActual('../../src/utils/run-service');
  return {
    ...original,
    createRunService: jest.fn(),
  };
});

describe('API Integration', () => {
  let router: Router;
  let tempDir: string;
  let mockRes: any;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursorflow-api-test-'));
    
    // Setup directory structure
    fs.mkdirSync(path.join(tempDir, '_cursorflow', 'tasks'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, '_cursorflow', 'logs', 'runs'), { recursive: true });

    // Create a dummy task
    const taskName = '2512261200_TestFeature';
    const taskPath = path.join(tempDir, '_cursorflow', 'tasks', taskName);
    fs.mkdirSync(taskPath);
    fs.writeFileSync(
      path.join(taskPath, '01-lane.json'),
      JSON.stringify({ tasks: [{ name: 'task1', prompt: 'do something' }] })
    );

    // Create a dummy run
    const runId = 'run-1735214400000'; // 2024-12-26
    const runPath = path.join(tempDir, '_cursorflow', 'logs', 'runs', runId);
    fs.mkdirSync(runPath);
    fs.writeFileSync(
      path.join(runPath, 'state.json'),
      JSON.stringify({ taskName: 'TestFeature', status: 'completed', lanes: {} })
    );

    // Configure mocks
    (createTaskService as jest.Mock).mockReturnValue(
      jest.requireActual('../../src/utils/task-service').createTaskService(tempDir)
    );
    (createRunService as jest.Mock).mockReturnValue(
      jest.requireActual('../../src/utils/run-service').createRunService(tempDir)
    );
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Re-instantiate router so it picks up the mocked services
    router = new Router();
    mockRes = {
      writeHead: jest.fn(),
      end: jest.fn(),
      setHeader: jest.fn(),
      write: jest.fn(),
    };
  });

  const makeRequest = (method: string, url: string, body?: any): Promise<void> => {
    const req = new EventEmitter() as any;
    req.method = method;
    req.url = url;
    req.headers = {};
    
    const promise = router.handle(req as IncomingMessage, mockRes as ServerResponse);
    
    if (body) {
      req.emit('data', Buffer.from(JSON.stringify(body)));
    }
    req.emit('end');
    
    return promise;
  };

  describe('Flows API', () => {
    it('GET /api/v1/flows should list tasks', async () => {
      await makeRequest('GET', '/api/v1/flows');
      
      expect(mockRes.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
      const response = JSON.parse(mockRes.end.mock.calls[0][0]);
      expect(response.length).toBe(1);
      expect(response[0].name).toBe('TestFeature');
    });

    it('GET /api/v1/flows/:id should return task info', async () => {
      await makeRequest('GET', '/api/v1/flows/2512261200_TestFeature');
      
      expect(mockRes.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
      const response = JSON.parse(mockRes.end.mock.calls[0][0]);
      expect(response.name).toBe('2512261200_TestFeature');
    });

    it('GET /api/v1/flows/:id/runs should return runs for that task', async () => {
      await makeRequest('GET', '/api/v1/flows/TestFeature/runs');
      
      expect(mockRes.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
      const response = JSON.parse(mockRes.end.mock.calls[0][0]);
      expect(response.length).toBe(1);
      expect(response[0].taskName).toBe('TestFeature');
    });
  });

  describe('Runs API', () => {
    it('GET /api/v1/runs should list runs', async () => {
      await makeRequest('GET', '/api/v1/runs');
      
      expect(mockRes.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
      const response = JSON.parse(mockRes.end.mock.calls[0][0]);
      expect(response.length).toBe(1);
    });

    it('GET /api/v1/runs/:id should return run info', async () => {
      await makeRequest('GET', '/api/v1/runs/run-1735214400000');
      
      expect(mockRes.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
      const response = JSON.parse(mockRes.end.mock.calls[0][0]);
      expect(response.id).toBe('run-1735214400000');
    });
  });

  describe('System API', () => {
    it('GET /api/v1/system/health should return report', async () => {
      await makeRequest('GET', '/api/v1/system/health');
      expect(mockRes.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    });
  });
});

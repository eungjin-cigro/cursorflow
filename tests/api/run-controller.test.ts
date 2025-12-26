import { IncomingMessage, ServerResponse } from 'http';
import { RunController } from '../../src/api/controllers/run-controller';
import { createRunService } from '../../src/utils/run-service';

// Mock dependencies
jest.mock('../../src/utils/run-service');

describe('RunController', () => {
  let runController: RunController;
  let mockReq: Partial<IncomingMessage>;
  let mockRes: Partial<ServerResponse>;
  let mockRunService: any;

  beforeEach(() => {
    mockRunService = {
      listRuns: jest.fn(),
      getRunInfo: jest.fn(),
      stopRun: jest.fn(),
    };
    (createRunService as jest.Mock).mockReturnValue(mockRunService);

    runController = new RunController();
    mockReq = {
      url: '/api/v1/runs',
    };
    mockRes = {
      writeHead: jest.fn(),
      end: jest.fn(),
    };
  });

  describe('listRuns', () => {
    it('should return a list of runs', async () => {
      const mockRuns = [{ id: 'run-1', status: 'running' }];
      mockRunService.listRuns.mockReturnValue(mockRuns);

      await runController.listRuns(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify(mockRuns));
    });

    it('should filter runs by status and limit', async () => {
      mockReq.url = '/api/v1/runs?status=completed&limit=5';
      await runController.listRuns(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(mockRunService.listRuns).toHaveBeenCalledWith({ status: 'completed', limit: 5 });
    });
  });

  describe('getRun', () => {
    it('should return run info if found', async () => {
      const mockRun = { id: 'run-1', status: 'running' };
      mockRunService.getRunInfo.mockReturnValue(mockRun);

      await runController.getRun(mockReq as IncomingMessage, mockRes as ServerResponse, { runId: 'run-1' });

      expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify(mockRun));
    });

    it('should return 404 if run not found', async () => {
      mockRunService.getRunInfo.mockReturnValue(null);

      await runController.getRun(mockReq as IncomingMessage, mockRes as ServerResponse, { runId: 'non-existent' });

      expect(mockRes.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({
        error: { code: 'RUN_NOT_FOUND', message: 'Run non-existent not found' }
      }));
    });
  });

  describe('stopRun', () => {
    it('should return 200 on success', async () => {
      mockRunService.stopRun.mockReturnValue(true);

      await runController.stopRun(mockReq as IncomingMessage, mockRes as ServerResponse, { runId: 'run-1' });

      expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({ success: true }));
    });

    it('should return 400 on failure', async () => {
      mockRunService.stopRun.mockReturnValue(false);

      await runController.stopRun(mockReq as IncomingMessage, mockRes as ServerResponse, { runId: 'run-1' });

      expect(mockRes.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({
        error: { code: 'STOP_FAILED', message: 'Failed to stop run run-1' }
      }));
    });
  });

  describe('sendSignal', () => {
    it('should return 200 with signal info', async () => {
      (mockReq as any).body = { type: 'pause', message: 'pausing' };

      await runController.sendSignal(mockReq as IncomingMessage, mockRes as ServerResponse, { runId: 'run-1', taskName: 'task-1' });

      expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({ success: true, signal: { type: 'pause', message: 'pausing' } }));
    });

    it('should return 400 if signal info is missing', async () => {
      (mockReq as any).body = { type: 'pause' };

      await runController.sendSignal(mockReq as IncomingMessage, mockRes as ServerResponse, { runId: 'run-1', taskName: 'task-1' });

      expect(mockRes.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({
        error: { code: 'INVALID_SIGNAL', message: 'Signal type and message are required' }
      }));
    });
  });

  describe('resumeRun', () => {
    it('should return 501 Not Implemented', async () => {
      await runController.resumeRun(mockReq as IncomingMessage, mockRes as ServerResponse, { runId: 'run-1' });

      expect(mockRes.writeHead).toHaveBeenCalledWith(501, { 'Content-Type': 'application/json' });
    });
  });

  describe('getLaneTasks', () => {
    it('should return lane tasks if run and lane found', async () => {
      const mockRun = { id: 'run-1', lanes: [{ name: 'lane-1' }] };
      mockRunService.getRunInfo.mockReturnValue(mockRun);

      await runController.getLaneTasks(mockReq as IncomingMessage, mockRes as ServerResponse, { runId: 'run-1', laneName: 'lane-1' });

      expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify([]));
    });

    it('should return 404 if lane not found', async () => {
      const mockRun = { id: 'run-1', lanes: [] };
      mockRunService.getRunInfo.mockReturnValue(mockRun);

      await runController.getLaneTasks(mockReq as IncomingMessage, mockRes as ServerResponse, { runId: 'run-1', laneName: 'lane-1' });

      expect(mockRes.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });
    });
  });

  describe('getTaskLogs', () => {
    it('should return task logs', async () => {
      mockRunService.getRunInfo.mockReturnValue({ id: 'run-1' });
      mockReq.url = '/api/v1/runs/run-1/tasks/task-1/logs?offset=10&limit=20';

      await runController.getTaskLogs(mockReq as IncomingMessage, mockRes as ServerResponse, { runId: 'run-1', taskName: 'task-1' });

      expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({ logs: [], nextOffset: 10 }));
    });
  });
});

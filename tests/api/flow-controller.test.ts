import { IncomingMessage, ServerResponse } from 'http';
import { FlowController } from '../../src/api/controllers/flow-controller';
import { createTaskService } from '../../src/utils/task-service';
import { createRunService } from '../../src/utils/run-service';

// Mock dependencies
jest.mock('../../src/utils/task-service');
jest.mock('../../src/utils/run-service');

describe('FlowController', () => {
  let flowController: FlowController;
  let mockReq: Partial<IncomingMessage>;
  let mockRes: Partial<ServerResponse>;
  let mockTaskService: any;
  let mockRunService: any;

  beforeEach(() => {
    mockTaskService = {
      listTaskDirs: jest.fn(),
      getTaskDirInfo: jest.fn(),
    };
    (createTaskService as jest.Mock).mockReturnValue(mockTaskService);

    mockRunService = {
      listRuns: jest.fn(),
    };
    (createRunService as jest.Mock).mockReturnValue(mockRunService);

    flowController = new FlowController();
    mockReq = {};
    mockRes = {
      writeHead: jest.fn(),
      end: jest.fn(),
    };
  });

  describe('listFlows', () => {
    it('should return a list of flows', async () => {
      const mockTaskDirs = [
        {
          name: 'flow-1',
          featureName: 'Feature 1',
          path: '/path/1',
          lanes: [{}, {}],
          timestamp: '2025-12-26T00:00:00Z',
          validationStatus: 'valid',
        },
      ];
      mockTaskService.listTaskDirs.mockReturnValue(mockTaskDirs);

      await flowController.listFlows(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify([
        {
          id: 'flow-1',
          name: 'Feature 1',
          path: '/path/1',
          laneCount: 2,
          timestamp: '2025-12-26T00:00:00Z',
          status: 'valid',
        },
      ]));
    });
  });

  describe('getFlow', () => {
    it('should return flow info if found', async () => {
      const mockFlow = { id: 'flow-1', name: 'Feature 1' };
      mockTaskService.getTaskDirInfo.mockReturnValue(mockFlow);

      await flowController.getFlow(mockReq as IncomingMessage, mockRes as ServerResponse, { flowId: 'flow-1' });

      expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify(mockFlow));
    });

    it('should return 404 if flow not found', async () => {
      mockTaskService.getTaskDirInfo.mockReturnValue(null);

      await flowController.getFlow(mockReq as IncomingMessage, mockRes as ServerResponse, { flowId: 'non-existent' });

      expect(mockRes.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({
        error: { code: 'FLOW_NOT_FOUND', message: 'Flow non-existent not found' }
      }));
    });
  });

  describe('createFlow', () => {
    it('should create a flow and return 201', async () => {
      (mockReq as any).body = { name: 'New Flow' };

      await flowController.createFlow(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(mockRes.writeHead).toHaveBeenCalledWith(201, { 'Content-Type': 'application/json' });
      const response = JSON.parse((mockRes.end as jest.Mock).mock.calls[0][0]);
      expect(response.name).toBe('New Flow');
      expect(response.id).toBeDefined();
    });

    it('should return 400 if name is missing', async () => {
      (mockReq as any).body = {};

      await flowController.createFlow(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(mockRes.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({
        error: { code: 'MISSING_NAME', message: 'Flow name is required' }
      }));
    });
  });

  describe('deleteFlow', () => {
    it('should return 204 on deletion', async () => {
      await flowController.deleteFlow(mockReq as IncomingMessage, mockRes as ServerResponse, { flowId: 'flow-1' });

      expect(mockRes.writeHead).toHaveBeenCalledWith(204);
      expect(mockRes.end).toHaveBeenCalled();
    });
  });

  describe('getFlowRuns', () => {
    it('should return runs for a flow', async () => {
      const mockRuns = [{ id: 'run-1', taskName: 'flow-1' }];
      mockRunService.listRuns.mockReturnValue(mockRuns);

      await flowController.getFlowRuns(mockReq as IncomingMessage, mockRes as ServerResponse, { flowId: 'flow-1' });

      expect(mockRunService.listRuns).toHaveBeenCalledWith({ taskName: 'flow-1' });
      expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify(mockRuns));
    });
  });

  describe('startRun', () => {
    it('should return 202 on run initiation', async () => {
      await flowController.startRun(mockReq as IncomingMessage, mockRes as ServerResponse, { flowId: 'flow-1' });

      expect(mockRes.writeHead).toHaveBeenCalledWith(202, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({ message: 'Run initiation accepted', flowId: 'flow-1' }));
    });
  });
});

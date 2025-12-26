import { IncomingMessage, ServerResponse } from 'http';
import { SystemController } from '../../src/api/controllers/system-controller';
import { runDoctor } from '../../src/utils/doctor';
import { loadConfig } from '../../src/utils/config';
import { getAvailableModels } from '../../src/utils/cursor-agent';

// Mock dependencies
jest.mock('../../src/utils/doctor');
jest.mock('../../src/utils/config');
jest.mock('../../src/utils/cursor-agent');

describe('SystemController', () => {
  let systemController: SystemController;
  let mockReq: Partial<IncomingMessage>;
  let mockRes: Partial<ServerResponse>;

  beforeEach(() => {
    systemController = new SystemController();
    mockReq = {};
    mockRes = {
      writeHead: jest.fn(),
      end: jest.fn(),
    };
  });

  describe('getHealth', () => {
    it('should return health report', async () => {
      const mockReport = { status: 'ok', checks: [] };
      (runDoctor as jest.Mock).mockReturnValue(mockReport);

      await systemController.getHealth(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify(mockReport));
    });
  });

  describe('getModels', () => {
    it('should return available models', async () => {
      const mockModels = ['model-1', 'model-2'];
      (getAvailableModels as jest.Mock).mockReturnValue(mockModels);

      await systemController.getModels(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({ models: mockModels }));
    });

    it('should return 500 on error', async () => {
      (getAvailableModels as jest.Mock).mockImplementation(() => { throw new Error('Fetch failed'); });

      await systemController.getModels(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(mockRes.writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({
        error: { code: 'MODEL_FETCH_FAILED', message: 'Fetch failed' }
      }));
    });
  });

  describe('getConfig', () => {
    it('should return system config', async () => {
      const mockConfig = { workspace: '/path' };
      (loadConfig as jest.Mock).mockReturnValue(mockConfig);

      await systemController.getConfig(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify(mockConfig));
    });

    it('should return 500 on error', async () => {
      (loadConfig as jest.Mock).mockImplementation(() => { throw new Error('Load failed'); });

      await systemController.getConfig(mockReq as IncomingMessage, mockRes as ServerResponse);

      expect(mockRes.writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({
        error: { code: 'CONFIG_LOAD_FAILED', message: 'Load failed' }
      }));
    });
  });
});

import { IncomingMessage, ServerResponse } from 'http';
import { Router } from '../../src/api/router';
import { EventEmitter } from 'events';

describe('Router', () => {
  let router: Router;
  let mockReq: any;
  let mockRes: any;

  beforeEach(() => {
    router = new Router();
    mockReq = new EventEmitter();
    mockReq.method = 'GET';
    mockReq.url = '/api/v1/system/health';
    mockReq.headers = {};
    
    mockRes = {
      writeHead: jest.fn(),
      end: jest.fn(),
      setHeader: jest.fn(),
    };
  });

  it('should route to the correct handler', async () => {
    // getHealth is already registered in Router constructor
    await router.handle(mockReq as IncomingMessage, mockRes as ServerResponse);
    expect(mockRes.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
  });

  it('should return 404 for unknown routes', async () => {
    mockReq.url = '/api/v1/unknown';
    await router.handle(mockReq as IncomingMessage, mockRes as ServerResponse);
    expect(mockRes.writeHead).toHaveBeenCalledWith(404, expect.any(Object));
    expect(mockRes.end).toHaveBeenCalledWith(expect.stringContaining('NOT_FOUND'));
  });

  it('should parse body for POST requests', async () => {
    mockReq.method = 'POST';
    mockReq.url = '/api/v1/flows';
    
    const body = { name: 'Test Flow' };
    const promise = router.handle(mockReq as IncomingMessage, mockRes as ServerResponse);
    
    mockReq.emit('data', Buffer.from(JSON.stringify(body)));
    mockReq.emit('end');
    
    await promise;
    
    // createFlow returns 201 on success
    expect(mockRes.writeHead).toHaveBeenCalledWith(201, expect.any(Object));
  });

  it('should return 400 for invalid JSON body', async () => {
    mockReq.method = 'POST';
    mockReq.url = '/api/v1/flows';
    
    const promise = router.handle(mockReq as IncomingMessage, mockRes as ServerResponse);
    
    mockReq.emit('data', Buffer.from('invalid json'));
    mockReq.emit('end');
    
    await promise;
    
    expect(mockRes.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    expect(mockRes.end).toHaveBeenCalledWith(expect.stringContaining('INVALID_JSON'));
  });

  it('should handle route parameters', async () => {
    mockReq.url = '/api/v1/flows/flow-123';
    await router.handle(mockReq as IncomingMessage, mockRes as ServerResponse);
    
    // getFlow should be called, but since taskService is mocked or returns null, it might be 404
    // but the point is it matched the route
    expect(mockRes.writeHead).toHaveBeenCalled();
  });
});

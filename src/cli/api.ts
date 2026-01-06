/**
 * CursorFlow API command
 * 
 * Simple REST API endpoint for demonstration
 */

import * as http from 'http';
import * as logger from '../utils/logger';

async function api(args: string[]): Promise<void> {
  const port = parseInt(args[0]) || 3000;
  
  const server = http.createServer((req, res) => {
    // Basic CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === '/hello' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'hello', status: 'ok', timestamp: new Date().toISOString() }));
      return;
    }
    
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found', path: req.url }));
  });
  
  server.listen(port, () => {
    logger.section('🚀 REST API Server');
    logger.info(`Server listening on port ${port}`);
    logger.info(`Endpoint: GET http://localhost:${port}/hello`);
    logger.info('Press Ctrl+C to stop');
  });
  
  // Keep the process alive
  return new Promise((resolve) => {
    process.on('SIGINT', () => {
      logger.info('\nStopping server...');
      server.close(() => {
        logger.success('Server stopped');
        resolve();
      });
    });
  });
}

export = api;

import * as http from 'http';
import { Router } from './router';
import * as logger from '../utils/logger';

export interface ServerOptions {
  port: number;
  host: string;
}

export class ApiServer {
  private server: http.Server;
  private router: Router;

  constructor() {
    this.router = new Router();
    this.server = http.createServer((req, res) => {
      // Enable CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      this.router.handle(req, res);
    });
  }

  start(options: ServerOptions) {
    const { port, host } = options;
    this.server.listen(port, host, () => {
      logger.info(`CursorFlow API Server running at http://${host}:${port}/api/v1`);
    });
  }

  stop() {
    this.server.close();
  }
}

/**
 * Convenience function to start the server
 */
export function startServer(port: number = 3000, host: string = 'localhost') {
  const server = new ApiServer();
  server.start({ port, host });
  return server;
}

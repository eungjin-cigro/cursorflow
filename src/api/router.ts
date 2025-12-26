import { IncomingMessage, ServerResponse } from 'http';
import { parse } from 'url';
import { FlowController } from './controllers/flow-controller';
import { RunController } from './controllers/run-controller';
import { SystemController } from './controllers/system-controller';

type Handler = (req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => Promise<void>;

interface Route {
  method: string;
  pattern: RegExp;
  handler: Handler;
  keys: string[];
}

export class Router {
  private routes: Route[] = [];
  private flowController = new FlowController();
  private runController = new RunController();
  private systemController = new SystemController();

  constructor() {
    this.setupRoutes();
  }

  private addRoute(method: string, path: string, handler: Handler) {
    const keys: string[] = [];
    const patternStr = path
      .replace(/:([^\/]+)/g, (_, key) => {
        keys.push(key);
        return '([^/]+)';
      })
      .replace(/\//g, '\\/');
    
    this.routes.push({
      method,
      pattern: new RegExp(`^${patternStr}$`),
      handler,
      keys,
    });
  }

  private setupRoutes() {
    const prefix = '/api/v1';

    // Flows
    this.addRoute('GET', `${prefix}/flows`, (req, res) => this.flowController.listFlows(req, res));
    this.addRoute('POST', `${prefix}/flows`, (req, res) => this.flowController.createFlow(req, res));
    this.addRoute('GET', `${prefix}/flows/:flowId`, (req, res, params) => this.flowController.getFlow(req, res, params));
    this.addRoute('DELETE', `${prefix}/flows/:flowId`, (req, res, params) => this.flowController.deleteFlow(req, res, params));
    this.addRoute('GET', `${prefix}/flows/:flowId/runs`, (req, res, params) => this.flowController.getFlowRuns(req, res, params));
    this.addRoute('POST', `${prefix}/flows/:flowId/runs`, (req, res, params) => this.flowController.startRun(req, res, params));

    // Runs
    this.addRoute('GET', `${prefix}/runs`, (req, res) => this.runController.listRuns(req, res));
    this.addRoute('GET', `${prefix}/runs/:runId`, (req, res, params) => this.runController.getRun(req, res, params));
    this.addRoute('POST', `${prefix}/runs/:runId/stop`, (req, res, params) => this.runController.stopRun(req, res, params));
    this.addRoute('POST', `${prefix}/runs/:runId/resume`, (req, res, params) => this.runController.resumeRun(req, res, params));
    
    // Tasks & Monitoring
    this.addRoute('GET', `${prefix}/runs/:runId/lanes/:laneName/tasks`, (req, res, params) => this.runController.getLaneTasks(req, res, params));
    this.addRoute('GET', `${prefix}/runs/:runId/tasks/:taskName/logs`, (req, res, params) => this.runController.getTaskLogs(req, res, params));
    this.addRoute('POST', `${prefix}/runs/:runId/tasks/:taskName/signal`, (req, res, params) => this.runController.sendSignal(req, res, params));

    // System
    this.addRoute('GET', `${prefix}/system/health`, (req, res) => this.systemController.getHealth(req, res));
    this.addRoute('GET', `${prefix}/system/models`, (req, res) => this.systemController.getModels(req, res));
    this.addRoute('GET', `${prefix}/system/config`, (req, res) => this.systemController.getConfig(req, res));

    // SSE
    this.addRoute('GET', `${prefix}/events`, async (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write('retry: 10000\n\n');
      
      // Heartbeat
      const timer = setInterval(() => {
        res.write(': heartbeat\n\n');
      }, 30000);

      req.on('close', () => {
        clearInterval(timer);
      });
    });
  }

  private getRequestBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        if (!body) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  async handle(req: IncomingMessage, res: ServerResponse) {
    const { pathname } = parse(req.url || '', true);
    const method = req.method || 'GET';

    // Parse body for POST/PUT
    if (method === 'POST' || method === 'PUT') {
      try {
        const body = await this.getRequestBody(req);
        (req as any).body = body;
      } catch (error: any) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'INVALID_JSON', message: 'Failed to parse JSON body' } }));
        return;
      }
    }

    for (const route of this.routes) {
      if (route.method === method) {
        const match = pathname?.match(route.pattern);
        if (match) {
          const params: Record<string, string> = {};
          route.keys.forEach((key, i) => {
            params[key] = match[i + 1]!;
          });
          
          try {
            await route.handler(req, res, params);
          } catch (error: any) {
            console.error(`Error handling ${method} ${pathname}:`, error);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { code: 'INTERNAL_SERVER_ERROR', message: error.message } }));
          }
          return;
        }
      }
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: `Route ${method} ${pathname} not found` } }));
  }
}

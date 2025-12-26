import { IncomingMessage, ServerResponse } from 'http';
import { runDoctor } from '../../utils/doctor';
import { loadConfig } from '../../utils/config';
import { getAvailableModels } from '../../utils/cursor-agent';

export class SystemController {
  /**
   * GET /system/health
   */
  async getHealth(req: IncomingMessage, res: ServerResponse) {
    const report = runDoctor();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(report));
  }

  /**
   * GET /system/models
   */
  async getModels(req: IncomingMessage, res: ServerResponse) {
    try {
      const models = getAvailableModels();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models }));
    } catch (error: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'MODEL_FETCH_FAILED', message: error.message } }));
    }
  }

  /**
   * GET /system/config
   */
  async getConfig(req: IncomingMessage, res: ServerResponse) {
    try {
      const config = loadConfig();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(config));
    } catch (error: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'CONFIG_LOAD_FAILED', message: error.message } }));
    }
  }
}

import { IncomingMessage, ServerResponse } from 'http';
import { createRunService } from '../../utils/run-service';
import { parse } from 'url';

export class RunController {
  private runService = createRunService();

  /**
   * GET /runs
   */
  async listRuns(req: IncomingMessage, res: ServerResponse) {
    const { query } = parse(req.url || '', true);
    const status = query.status as any;
    const limit = query.limit ? parseInt(query.limit as string, 10) : undefined;
    
    const runs = this.runService.listRuns({ status, limit });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(runs));
  }

  /**
   * GET /runs/{runId}
   */
  async getRun(req: IncomingMessage, res: ServerResponse, params: Record<string, string>) {
    const { runId } = params;
    const run = this.runService.getRunInfo(runId);
    
    if (!run) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'RUN_NOT_FOUND', message: `Run ${runId} not found` } }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(run));
  }

  /**
   * POST /runs/{runId}/stop
   */
  async stopRun(req: IncomingMessage, res: ServerResponse, params: Record<string, string>) {
    const { runId } = params;
    const success = this.runService.stopRun(runId);
    
    if (!success) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'STOP_FAILED', message: `Failed to stop run ${runId}` } }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true }));
  }

  /**
   * POST /runs/{runId}/tasks/{taskName}/signal
   */
  async sendSignal(req: IncomingMessage, res: ServerResponse, params: Record<string, string>) {
    const { runId, taskName } = params;
    const body = (req as any).body;
    
    if (!body.type || !body.message) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'INVALID_SIGNAL', message: 'Signal type and message are required' } }));
      return;
    }

    // Signals are usually handled via events or direct process communication
    // For now, return success placeholder
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, signal: body }));
  }

  /**
   * POST /runs/{runId}/resume
   */
  async resumeRun(req: IncomingMessage, res: ServerResponse, params: Record<string, string>) {
    // This would typically involve calling the orchestrator or a CLI command
    // For now, returning 501 Not Implemented as it's a complex operation
    res.writeHead(501, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'NOT_IMPLEMENTED', message: 'Resume functionality via API is not yet implemented' } }));
  }

  /**
   * GET /runs/{runId}/lanes/{laneName}/tasks
   */
  async getLaneTasks(req: IncomingMessage, res: ServerResponse, params: Record<string, string>) {
    const { runId, laneName } = params;
    const run = this.runService.getRunInfo(runId);
    
    if (!run) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'RUN_NOT_FOUND', message: `Run ${runId} not found` } }));
      return;
    }

    const lane = run.lanes.find(l => l.name === laneName);
    if (!lane) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'LANE_NOT_FOUND', message: `Lane ${laneName} not found in run ${runId}` } }));
      return;
    }

    // In a real implementation, we would read the actual task results from disk
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([]));
  }

  /**
   * GET /runs/{runId}/tasks/{taskName}/logs
   */
  async getTaskLogs(req: IncomingMessage, res: ServerResponse, params: Record<string, string>) {
    const { runId, taskName } = params;
    const { query } = parse(req.url || '', true);
    const offset = query.offset ? parseInt(query.offset as string, 10) : 0;
    const limit = query.limit ? parseInt(query.limit as string, 10) : 100;
    
    // This would read from the log files in the run directory
    // For now, a simplified version
    try {
      const run = this.runService.getRunInfo(runId);
      if (!run) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'RUN_NOT_FOUND', message: `Run ${runId} not found` } }));
        return;
      }

      // Logic to read logs from run.path/lanes/.../logs/taskName.log
      // Implementation omitted for brevity, returning placeholder
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ logs: [], nextOffset: offset }));
    } catch (error: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'LOG_FETCH_FAILED', message: error.message } }));
    }
  }
}

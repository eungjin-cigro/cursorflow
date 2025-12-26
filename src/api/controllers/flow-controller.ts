import { IncomingMessage, ServerResponse } from 'http';
import { createTaskService } from '../../utils/task-service';
import { createRunService } from '../../utils/run-service';
import { parse } from 'url';

export class FlowController {
  private taskService = createTaskService();
  private runService = createRunService();

  /**
   * GET /flows
   */
  async listFlows(req: IncomingMessage, res: ServerResponse) {
    const taskDirs = this.taskService.listTaskDirs();
    const flows = taskDirs.map(td => ({
      id: td.name,
      name: td.featureName,
      path: td.path,
      laneCount: td.lanes.length,
      timestamp: td.timestamp,
      status: td.validationStatus,
    }));
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(flows));
  }

  /**
   * GET /flows/{flowId}
   */
  async getFlow(req: IncomingMessage, res: ServerResponse, params: Record<string, string>) {
    const { flowId } = params;
    const taskInfo = this.taskService.getTaskDirInfo(flowId);
    
    if (!taskInfo) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'FLOW_NOT_FOUND', message: `Flow ${flowId} not found` } }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(taskInfo));
  }

  /**
   * POST /flows
   */
  async createFlow(req: IncomingMessage, res: ServerResponse) {
    const body = (req as any).body;
    if (!body.name) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'MISSING_NAME', message: 'Flow name is required' } }));
      return;
    }
    
    // In a real implementation, this would create the directory and flow.meta.json
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: `flow-${Date.now()}`, name: body.name, status: 'pending' }));
  }

  /**
   * DELETE /flows/{flowId}
   */
  async deleteFlow(req: IncomingMessage, res: ServerResponse, params: Record<string, string>) {
    const { flowId } = params;
    // In a real implementation, this would delete the task directory
    res.writeHead(204);
    res.end();
  }

  /**
   * GET /flows/{flowId}/runs
   */
  async getFlowRuns(req: IncomingMessage, res: ServerResponse, params: Record<string, string>) {
    const { flowId } = params;
    // Filter runs by flowId (which is taskName in RunInfo)
    const runs = this.runService.listRuns({ taskName: flowId });
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(runs));
  }

  /**
   * POST /flows/{flowId}/runs
   */
  async startRun(req: IncomingMessage, res: ServerResponse, params: Record<string, string>) {
    // This would trigger a 'cursorflow run' equivalent
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Run initiation accepted', flowId: params.flowId }));
  }
}

import * as fs from 'fs';
import * as path from 'path';
import { safeJoin } from './path';
import { FlowInfo, FlowStatus } from '../types/flow';
import { CursorFlowConfig } from './config';
import { TaskService } from './task-service';

/**
 * List all flows in a directory
 */
export function listFlows(flowsDir: string): FlowInfo[] {
  if (!fs.existsSync(flowsDir)) {
    return [];
  }

  const dirs = fs.readdirSync(flowsDir)
    .filter(name => {
      const dirPath = safeJoin(flowsDir, name);
      try {
        return fs.statSync(dirPath).isDirectory() && !name.startsWith('.');
      } catch {
        return false;
      }
    })
    .sort((a, b) => b.localeCompare(a)); // Most recent first

  return dirs.map(name => {
    const flowPath = safeJoin(flowsDir, name);
    const metaPath = safeJoin(flowPath, 'flow.meta.json');
    
    let meta: any = null;
    try {
      if (fs.existsSync(metaPath)) {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      }
    } catch {}

    // Parse flow name from directory (e.g., "001_TestFeature" -> "TestFeature")
    const match = name.match(/^(\d+)_(.+)$/);
    const id = match ? match[1] : name;
    const flowName = match ? match[2] : name;

    // Get lane files
    const laneFiles = fs.readdirSync(flowPath)
      .filter(f => f.endsWith('.json') && f !== 'flow.meta.json')
      .map(f => {
        const laneMatch = f.match(/^\d+-([^.]+)\.json$/);
        return laneMatch ? laneMatch[1] : f.replace('.json', '');
      });

    return {
      id,
      name: flowName,
      path: flowPath,
      timestamp: meta?.createdAt ? new Date(meta.createdAt) : new Date(fs.statSync(flowPath).mtime),
      lanes: laneFiles,
      status: (meta?.status as FlowStatus) || 'pending',
      meta: meta || undefined,
    };
  });
}

/**
 * Find the most recently created flow or legacy task directory
 */
export function findLatestFlowOrTask(config: CursorFlowConfig): string | null {
  const flowsDir = safeJoin(config.projectRoot, config.flowsDir);
  const tasksDir = safeJoin(config.projectRoot, config.tasksDir);
  
  const flows = listFlows(flowsDir);
  
  const taskService = new TaskService(tasksDir);
  const tasks = taskService.listTaskDirs();
  
  const latestFlow = flows.length > 0 ? flows[0] : null;
  const latestTask = tasks.length > 0 ? tasks[0] : null;
  
  if (!latestFlow && !latestTask) return null;
  if (!latestFlow) return latestTask!.path;
  if (!latestTask) return latestFlow!.path;
  
  // Compare by timestamp to find the truly latest
  return latestFlow.timestamp.getTime() >= latestTask.timestamp.getTime() 
    ? latestFlow.path 
    : latestTask.path;
}

/**
 * Find flow directory by name in the flows directory.
 * Matches by exact name or by suffix (ignoring ID prefix like '001_').
 * 
 * @param flowsDir The base flows directory (e.g., _cursorflow/flows)
 * @param flowName The name of the flow to find
 * @returns The absolute path to the flow directory, or null if not found
 */
export function findFlowDir(flowsDir: string, flowName: string): string | null {
  if (!fs.existsSync(flowsDir)) {
    return null;
  }

  const dirs = fs.readdirSync(flowsDir)
    .filter(name => {
      const dirPath = safeJoin(flowsDir, name);
      try {
        return fs.statSync(dirPath).isDirectory();
      } catch {
        return false;
      }
    })
    .filter(name => {
      // Match by exact name or by suffix (ignoring ID prefix)
      const match = name.match(/^\d+_(.+)$/);
      return match ? match[1] === flowName : name === flowName;
    });

  if (dirs.length === 0) {
    return null;
  }

  // Return the most recent one (highest ID / alphabetical)
  dirs.sort((a, b) => b.localeCompare(a));
  return safeJoin(flowsDir, dirs[0]!);
}




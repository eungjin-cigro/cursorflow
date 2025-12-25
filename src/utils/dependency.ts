/**
 * Dependency management utilities for CursorFlow
 * 
 * Features:
 * - Task-level cyclic dependency detection
 * - Dependency wait with timeout
 * - Topological sorting
 * 
 * Note: Lane-level dependencies have been removed.
 * Use task-level dependencies (format: "lane:task") for fine-grained control.
 */

import * as fs from 'fs';
import * as path from 'path';
import { safeJoin } from './path';
import { loadState } from './state';
import { LaneState, Task, RunnerConfig } from './types';
import * as logger from './logger';

export interface DependencyInfo {
  name: string;
  dependsOn: string[];
}

/** Task-level dependency info for cycle detection */
export interface TaskDependencyInfo {
  /** Full identifier: "lane:task" */
  id: string;
  /** Lane name */
  lane: string;
  /** Task name */
  task: string;
  /** Dependencies in "lane:task" format */
  dependsOn: string[];
}

export interface CycleDetectionResult {
  hasCycle: boolean;
  cycle: string[] | null;
  sortedOrder: string[] | null;
}

export interface DependencyWaitOptions {
  /** Maximum time to wait in milliseconds */
  timeoutMs?: number;
  /** Polling interval in milliseconds */
  pollIntervalMs?: number;
  /** Callback when timeout is reached */
  onTimeout?: 'fail' | 'warn' | 'continue';
  /** Callback for progress updates */
  onProgress?: (pending: string[], completed: string[]) => void;
}

export const DEFAULT_DEPENDENCY_WAIT_OPTIONS: Required<Omit<DependencyWaitOptions, 'onProgress'>> = {
  timeoutMs: 30 * 60 * 1000, // 30 minutes
  pollIntervalMs: 5000, // 5 seconds
  onTimeout: 'fail',
};

export interface DependencyWaitResult {
  success: boolean;
  timedOut: boolean;
  failedDependencies: string[];
  completedDependencies: string[];
  elapsedMs: number;
}

/**
 * Detect cyclic dependencies in a list of lanes
 */
export function detectCyclicDependencies(lanes: DependencyInfo[]): CycleDetectionResult {
  // Build adjacency graph
  const graph = new Map<string, Set<string>>();
  const allNodes = new Set<string>();
  
  for (const lane of lanes) {
    allNodes.add(lane.name);
    graph.set(lane.name, new Set(lane.dependsOn));
    
    // Add dependency nodes even if they're not in the list
    for (const dep of lane.dependsOn) {
      allNodes.add(dep);
      if (!graph.has(dep)) {
        graph.set(dep, new Set());
      }
    }
  }
  
  // Kahn's algorithm for topological sort with cycle detection
  const inDegree = new Map<string, number>();
  
  // Initialize in-degrees
  for (const node of allNodes) {
    inDegree.set(node, 0);
  }
  
  for (const [, deps] of graph) {
    for (const dep of deps) {
      inDegree.set(dep, (inDegree.get(dep) || 0) + 1);
    }
  }
  
  // Queue of nodes with no incoming edges
  const queue: string[] = [];
  for (const [node, degree] of inDegree) {
    if (degree === 0) {
      queue.push(node);
    }
  }
  
  const sorted: string[] = [];
  
  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);
    
    const deps = graph.get(node) || new Set();
    for (const dep of deps) {
      const newDegree = (inDegree.get(dep) || 0) - 1;
      inDegree.set(dep, newDegree);
      
      if (newDegree === 0) {
        queue.push(dep);
      }
    }
  }
  
  // If not all nodes are in sorted order, there's a cycle
  if (sorted.length !== allNodes.size) {
    // Find the cycle using DFS
    const cycle = findCycle(graph, allNodes);
    return {
      hasCycle: true,
      cycle,
      sortedOrder: null,
    };
  }
  
  return {
    hasCycle: false,
    cycle: null,
    sortedOrder: sorted,
  };
}

/**
 * Find a cycle in the graph using DFS
 */
function findCycle(graph: Map<string, Set<string>>, allNodes: Set<string>): string[] | null {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const parent = new Map<string, string>();
  
  function dfs(node: string): string | null {
    visited.add(node);
    recursionStack.add(node);
    
    const deps = graph.get(node) || new Set();
    for (const dep of deps) {
      if (!visited.has(dep)) {
        parent.set(dep, node);
        const cycleNode = dfs(dep);
        if (cycleNode) return cycleNode;
      } else if (recursionStack.has(dep)) {
        // Found a cycle
        parent.set(dep, node);
        return dep;
      }
    }
    
    recursionStack.delete(node);
    return null;
  }
  
  for (const node of allNodes) {
    if (!visited.has(node)) {
      const cycleNode = dfs(node);
      if (cycleNode) {
        // Reconstruct the cycle
        const cycle: string[] = [cycleNode];
        let current = parent.get(cycleNode);
        while (current && current !== cycleNode) {
          cycle.push(current);
          current = parent.get(current);
        }
        cycle.push(cycleNode);
        return cycle.reverse();
      }
    }
  }
  
  return null;
}

/**
 * Get topologically sorted order for lanes
 */
export function getExecutionOrder(lanes: DependencyInfo[]): string[] | null {
  const result = detectCyclicDependencies(lanes);
  
  if (result.hasCycle) {
    return null;
  }
  
  // Reverse the sorted order (we want dependencies first)
  return result.sortedOrder!.reverse();
}

/**
 * Wait for task-level dependencies with timeout and progress tracking
 */
export async function waitForTaskDependencies(
  deps: string[], 
  lanesRoot: string,
  options: DependencyWaitOptions = {}
): Promise<DependencyWaitResult> {
  const opts = { ...DEFAULT_DEPENDENCY_WAIT_OPTIONS, ...options };
  const startTime = Date.now();
  const pendingDeps = new Set(deps);
  const completedDeps: string[] = [];
  const failedDeps: string[] = [];

  if (deps.length === 0) {
    return {
      success: true,
      timedOut: false,
      failedDependencies: [],
      completedDependencies: [],
      elapsedMs: 0,
    };
  }

  logger.info(`Waiting for task dependencies: ${deps.join(', ')}`);

  while (pendingDeps.size > 0) {
    // Check timeout
    const elapsed = Date.now() - startTime;
    if (elapsed > opts.timeoutMs) {
      logger.warn(`Dependency wait timeout after ${Math.round(elapsed / 1000)}s`);
      
      if (opts.onTimeout === 'fail') {
        return {
          success: false,
          timedOut: true,
          failedDependencies: Array.from(pendingDeps),
          completedDependencies: completedDeps,
          elapsedMs: elapsed,
        };
      } else if (opts.onTimeout === 'warn') {
        logger.warn('Continuing despite timeout');
        return {
          success: true,
          timedOut: true,
          failedDependencies: [],
          completedDependencies: completedDeps,
          elapsedMs: elapsed,
        };
      }
      // 'continue' - just return success
      return {
        success: true,
        timedOut: true,
        failedDependencies: [],
        completedDependencies: completedDeps,
        elapsedMs: elapsed,
      };
    }

    for (const dep of pendingDeps) {
      const [laneName, taskName] = dep.split(':');
      
      if (!laneName || !taskName) {
        logger.warn(`Invalid dependency format: ${dep}. Expected "lane:task"`);
        pendingDeps.delete(dep);
        failedDeps.push(dep);
        continue;
      }

      const depStatePath = safeJoin(lanesRoot, laneName, 'state.json');
      
      if (!fs.existsSync(depStatePath)) {
        // Lane hasn't started yet - continue waiting
        continue;
      }

      try {
        const state = loadState<LaneState>(depStatePath);
        
        if (!state) {
          continue;
        }

        // Check if task is completed
        if (state.completedTasks && state.completedTasks.includes(taskName)) {
          logger.info(`✓ Dependency met: ${dep}`);
          pendingDeps.delete(dep);
          completedDeps.push(dep);
        } else if (state.status === 'failed') {
          // Dependency lane failed
          logger.error(`✗ Dependency failed: ${dep} (Lane ${laneName} failed)`);
          pendingDeps.delete(dep);
          failedDeps.push(dep);
        }
      } catch (e: any) {
        // Ignore parse errors, file might be being written
        logger.warn(`Error reading dependency state: ${e.message}`);
      }
    }

    // Report progress
    if (options.onProgress) {
      options.onProgress(Array.from(pendingDeps), completedDeps);
    }

    // Check for failed dependencies
    if (failedDeps.length > 0) {
      return {
        success: false,
        timedOut: false,
        failedDependencies: failedDeps,
        completedDependencies: completedDeps,
        elapsedMs: Date.now() - startTime,
      };
    }

    if (pendingDeps.size > 0) {
      await new Promise(resolve => setTimeout(resolve, opts.pollIntervalMs));
    }
  }

  return {
    success: true,
    timedOut: false,
    failedDependencies: [],
    completedDependencies: completedDeps,
    elapsedMs: Date.now() - startTime,
  };
}

/**
 * Check if a lane can start based on its dependencies
 */
export function canLaneStart(
  laneName: string,
  lanes: DependencyInfo[],
  completedLanes: Set<string>,
  failedLanes: Set<string>
): { canStart: boolean; reason?: string } {
  const lane = lanes.find(l => l.name === laneName);
  
  if (!lane) {
    return { canStart: false, reason: `Lane ${laneName} not found` };
  }
  
  for (const dep of lane.dependsOn) {
    if (failedLanes.has(dep)) {
      return { 
        canStart: false, 
        reason: `Dependency ${dep} has failed` 
      };
    }
    
    if (!completedLanes.has(dep)) {
      return { 
        canStart: false, 
        reason: `Waiting for dependency ${dep}` 
      };
    }
  }
  
  return { canStart: true };
}

/**
 * Get all transitive dependencies for a lane
 */
export function getTransitiveDependencies(
  laneName: string,
  lanes: DependencyInfo[]
): string[] {
  const laneMap = new Map(lanes.map(l => [l.name, l]));
  const visited = new Set<string>();
  const result: string[] = [];
  
  function visit(name: string): void {
    if (visited.has(name)) return;
    visited.add(name);
    
    const lane = laneMap.get(name);
    if (!lane) return;
    
    for (const dep of lane.dependsOn) {
      visit(dep);
      if (!result.includes(dep)) {
        result.push(dep);
      }
    }
  }
  
  visit(laneName);
  return result;
}

/**
 * Get lanes that depend on a given lane
 */
export function getDependentLanes(
  laneName: string,
  lanes: DependencyInfo[]
): string[] {
  return lanes
    .filter(l => l.dependsOn.includes(laneName))
    .map(l => l.name);
}

/**
 * Validate dependency configuration
 */
export function validateDependencies(lanes: DependencyInfo[]): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  const laneNames = new Set(lanes.map(l => l.name));
  
  // Check for missing dependencies
  for (const lane of lanes) {
    for (const dep of lane.dependsOn) {
      // Check if it's a task-level dependency
      if (dep.includes(':')) {
        const [depLane] = dep.split(':');
        if (!laneNames.has(depLane!)) {
          errors.push(`Lane "${lane.name}" depends on unknown lane "${depLane}"`);
        }
      } else if (!laneNames.has(dep)) {
        errors.push(`Lane "${lane.name}" depends on unknown lane "${dep}"`);
      }
    }
  }
  
  // Check for cycles
  const cycleResult = detectCyclicDependencies(lanes);
  if (cycleResult.hasCycle && cycleResult.cycle) {
    errors.push(`Cyclic dependency detected: ${cycleResult.cycle.join(' -> ')}`);
  }
  
  // Warning for deeply nested dependencies
  for (const lane of lanes) {
    const transitive = getTransitiveDependencies(lane.name, lanes);
    if (transitive.length > 5) {
      warnings.push(`Lane "${lane.name}" has ${transitive.length} transitive dependencies`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Print dependency graph to console
 */
export function printDependencyGraph(lanes: DependencyInfo[]): void {
  const cycleResult = detectCyclicDependencies(lanes);
  
  logger.section('📊 Dependency Graph');
  
  if (cycleResult.hasCycle) {
    logger.error(`⚠️  Cyclic dependency detected: ${cycleResult.cycle?.join(' -> ')}`);
    console.log('');
  }
  
  for (const lane of lanes) {
    const deps = lane.dependsOn.length > 0 
      ? ` [depends on: ${lane.dependsOn.join(', ')}]` 
      : '';
    console.log(`  ${logger.COLORS.cyan}${lane.name}${logger.COLORS.reset}${deps}`);
    
    for (let i = 0; i < lane.dependsOn.length; i++) {
      const isLast = i === lane.dependsOn.length - 1;
      const prefix = isLast ? '└─' : '├─';
      console.log(`    ${prefix} ${lane.dependsOn[i]}`);
    }
  }
  
  if (cycleResult.sortedOrder) {
    console.log('');
    console.log(`  Execution order: ${cycleResult.sortedOrder.reverse().join(' → ')}`);
  }
  
  console.log('');
}

// ============================================================================
// Task-Level Dependency Detection (New)
// ============================================================================

/**
 * Extract all task dependencies from lane configuration files
 */
export function extractTaskDependencies(tasksDir: string): TaskDependencyInfo[] {
  if (!fs.existsSync(tasksDir)) {
    return [];
  }
  
  const tasks: TaskDependencyInfo[] = [];
  const files = fs.readdirSync(tasksDir).filter(f => f.endsWith('.json'));
  
  for (const file of files) {
    const filePath = safeJoin(tasksDir, file);
    const laneName = path.basename(file, '.json');
    
    try {
      const config = JSON.parse(fs.readFileSync(filePath, 'utf8')) as RunnerConfig;
      
      for (const task of config.tasks || []) {
        const taskId = `${laneName}:${task.name}`;
        tasks.push({
          id: taskId,
          lane: laneName,
          task: task.name,
          dependsOn: task.dependsOn || [],
        });
      }
    } catch (e) {
      logger.warn(`Failed to parse task config from ${file}: ${e}`);
    }
  }
  
  return tasks;
}

/**
 * Detect cyclic dependencies in task-level dependencies
 */
export function detectTaskCyclicDependencies(tasks: TaskDependencyInfo[]): CycleDetectionResult {
  // Build adjacency graph using task IDs (lane:task format)
  const graph = new Map<string, Set<string>>();
  const allNodes = new Set<string>();
  
  for (const task of tasks) {
    allNodes.add(task.id);
    graph.set(task.id, new Set(task.dependsOn));
    
    // Add dependency nodes even if they're not in the list
    for (const dep of task.dependsOn) {
      allNodes.add(dep);
      if (!graph.has(dep)) {
        graph.set(dep, new Set());
      }
    }
  }
  
  // Kahn's algorithm for topological sort with cycle detection
  const inDegree = new Map<string, number>();
  
  // Initialize in-degrees
  for (const node of allNodes) {
    inDegree.set(node, 0);
  }
  
  for (const [, deps] of graph) {
    for (const dep of deps) {
      inDegree.set(dep, (inDegree.get(dep) || 0) + 1);
    }
  }
  
  // Queue of nodes with no incoming edges
  const queue: string[] = [];
  for (const [node, degree] of inDegree) {
    if (degree === 0) {
      queue.push(node);
    }
  }
  
  const sorted: string[] = [];
  
  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);
    
    const deps = graph.get(node) || new Set();
    for (const dep of deps) {
      const newDegree = (inDegree.get(dep) || 0) - 1;
      inDegree.set(dep, newDegree);
      
      if (newDegree === 0) {
        queue.push(dep);
      }
    }
  }
  
  // If not all nodes are in sorted order, there's a cycle
  if (sorted.length !== allNodes.size) {
    const cycle = findTaskCycle(graph, allNodes);
    return {
      hasCycle: true,
      cycle,
      sortedOrder: null,
    };
  }
  
  return {
    hasCycle: false,
    cycle: null,
    sortedOrder: sorted,
  };
}

/**
 * Find a cycle in task dependency graph using DFS
 */
function findTaskCycle(graph: Map<string, Set<string>>, allNodes: Set<string>): string[] | null {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const parent = new Map<string, string>();
  
  function dfs(node: string): string | null {
    visited.add(node);
    recursionStack.add(node);
    
    const deps = graph.get(node) || new Set();
    for (const dep of deps) {
      if (!visited.has(dep)) {
        parent.set(dep, node);
        const cycleNode = dfs(dep);
        if (cycleNode) return cycleNode;
      } else if (recursionStack.has(dep)) {
        // Found a cycle
        parent.set(dep, node);
        return dep;
      }
    }
    
    recursionStack.delete(node);
    return null;
  }
  
  for (const node of allNodes) {
    if (!visited.has(node)) {
      const cycleNode = dfs(node);
      if (cycleNode) {
        // Reconstruct the cycle
        const cycle: string[] = [cycleNode];
        let current = parent.get(cycleNode);
        while (current && current !== cycleNode) {
          cycle.push(current);
          current = parent.get(current);
        }
        cycle.push(cycleNode);
        return cycle.reverse();
      }
    }
  }
  
  return null;
}

/**
 * Validate task-level dependencies across all lanes
 */
export function validateTaskDependencies(tasksDir: string): {
  valid: boolean;
  errors: string[];
  warnings: string[];
  tasks: TaskDependencyInfo[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  const tasks = extractTaskDependencies(tasksDir);
  const taskIds = new Set(tasks.map(t => t.id));
  const laneNames = new Set(tasks.map(t => t.lane));
  
  // Check for missing dependencies
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      // Validate format
      if (!dep.includes(':')) {
        errors.push(`Task "${task.id}" has invalid dependency format "${dep}". Expected "lane:task".`);
        continue;
      }
      
      const [depLane, depTask] = dep.split(':');
      
      // Check if lane exists
      if (!laneNames.has(depLane!)) {
        errors.push(`Task "${task.id}" depends on unknown lane "${depLane}"`);
        continue;
      }
      
      // Check if task exists (warning only, since task might be created later)
      if (!taskIds.has(dep)) {
        warnings.push(`Task "${task.id}" depends on "${dep}" which doesn't exist yet`);
      }
      
      // Check for self-dependency
      if (dep === task.id) {
        errors.push(`Task "${task.id}" depends on itself`);
      }
    }
  }
  
  // Check for cycles
  const cycleResult = detectTaskCyclicDependencies(tasks);
  if (cycleResult.hasCycle && cycleResult.cycle) {
    errors.push(`Cyclic task dependency detected: ${cycleResult.cycle.join(' → ')}`);
  }
  
  // Warning for deeply nested dependencies
  const dependencyCounts = new Map<string, number>();
  for (const task of tasks) {
    let count = 0;
    const visited = new Set<string>();
    const queue = [...task.dependsOn];
    
    while (queue.length > 0) {
      const dep = queue.shift()!;
      if (visited.has(dep)) continue;
      visited.add(dep);
      count++;
      
      const depTask = tasks.find(t => t.id === dep);
      if (depTask) {
        queue.push(...depTask.dependsOn);
      }
    }
    
    dependencyCounts.set(task.id, count);
    if (count > 10) {
      warnings.push(`Task "${task.id}" has ${count} transitive dependencies`);
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    tasks,
  };
}

/**
 * Print task-level dependency graph to console
 */
export function printTaskDependencyGraph(tasks: TaskDependencyInfo[]): void {
  const cycleResult = detectTaskCyclicDependencies(tasks);
  
  logger.section('📊 Task Dependency Graph');
  
  if (cycleResult.hasCycle) {
    logger.error(`⚠️  Cyclic dependency detected: ${cycleResult.cycle?.join(' → ')}`);
    console.log('');
  }
  
  // Group tasks by lane
  const byLane = new Map<string, TaskDependencyInfo[]>();
  for (const task of tasks) {
    const existing = byLane.get(task.lane) || [];
    existing.push(task);
    byLane.set(task.lane, existing);
  }
  
  for (const [lane, laneTasks] of byLane) {
    console.log(`  ${logger.COLORS.cyan}${lane}${logger.COLORS.reset}`);
    
    for (const task of laneTasks) {
      const deps = task.dependsOn.length > 0 
        ? ` → ${task.dependsOn.join(', ')}` 
        : '';
      console.log(`    • ${task.task}${logger.COLORS.gray}${deps}${logger.COLORS.reset}`);
    }
  }
  
  if (cycleResult.sortedOrder) {
    console.log('');
    const order = cycleResult.sortedOrder.reverse();
    if (order.length <= 10) {
      console.log(`  Execution order: ${order.join(' → ')}`);
    } else {
      console.log(`  Execution order: ${order.slice(0, 5).join(' → ')} ... (${order.length} total)`);
    }
  }
  
  console.log('');
}


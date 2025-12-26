/**
 * CursorFlow tasks command
 *
 * Usage:
 *   cursorflow tasks              # List all flows (new) and tasks (legacy)
 *   cursorflow tasks --flows      # List only flows
 *   cursorflow tasks --legacy     # List only legacy tasks
 *   cursorflow tasks --validate   # List with validation
 *   cursorflow tasks <name>       # Show detailed info
 */

import * as fs from 'fs';
import * as path from 'path';
import * as logger from '../utils/logger';
import { TaskService, TaskDirInfo, ValidationStatus } from '../utils/task-service';
import { findProjectRoot, loadConfig, getTasksDir, getFlowsDir } from '../utils/config';
import { safeJoin } from '../utils/path';
import { listFlows } from '../utils/flow';
import { FlowInfo } from '../types/flow';

const COLORS = logger.COLORS;

interface TasksCliOptions {
  validate: boolean;
  taskName: string | null;
  flowsOnly: boolean;
  legacyOnly: boolean;
}

function printHelp(): void {
  console.log(`
Usage: cursorflow tasks [options] [name]

List and view flows (new) and prepared tasks (legacy).

Options:
  --flows                Show only flows (from _cursorflow/flows/)
  --legacy               Show only legacy tasks (from _cursorflow/tasks/)
  --validate             Run validation before listing
  --help, -h             Show help

Examples:
  cursorflow tasks                    # List all flows and tasks
  cursorflow tasks --flows            # List only flows
  cursorflow tasks TestFeature        # Show flow or task details
  cursorflow tasks --validate         # Validate all entries
  `);
}

function parseArgs(args: string[]): TasksCliOptions {
  const options: TasksCliOptions = {
    validate: args.includes('--validate'),
    taskName: null,
    flowsOnly: args.includes('--flows'),
    legacyOnly: args.includes('--legacy'),
  };

  const nameArg = args.find(arg => !arg.startsWith('-'));
  if (nameArg) {
    options.taskName = nameArg;
  }

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  return options;
}

/**
 * Get flow info by name
 */
function getFlowInfo(flowsDir: string, flowName: string): FlowInfo | null {
  const flows = listFlows(flowsDir);
  return flows.find(f => f.name === flowName || `${f.id}_${f.name}` === flowName) || null;
}

/**
 * Print flows list
 */
function printFlowsList(flows: FlowInfo[]): void {
  if (flows.length === 0) {
    logger.info('No flows found in _cursorflow/flows/');
    return;
  }

  console.log(`${COLORS.bold}Flows:${COLORS.reset}`);
  
  for (let i = 0; i < flows.length; i++) {
    const flow = flows[i]!;
    const prefix = i === 0 ? '  ▶' : '   ';
    const name = `${flow.id}_${flow.name}`.padEnd(30);
    const lanes = `${flow.lanes.length} lane${flow.lanes.length !== 1 ? 's' : ''}`.padEnd(10);
    const status = flow.status.padEnd(10);
    const date = formatDate(flow.timestamp);
    
    let color = COLORS.reset;
    if (flow.status === 'completed') color = COLORS.green;
    else if (flow.status === 'running') color = COLORS.cyan;
    else if (flow.status === 'failed') color = COLORS.red;

    console.log(`${color}${prefix} ${name} ${lanes} ${status} ${date}${COLORS.reset}`);
  }
}

/**
 * Print flow details
 */
function printFlowDetail(flow: FlowInfo, flowsDir: string): void {
  console.log(`${COLORS.bold}Flow: ${flow.name}${COLORS.reset}`);
  console.log(`${COLORS.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.reset}`);
  console.log(`  ID: ${flow.id}`);
  console.log(`  Status: ${flow.status}`);
  console.log(`  Path: ${flow.path}`);
  console.log('');

  if (flow.lanes.length === 0) {
    console.log('No lanes defined.');
  } else {
    console.log(`${COLORS.bold}Lanes:${COLORS.reset}`);
    for (const laneName of flow.lanes) {
      // Read lane file for task info
      const laneFiles = fs.readdirSync(flow.path)
        .filter(f => f.endsWith('.json') && f !== 'flow.meta.json');
      
      const laneFile = laneFiles.find(f => {
        const match = f.match(/^\d+-([^.]+)\.json$/);
        return match && match[1] === laneName;
      });

      if (laneFile) {
        try {
          const laneData = JSON.parse(fs.readFileSync(safeJoin(flow.path, laneFile), 'utf-8'));
          const tasks = laneData.tasks || [];
          const taskFlow = tasks.map((t: any) => t.name).join(' → ');
          console.log(`  ${laneName.padEnd(18)} ${COLORS.blue}[${tasks.length} tasks]${COLORS.reset} ${taskFlow}`);
        } catch {
          console.log(`  ${laneName.padEnd(18)} ${COLORS.yellow}[error reading]${COLORS.reset}`);
        }
      } else {
        console.log(`  ${laneName}`);
      }
    }
  }
  
  console.log('');
  console.log(`${COLORS.gray}Run: cursorflow run ${flow.name}${COLORS.reset}`);
}

function formatDate(date: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

function getStatusLabel(info: TaskDirInfo): string {
  const status = info.validationStatus;
  const icon = status === 'valid' ? '✅' : status === 'warnings' ? '⚠️' : status === 'errors' ? '❌' : '❓';
  
  if (status === 'valid') return `${icon} Valid`;
  if (status === 'warnings') return `${icon} Warnings`;
  if (status === 'errors') return `${icon} Errors`;
  
  return `${icon} Unknown`;
}

function printTasksList(tasks: TaskDirInfo[]): void {
  if (tasks.length === 0) {
    logger.info('No tasks found in _cursorflow/tasks/');
    return;
  }

  console.log(`${COLORS.bold}Prepared Tasks:${COLORS.reset}`);
  
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const prefix = i === 0 ? '  ▶' : '   ';
    const name = task.name.padEnd(30);
    const lanes = `${task.lanes.length} lane${task.lanes.length > 1 ? 's' : ''}`.padEnd(10);
    const status = getStatusLabel(task).padEnd(14);
    const date = formatDate(task.timestamp);
    
    let color = COLORS.reset;
    if (task.validationStatus === 'errors') color = COLORS.red;
    else if (task.validationStatus === 'warnings') color = COLORS.yellow;
    else if (task.validationStatus === 'valid') color = COLORS.green;

    console.log(`${color}${prefix} ${name} ${lanes} ${status} ${date}${COLORS.reset}`);
  }
}

function printTaskDetail(info: TaskDirInfo): void {
  console.log(`${COLORS.bold}Task: ${info.name}${COLORS.reset}`);
  console.log(`${COLORS.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.reset}`);
  
  if (info.lanes.length === 0) {
    console.log('No lanes defined.');
  } else {
    console.log(`${COLORS.bold}Lanes:${COLORS.reset}`);
    for (const lane of info.lanes) {
      const fileName = lane.fileName.padEnd(18);
      const preset = `[${lane.preset}]`.padEnd(10);
      const flow = lane.taskFlow;
      
      console.log(`  ${fileName} ${COLORS.blue}${preset}${COLORS.reset} ${flow}`);
    }
  }

}

async function tasks(args: string[]): Promise<void> {
  const options = parseArgs(args);
  const projectRoot = findProjectRoot();
  const config = loadConfig(projectRoot);
  const flowsDir = getFlowsDir(config);
  const tasksDir = getTasksDir(config);
  const taskService = new TaskService(tasksDir);

  // Check for specific flow/task by name
  if (options.taskName) {
    // First try to find as a flow
    const flowInfo = getFlowInfo(flowsDir, options.taskName);
    if (flowInfo) {
      printFlowDetail(flowInfo, flowsDir);
      return;
    }
    
    // Then try as a legacy task
    const taskInfo = taskService.getTaskDirInfo(options.taskName);
    if (taskInfo) {
    taskService.validateTaskDir(options.taskName);
    const updatedInfo = taskService.getTaskDirInfo(options.taskName)!;
    printTaskDetail(updatedInfo);
      return;
    }
    
    logger.error(`Flow or task not found: ${options.taskName}`);
    process.exit(1);
  }

  // List flows and/or tasks
  const flows = options.legacyOnly ? [] : listFlows(flowsDir);
  let taskList = options.flowsOnly ? [] : taskService.listTaskDirs();
    
  if (options.validate && taskList.length > 0) {
      const spinner = logger.createSpinner('Validating tasks...');
      spinner.start();
      for (const task of taskList) {
        taskService.validateTaskDir(task.name);
      }
      spinner.succeed('Validation complete');
      taskList = taskService.listTaskDirs();
    }
    
  // Print results
  if (flows.length > 0) {
    printFlowsList(flows);
    if (taskList.length > 0) {
      console.log('');
    }
  }
  
  if (taskList.length > 0) {
    console.log(`${COLORS.gray}Legacy Tasks:${COLORS.reset}`);
    printTasksList(taskList);
  }
  
  if (flows.length === 0 && taskList.length === 0) {
    logger.info('No flows or tasks found.');
    console.log('');
    console.log('Create a new flow:');
    console.log('  cursorflow new <FlowName> --lanes "lane1,lane2"');
  }
}

export = tasks;

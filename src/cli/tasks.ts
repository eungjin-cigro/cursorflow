/**
 * CursorFlow tasks command
 *
 * Usage:
 *   cursorflow tasks              # List all tasks
 *   cursorflow tasks --validate   # List all tasks with validation
 *   cursorflow tasks <name>       # Show detailed task info
 */

import * as logger from '../utils/logger';
import { TaskService, TaskDirInfo, ValidationStatus } from '../utils/task-service';
import { findProjectRoot, loadConfig, getTasksDir } from '../utils/config';

const COLORS = logger.COLORS;

interface TasksCliOptions {
  validate: boolean;
  taskName: string | null;
}

function printHelp(): void {
  console.log(`
Usage: cursorflow tasks [options] [task-name]

Manage and view prepared tasks in _cursorflow/tasks/.

Options:
  --validate             Run validation on all tasks before listing
  --help, -h             Show help

Examples:
  cursorflow tasks
  cursorflow tasks --validate
  cursorflow tasks 2412221530_AuthSystem
  `);
}

function parseArgs(args: string[]): TasksCliOptions {
  const options: TasksCliOptions = {
    validate: args.includes('--validate'),
    taskName: null,
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
      const depends = lane.dependsOn.length > 0 ? ` ${COLORS.gray}(depends: ${lane.dependsOn.join(', ')})${COLORS.reset}` : '';
      
      console.log(`  ${fileName} ${COLORS.blue}${preset}${COLORS.reset} ${flow}${depends}`);
    }
  }

}

async function tasks(args: string[]): Promise<void> {
  const options = parseArgs(args);
  const projectRoot = findProjectRoot();
  const config = loadConfig(projectRoot);
  const tasksDir = getTasksDir(config);
  const taskService = new TaskService(tasksDir);

  if (options.taskName) {
    const info = taskService.getTaskDirInfo(options.taskName);
    if (!info) {
      logger.error(`Task not found: ${options.taskName}`);
      process.exit(1);
    }
    
    // Always validate for detail view to have report
    taskService.validateTaskDir(options.taskName);
    const updatedInfo = taskService.getTaskDirInfo(options.taskName)!;
    
    printTaskDetail(updatedInfo);
  } else {
    let taskList = taskService.listTaskDirs();
    
    if (options.validate) {
      const spinner = logger.createSpinner('Validating tasks...');
      spinner.start();
      for (const task of taskList) {
        taskService.validateTaskDir(task.name);
      }
      spinner.succeed('Validation complete');
      taskList = taskService.listTaskDirs();
    }
    
    printTasksList(taskList);
  }
}

export = tasks;

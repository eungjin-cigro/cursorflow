/**
 * CursorFlow doctor command
 *
 * Usage:
 *   cursorflow doctor [options]
 *
 * Options:
 *   --json                 Output machine-readable JSON
 *   --tasks-dir <path>     Also validate lane files (run preflight)
 *   --executor <type>      cursor-agent | cloud
 *   --no-cursor            Skip Cursor Agent install/auth checks
 *   --help, -h             Show help
 */

import * as logger from '../utils/logger';
import * as path from 'path';
import * as fs from 'fs';
import { runDoctor, saveDoctorStatus } from '../utils/doctor';
import { runInteractiveAgentTest } from '../utils/cursor-agent';
import { loadConfig, findProjectRoot } from '../utils/config';
import { safeJoin } from '../utils/path';
import { findFlowDir } from '../utils/flow';

interface DoctorCliOptions {
  json: boolean;
  tasksDir: string | null;
  flowOrTaskName: string | null;
  executor: string | null;
  includeCursorAgentChecks: boolean;
  testAgent: boolean;
}

function printHelp(): void {
  console.log(`
Usage: cursorflow doctor [flow-name] [options]

Verify your environment is ready for CursorFlow runs.

Arguments:
  [flow-name]            Flow or task name to validate (optional)

Options:
  --json                 Output machine-readable JSON
  --tasks-dir <path>     Validate specific directory (legacy)
  --executor <type>      cursor-agent | cloud
  --no-cursor            Skip Cursor Agent install/auth checks
  --test-agent           Run interactive agent test (to approve MCP/permissions)
  --help, -h             Show help

Examples:
  cursorflow doctor
  cursorflow doctor TestFeature
  cursorflow doctor --test-agent
  cursorflow doctor --tasks-dir _cursorflow/flows/001_TestFeature
  `);
}

function parseArgs(args: string[]): DoctorCliOptions {
  const tasksDirIdx = args.indexOf('--tasks-dir');
  const executorIdx = args.indexOf('--executor');
  
  // Find positional argument (flow/task name)
  // Exclude args that are values for options
  const optionValueIndices = new Set<number>();
  if (tasksDirIdx >= 0 && tasksDirIdx + 1 < args.length) optionValueIndices.add(tasksDirIdx + 1);
  if (executorIdx >= 0 && executorIdx + 1 < args.length) optionValueIndices.add(executorIdx + 1);
  
  const flowOrTaskName = args.find((arg, idx) => 
    !arg.startsWith('--') && !optionValueIndices.has(idx)
  ) || null;

  const options: DoctorCliOptions = {
    json: args.includes('--json'),
    tasksDir: tasksDirIdx >= 0 ? (args[tasksDirIdx + 1] || null) : null,
    flowOrTaskName,
    executor: executorIdx >= 0 ? (args[executorIdx + 1] || null) : null,
    includeCursorAgentChecks: !args.includes('--no-cursor'),
    testAgent: args.includes('--test-agent'),
  };

  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  return options;
}

function printHumanReport(report: ReturnType<typeof runDoctor>): void {
  logger.section('🩺 CursorFlow Doctor');
  logger.info(`cwd: ${report.context.cwd}`);
  if (report.context.repoRoot) logger.info(`repo: ${report.context.repoRoot}`);
  if (report.context.tasksDir) logger.info(`tasks: ${report.context.tasksDir}`);

  if (report.issues.length === 0) {
    logger.success('All checks passed');
    console.log('\n💡 Tip: If this is your first run, we recommend running:');
    console.log('   cursorflow doctor --test-agent\n');
    return;
  }

  for (const issue of report.issues) {
    const header = `${issue.title} (${issue.id})`;
    if (issue.severity === 'error') {
      logger.error(header, '❌');
    } else {
      logger.warn(header, '⚠️');
    }

    console.log(`   ${issue.message}`);

    if (issue.details) {
      console.log(`   Details: ${issue.details}`);
    }

    if (issue.fixes && issue.fixes.length > 0) {
      console.log('   Fix:');
      for (const fix of issue.fixes) {
        console.log(`     - ${fix}`);
      }
    }

    console.log('');
  }

  if (report.ok) {
    logger.success('Doctor completed with warnings');
  } else {
    logger.error('Doctor found blocking issues');
  }
}

async function doctor(args: string[]): Promise<void> {
  const options = parseArgs(args);

  if (options.testAgent) {
    const success = runInteractiveAgentTest();
    process.exit(success ? 0 : 1);
  }

  // Resolve tasksDir from flow name if provided
  let tasksDir = options.tasksDir;
  if (!tasksDir && options.flowOrTaskName) {
    try {
      const config = loadConfig();
      const flowsDir = safeJoin(config.projectRoot, config.flowsDir);
      const foundFlow = findFlowDir(flowsDir, options.flowOrTaskName);
      if (foundFlow) {
        tasksDir = foundFlow;
      } else {
        // Try as a direct path
        const directPath = path.resolve(process.cwd(), options.flowOrTaskName);
        if (fs.existsSync(directPath)) {
          tasksDir = directPath;
        } else {
          tasksDir = options.flowOrTaskName;
        }
      }
    } catch {
      tasksDir = options.flowOrTaskName;
    }
  }

  const report = runDoctor({
    cwd: process.cwd(),
    tasksDir: tasksDir || undefined,
    executor: options.executor || undefined,
    includeCursorAgentChecks: options.includeCursorAgentChecks,
  });

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanReport(report);
  }

  // Save successful doctor run status
  if (report.ok && report.context.repoRoot) {
    saveDoctorStatus(report.context.repoRoot, report);
  }

  process.exit(report.ok ? 0 : 1);
}

export = doctor;



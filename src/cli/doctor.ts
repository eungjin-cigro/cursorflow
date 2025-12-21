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
import { runDoctor, saveDoctorStatus } from '../utils/doctor';

interface DoctorCliOptions {
  json: boolean;
  tasksDir: string | null;
  executor: string | null;
  includeCursorAgentChecks: boolean;
}

function printHelp(): void {
  console.log(`
Usage: cursorflow doctor [options]

Verify your environment is ready for CursorFlow runs.

Options:
  --json                 Output machine-readable JSON
  --tasks-dir <path>     Also validate lane files (run preflight)
  --executor <type>      cursor-agent | cloud
  --no-cursor            Skip Cursor Agent install/auth checks
  --help, -h             Show help

Examples:
  cursorflow doctor
  cursorflow doctor --tasks-dir _cursorflow/tasks/demo-test/
  cursorflow doctor --json
  `);
}

function parseArgs(args: string[]): DoctorCliOptions {
  const tasksDirIdx = args.indexOf('--tasks-dir');
  const executorIdx = args.indexOf('--executor');

  const options: DoctorCliOptions = {
    json: args.includes('--json'),
    tasksDir: tasksDirIdx >= 0 ? (args[tasksDirIdx + 1] || null) : null,
    executor: executorIdx >= 0 ? (args[executorIdx + 1] || null) : null,
    includeCursorAgentChecks: !args.includes('--no-cursor'),
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

  const report = runDoctor({
    cwd: process.cwd(),
    tasksDir: options.tasksDir || undefined,
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



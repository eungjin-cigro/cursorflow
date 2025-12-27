/**
 * Real Execution Runner
 * 
 * Executes actual CLI commands and collects results for smoke testing.
 * Unlike mock-based tests, this runs the real cursorflow CLI.
 */

import { spawn, SpawnOptions, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { TerminalVerifier } from './terminal-verifier';

/**
 * Result of a CLI execution
 */
export interface ExecutionResult {
  /** Exit code (null if timed out or killed) */
  exitCode: number | null;
  /** Captured stdout */
  stdout: string;
  /** Captured stderr */
  stderr: string;
  /** Combined output (stdout + stderr in order received) */
  combined: string;
  /** Execution duration in milliseconds */
  duration: number;
  /** Whether execution timed out */
  timedOut: boolean;
  /** Whether execution was killed */
  killed: boolean;
  /** Collected artifacts */
  artifacts: ExecutionArtifacts;
  /** Terminal verifier for output assertions */
  verifier: TerminalVerifier;
}

/**
 * Artifacts collected from execution
 */
export interface ExecutionArtifacts {
  /** State files found in run directory */
  stateFiles: string[];
  /** Log files found */
  logFiles: string[];
  /** Run directory path (if created) */
  runDir?: string;
}

/**
 * Options for running a command
 */
export interface RunOptions {
  /** Working directory */
  cwd: string;
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Environment variables to set */
  env?: Record<string, string>;
  /** Arguments to pass */
  args?: string[];
  /** Directory to scan for artifacts after execution */
  artifactDir?: string;
}

/**
 * Run cursorflow CLI command
 */
export async function runCursorflowCommand(
  command: string,
  options: RunOptions
): Promise<ExecutionResult> {
  const {
    cwd,
    timeout = 30000,
    env = {},
    args = [],
    artifactDir,
  } = options;

  const verifier = new TerminalVerifier();
  const combinedOutput: string[] = [];
  const startTime = Date.now();
  let timedOut = false;
  let killed = false;

  // Build the command
  const cursorflowPath = path.resolve(__dirname, '../../dist/cli/index.js');
  const allArgs = [cursorflowPath, command, ...args];

  // Merge environment
  const fullEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...env,
    // Disable color output for easier parsing
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  };

  const spawnOptions: SpawnOptions = {
    cwd,
    env: fullEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  };

  return new Promise((resolve) => {
    const child = spawn('node', allArgs, spawnOptions);
    let timeoutId: NodeJS.Timeout | undefined;

    // Set up timeout
    if (timeout > 0) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        // Force kill after 5 seconds
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL');
          }
        }, 5000);
      }, timeout);
    }

    // Capture output
    child.stdout?.on('data', (data) => {
      verifier.capture(data);
      combinedOutput.push(data.toString());
    });

    child.stderr?.on('data', (data) => {
      verifier.captureStderr(data);
      combinedOutput.push(data.toString());
    });

    // Handle exit
    child.on('exit', (code, signal) => {
      if (timeoutId) clearTimeout(timeoutId);
      killed = signal !== null;

      const duration = Date.now() - startTime;
      const artifacts = collectArtifacts(artifactDir || cwd);

      resolve({
        exitCode: code,
        stdout: verifier.getStdout(),
        stderr: verifier.getStderr(),
        combined: combinedOutput.join(''),
        duration,
        timedOut,
        killed,
        artifacts,
        verifier,
      });
    });

    // Handle error (process couldn't be spawned)
    child.on('error', (err) => {
      if (timeoutId) clearTimeout(timeoutId);
      const duration = Date.now() - startTime;

      resolve({
        exitCode: null,
        stdout: verifier.getStdout(),
        stderr: `Process error: ${err.message}`,
        combined: `Process error: ${err.message}`,
        duration,
        timedOut: false,
        killed: false,
        artifacts: { stateFiles: [], logFiles: [] },
        verifier,
      });
    });
  });
}

/**
 * Run cursorflow with version flag
 */
export async function runVersion(cwd: string): Promise<ExecutionResult> {
  return runCursorflowCommand('--version', { cwd, timeout: 10000, args: [] });
}

/**
 * Run cursorflow doctor
 */
export async function runDoctor(
  cwd: string,
  options?: { json?: boolean; timeout?: number }
): Promise<ExecutionResult> {
  const args: string[] = [];
  if (options?.json) {
    args.push('--json');
  }
  return runCursorflowCommand('doctor', {
    cwd,
    timeout: options?.timeout || 30000,
    args,
  });
}

/**
 * Run cursorflow run command
 */
export async function runOrchestration(
  tasksDir: string,
  options: RunOptions & {
    dryRun?: boolean;
    skipDoctor?: boolean;
  }
): Promise<ExecutionResult> {
  const args = [...(options.args || [])];
  if (options.dryRun) {
    args.push('--dry-run');
  }
  if (options.skipDoctor) {
    args.push('--skip-doctor');
  }
  args.push(tasksDir);

  return runCursorflowCommand('run', {
    ...options,
    args,
  });
}

/**
 * Collect artifacts from a directory
 */
function collectArtifacts(baseDir: string): ExecutionArtifacts {
  const artifacts: ExecutionArtifacts = {
    stateFiles: [],
    logFiles: [],
  };

  try {
    // Look for _cursorflow directory
    const cursorflowDir = path.join(baseDir, '_cursorflow');
    if (fs.existsSync(cursorflowDir)) {
      const logsDir = path.join(cursorflowDir, 'logs');
      if (fs.existsSync(logsDir)) {
        // Find latest run directory
        const runDirs = fs.readdirSync(logsDir)
          .filter(d => d.startsWith('run-'))
          .map(d => path.join(logsDir, d))
          .filter(d => fs.statSync(d).isDirectory())
          .sort()
          .reverse();

        if (runDirs.length > 0) {
          artifacts.runDir = runDirs[0];
          collectFilesRecursive(runDirs[0]!, artifacts);
        }
      }
    }

    // Also check if baseDir itself is a run directory
    if (baseDir.includes('run-')) {
      collectFilesRecursive(baseDir, artifacts);
    }
  } catch {
    // Ignore errors during artifact collection
  }

  return artifacts;
}

/**
 * Recursively collect state and log files
 */
function collectFilesRecursive(dir: string, artifacts: ExecutionArtifacts): void {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        collectFilesRecursive(fullPath, artifacts);
      } else if (entry.isFile()) {
        if (entry.name === 'state.json') {
          artifacts.stateFiles.push(fullPath);
        } else if (entry.name.endsWith('.log') || entry.name.endsWith('.jsonl')) {
          artifacts.logFiles.push(fullPath);
        }
      }
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Read state file from artifacts
 */
export function readStateFile(filePath: string): Record<string, unknown> | null {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Assert execution was successful
 */
export function assertSuccess(result: ExecutionResult): void {
  if (result.exitCode !== 0) {
    throw new Error(
      `Command failed with exit code ${result.exitCode}\n` +
      `stdout: ${result.stdout}\n` +
      `stderr: ${result.stderr}`
    );
  }
  if (result.timedOut) {
    throw new Error('Command timed out');
  }
}

/**
 * Assert execution failed
 */
export function assertFailed(result: ExecutionResult, expectedCode?: number): void {
  if (result.exitCode === 0) {
    throw new Error('Expected command to fail but it succeeded');
  }
  if (expectedCode !== undefined && result.exitCode !== expectedCode) {
    throw new Error(
      `Expected exit code ${expectedCode} but got ${result.exitCode}`
    );
  }
}


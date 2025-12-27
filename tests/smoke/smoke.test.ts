/**
 * Smoke Tests
 * 
 * Real execution tests that verify the CLI actually works.
 * These tests run actual CLI commands (not mocks) and verify output.
 * 
 * Run with: npm run test:smoke
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import {
  runCursorflowCommand,
  runVersion,
  runDoctor,
  assertSuccess,
  ExecutionResult,
} from '../helpers/real-runner';
import {
  TerminalVerifier,
  COMMON_ASSERTIONS,
  createSmokeAssertions,
} from '../helpers/terminal-verifier';

// Longer timeouts for real execution
const SMOKE_TIMEOUT = 60_000; // 60 seconds

// Path to the smoke test project
const SMOKE_PROJECT_PATH = path.resolve(__dirname, '../../test-projects/smoke-test');

/**
 * Setup smoke test environment
 */
async function setupSmokeProject(): Promise<{ cleanup: () => void }> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursorflow-smoke-'));
  
  // Copy smoke-test project to temp directory
  copyDirSync(SMOKE_PROJECT_PATH, tempDir);
  
  // Initialize git repo
  try {
    execSync('git init', { cwd: tempDir, stdio: 'pipe' });
    execSync('git config user.email "test@smoke.test"', { cwd: tempDir, stdio: 'pipe' });
    execSync('git config user.name "Smoke Test"', { cwd: tempDir, stdio: 'pipe' });
    execSync('git add -A', { cwd: tempDir, stdio: 'pipe' });
    execSync('git commit -m "Initial commit"', { cwd: tempDir, stdio: 'pipe' });
    
    // Create bare repo as origin
    const bareDir = path.join(tempDir, '..', 'smoke-origin.git');
    fs.mkdirSync(bareDir, { recursive: true });
    execSync('git init --bare', { cwd: bareDir, stdio: 'pipe' });
    execSync(`git remote add origin "${bareDir}"`, { cwd: tempDir, stdio: 'pipe' });
    execSync('git push -u origin main', { cwd: tempDir, stdio: 'pipe' });
  } catch (err) {
    // Git setup might fail, that's okay for some tests
    console.warn('Git setup warning:', err);
  }
  
  return {
    cleanup: () => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
        const bareDir = path.join(tempDir, '..', 'smoke-origin.git');
        if (fs.existsSync(bareDir)) {
          fs.rmSync(bareDir, { recursive: true, force: true });
        }
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}

/**
 * Copy directory recursively
 */
function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    // Skip git directory and logs
    if (entry.name === '.git' || entry.name === 'logs') {
      continue;
    }
    
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

describe('Smoke Tests - Real CLI Execution', () => {
  // Ensure cursorflow is built before running smoke tests
  beforeAll(() => {
    const distPath = path.resolve(__dirname, '../../dist/cli/index.js');
    if (!fs.existsSync(distPath)) {
      throw new Error(
        'CursorFlow is not built. Run `npm run build` before smoke tests.'
      );
    }
  });

  describe('Basic CLI', () => {
    test('--version returns version number', async () => {
      const result = await runVersion(process.cwd());
      
      // Should not crash
      expect(result.exitCode).toBeDefined();
      
      // Should output something
      expect(result.combined.length).toBeGreaterThan(0);
      
      // Verify version format
      const verification = result.verifier.verify([
        COMMON_ASSERTIONS.VERSION_OUTPUT,
        COMMON_ASSERTIONS.NO_FATAL_ERRORS,
      ]);
      
      if (!verification.passed) {
        console.error('Output:', result.combined);
        console.error('Failures:', verification.failures);
      }
      
      expect(verification.passed).toBe(true);
    }, SMOKE_TIMEOUT);

    test('--help shows usage information', async () => {
      const result = await runCursorflowCommand('--help', {
        cwd: process.cwd(),
        timeout: 10000,
      });
      
      expect(result.exitCode).toBe(0);
      
      // Should contain command descriptions
      expect(result.verifier.contains(/usage|commands|options/i)).toBe(true);
      
      // Verify no errors
      const verification = result.verifier.verify([
        COMMON_ASSERTIONS.NO_FATAL_ERRORS,
        COMMON_ASSERTIONS.NO_UNDEFINED,
      ]);
      expect(verification.passed).toBe(true);
    }, SMOKE_TIMEOUT);
  });

  describe('Doctor Command', () => {
    let tempProject: { cleanup: () => void } | null = null;
    let tempDir: string;

    beforeAll(async () => {
      tempProject = await setupSmokeProject();
      // Get the temp directory path from the cleanup function's closure
      // We need to track this separately
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursorflow-doctor-'));
      copyDirSync(SMOKE_PROJECT_PATH, tempDir);
      
      // Initialize git
      try {
        execSync('git init', { cwd: tempDir, stdio: 'pipe' });
        execSync('git config user.email "test@smoke.test"', { cwd: tempDir, stdio: 'pipe' });
        execSync('git config user.name "Smoke Test"', { cwd: tempDir, stdio: 'pipe' });
        execSync('git add -A', { cwd: tempDir, stdio: 'pipe' });
        execSync('git commit -m "Initial commit"', { cwd: tempDir, stdio: 'pipe' });
      } catch {
        // Ignore git errors for doctor tests
      }
    });

    afterAll(() => {
      if (tempDir) {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {
          // Ignore
        }
      }
    });

    test('doctor runs without crashing', async () => {
      const result = await runDoctor(tempDir);
      
      // Should not throw/crash (exit code can be non-zero if checks fail)
      expect(result.exitCode).not.toBeNull();
      expect(result.timedOut).toBe(false);
      
      // Should produce output
      expect(result.combined.length).toBeGreaterThan(0);
      
      // No fatal errors
      const verification = result.verifier.verify([
        COMMON_ASSERTIONS.NO_FATAL_ERRORS,
        COMMON_ASSERTIONS.NO_UNDEFINED,
      ]);
      
      if (!verification.passed) {
        console.error('Doctor output:', result.combined);
        console.error('Failures:', verification.failures);
      }
      
      expect(verification.passed).toBe(true);
    }, SMOKE_TIMEOUT);

    test('doctor --json produces valid JSON', async () => {
      const result = await runDoctor(tempDir, { json: true });
      
      // Should produce JSON output
      const stdout = result.stdout.trim();
      
      // Try to find JSON in output (may have other output around it)
      const jsonMatch = stdout.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        expect(() => JSON.parse(jsonMatch[0])).not.toThrow();
      }
      
      // Verify no runtime errors
      const verification = result.verifier.verify([
        COMMON_ASSERTIONS.NO_UNDEFINED,
      ]);
      expect(verification.passed).toBe(true);
    }, SMOKE_TIMEOUT);

    test('doctor output contains check indicators', async () => {
      const result = await runDoctor(tempDir);
      
      // Should contain check results (pass/fail indicators)
      const hasIndicators = result.verifier.contains(/(?:✓|✗|⚠|PASS|FAIL|OK|ERROR|check)/i);
      
      if (!hasIndicators) {
        console.log('Doctor output:', result.combined);
      }
      
      expect(hasIndicators).toBe(true);
    }, SMOKE_TIMEOUT);
  });

  describe('Output Verification', () => {
    test('TerminalVerifier captures and verifies output correctly', () => {
      const verifier = new TerminalVerifier();
      
      verifier.capture('Starting process...\n');
      verifier.capture('Processing lane-a...\n');
      verifier.captureStderr('Warning: test warning\n');
      verifier.capture('Completed successfully.\n');
      
      expect(verifier.getStdout()).toContain('Starting process');
      expect(verifier.getStderr()).toContain('Warning');
      expect(verifier.getFullOutput()).toContain('lane-a');
      
      const result = verifier.verify([
        { pattern: /Starting/, description: 'Start message', required: true },
        { pattern: /lane-\w+/, description: 'Lane reference', required: true },
        { pattern: /FATAL/, description: 'Fatal error', shouldNotExist: true },
      ]);
      
      expect(result.passed).toBe(true);
      expect(result.failures).toHaveLength(0);
    });

    test('TerminalVerifier detects missing required patterns', () => {
      const verifier = new TerminalVerifier();
      verifier.capture('Hello world\n');
      
      const result = verifier.verify([
        { pattern: /Hello/, description: 'Greeting', required: true },
        { pattern: /orchestration/, description: 'Orchestration', required: true },
      ]);
      
      expect(result.passed).toBe(false);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]).toContain('Orchestration');
    });

    test('TerminalVerifier detects forbidden patterns', () => {
      const verifier = new TerminalVerifier();
      verifier.capture('Process started\n');
      verifier.capture('FATAL: Something went wrong\n');
      
      const result = verifier.verify([
        { pattern: /Process started/, description: 'Start', required: true },
        { pattern: /FATAL/, description: 'Fatal error', shouldNotExist: true },
      ]);
      
      expect(result.passed).toBe(false);
      expect(result.failures.some(f => f.includes('Should NOT contain'))).toBe(true);
    });
  });

  describe('Build Verification', () => {
    test('dist/cli/index.js exists and is executable', () => {
      const cliPath = path.resolve(__dirname, '../../dist/cli/index.js');
      expect(fs.existsSync(cliPath)).toBe(true);
      
      const content = fs.readFileSync(cliPath, 'utf8');
      // Should have shebang or be valid JS
      expect(content.length).toBeGreaterThan(100);
    });

    test('package.json bin points to valid files', () => {
      const pkgPath = path.resolve(__dirname, '../../package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      
      expect(pkg.bin).toBeDefined();
      expect(pkg.bin.cursorflow).toBeDefined();
      
      // Verify the bin target exists
      const binPath = path.resolve(__dirname, '../..', pkg.bin.cursorflow);
      expect(fs.existsSync(binPath)).toBe(true);
    });
  });
});

describe('Smoke Tests - Artifact Generation', () => {
  // These tests verify that running commands generates expected artifacts
  // They require more setup and are slower
  
  const ARTIFACT_TIMEOUT = 120_000; // 2 minutes
  let testDir: string;

  beforeAll(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursorflow-artifact-'));
    copyDirSync(SMOKE_PROJECT_PATH, testDir);
    
    // Initialize git
    try {
      execSync('git init', { cwd: testDir, stdio: 'pipe' });
      execSync('git config user.email "test@smoke.test"', { cwd: testDir, stdio: 'pipe' });
      execSync('git config user.name "Smoke Test"', { cwd: testDir, stdio: 'pipe' });
      execSync('git add -A', { cwd: testDir, stdio: 'pipe' });
      execSync('git commit -m "Initial commit"', { cwd: testDir, stdio: 'pipe' });
      
      // Create bare repo as origin
      const bareDir = path.join(testDir, '..', 'artifact-origin.git');
      fs.mkdirSync(bareDir, { recursive: true });
      execSync('git init --bare', { cwd: bareDir, stdio: 'pipe' });
      execSync(`git remote add origin "${bareDir}"`, { cwd: testDir, stdio: 'pipe' });
      execSync('git push -u origin main', { cwd: testDir, stdio: 'pipe' });
    } catch (err) {
      console.warn('Git setup warning:', err);
    }
  });

  afterAll(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
      const bareDir = path.join(testDir, '..', 'artifact-origin.git');
      if (fs.existsSync(bareDir)) {
        fs.rmSync(bareDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore
    }
  });

  test('logs directory structure is created correctly', async () => {
    // This test just verifies the _cursorflow directory structure
    const cursorflowDir = path.join(testDir, '_cursorflow');
    expect(fs.existsSync(cursorflowDir)).toBe(true);
    
    const tasksDir = path.join(cursorflowDir, 'tasks');
    expect(fs.existsSync(tasksDir)).toBe(true);
    
    // Verify task file exists
    const taskFiles = fs.readdirSync(tasksDir);
    expect(taskFiles.length).toBeGreaterThan(0);
  });
});

/**
 * Core Module Contract Tests
 * 
 * These tests verify the essential contracts of core modules
 * without mocking - ensuring real behavior works.
 */
describe('Smoke Tests - Core Module Contracts', () => {
  describe('State Module', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-smoke-'));
    });

    afterEach(() => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    });

    test('saveState/loadState round-trip works', () => {
      // Dynamic import to test actual module
      const { saveState, loadState } = require('../../src/utils/state');
      const statePath = path.join(tempDir, 'test-state.json');
      
      const originalState = {
        label: 'test-lane',
        status: 'running',
        currentTaskIndex: 1,
        totalTasks: 3,
        startTime: Date.now(),
      };

      saveState(statePath, originalState);
      const loadedState = loadState(statePath);

      expect(loadedState).toEqual(originalState);
    });

    test('validateLaneState detects missing fields', () => {
      const { validateLaneState } = require('../../src/utils/state');
      const statePath = path.join(tempDir, 'invalid-state.json');
      
      // Write invalid state
      fs.writeFileSync(statePath, JSON.stringify({ label: 'test' }), 'utf8');
      
      const result = validateLaneState(statePath);
      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });
  });

  describe('Events Module', () => {
    test('event emission and subscription works', () => {
      const { events } = require('../../src/utils/events');
      
      const received: any[] = [];
      const handler = (event: any) => received.push(event);
      
      events.on('smoke.test', handler);
      events.emit('smoke.test', { message: 'hello' });
      
      expect(received.length).toBe(1);
      expect(received[0].type).toBe('smoke.test');
      expect(received[0].payload.message).toBe('hello');
      
      events.off('smoke.test', handler);
    });
  });

  describe('Config Module', () => {
    test('loadConfig handles missing file gracefully', () => {
      const { loadConfig } = require('../../src/utils/config');
      
      // Should not throw for missing config
      const result = loadConfig('/nonexistent/path/.cursorflow.json');
      expect(result).toBeDefined();
    });
  });
});

/**
 * CLI Command Output Tests
 * 
 * Verify all major CLI commands produce expected output format.
 */
describe('Smoke Tests - CLI Command Outputs', () => {
  const CLI_PATH = path.resolve(__dirname, '../../dist/cli/index.js');

  test('models command runs without error', async () => {
    try {
      const result = execSync(`node ${CLI_PATH} models 2>&1`, {
        encoding: 'utf8',
        timeout: 10000,
      });
      
      // Should not have undefined or null errors
      expect(result).not.toMatch(/undefined is not/i);
      expect(result).not.toMatch(/cannot read propert/i);
    } catch (err: any) {
      // Command might fail if cursor-agent not available, but should not crash
      if (err.stdout) {
        expect(err.stdout).not.toMatch(/undefined is not/i);
      }
    }
  }, SMOKE_TIMEOUT);

  test('init command shows usage without crashing', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-smoke-'));
    
    try {
      execSync('git init', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'pipe' });
      
      const result = execSync(`node ${CLI_PATH} init --help 2>&1`, {
        encoding: 'utf8',
        cwd: tempDir,
        timeout: 10000,
      });
      
      expect(result).toMatch(/init|initialize/i);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, SMOKE_TIMEOUT);

  test('logs command handles missing run gracefully', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logs-smoke-'));
    
    try {
      execSync('git init', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'pipe' });
      
      // Create minimal _cursorflow structure
      fs.mkdirSync(path.join(tempDir, '_cursorflow', 'tasks'), { recursive: true });
      
      try {
        const result = execSync(`node ${CLI_PATH} logs 2>&1`, {
          encoding: 'utf8',
          cwd: tempDir,
          timeout: 10000,
        });
        
        // Should handle gracefully - either show "no runs" message or help
        expect(result).not.toMatch(/undefined is not/i);
      } catch (err: any) {
        // Expected to fail with "no runs found" or similar
        if (err.stdout) {
          expect(err.stdout).not.toMatch(/cannot read propert/i);
        }
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, SMOKE_TIMEOUT);
});

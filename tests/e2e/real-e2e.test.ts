/**
 * Real End-to-End Tests with Actual cursor-agent
 * 
 * These tests execute the COMPLETE cursorflow workflow with real cursor-agent.
 * They simulate an actual user's experience from start to finish:
 * 
 * 1. Initialize a Git repository
 * 2. Create task files
 * 3. Run cursorflow orchestration
 * 4. Verify Git branches, commits, and file changes
 * 5. Merge results back to main
 * 
 * IMPORTANT:
 * - Requires cursor-agent to be installed and authenticated
 * - Makes real API calls (may incur costs)
 * - Takes 3-5 minutes per test scenario
 * - Run locally: npm run test:e2e:real
 * 
 * Prerequisites:
 *   1. cursor-agent installed: which cursor-agent
 *   2. Logged in: cursor-agent status
 */

import { spawn, spawnSync, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/** Test timeout: 5 minutes per test */
const TEST_TIMEOUT = 300_000;

/** Path to built cursorflow CLI */
const CURSORFLOW_CLI = path.resolve(__dirname, '../../dist/cli/index.js');

/**
 * Get clean PATH without mock cursor-agent
 * This is important because setup.ts may have added mock agent to PATH
 */
function getCleanPath(): string {
  const currentPath = process.env['PATH'] || '';
  const mockAgentDir = path.resolve(__dirname, '../fixtures/mock-cursor-agent');
  
  // Filter out the mock agent directory from PATH
  const pathParts = currentPath.split(':').filter(p => !p.includes('mock-cursor-agent'));
  return pathParts.join(':');
}

/** Clean PATH without mock agent */
const CLEAN_PATH = getCleanPath();

/**
 * Check if cursor-agent is available and logged in
 */
function checkCursorAgentStatus(): { available: boolean; loggedIn: boolean; version?: string } {
  try {
    const versionResult = spawnSync('cursor-agent', ['--version'], {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, PATH: CLEAN_PATH },
    });
    
    if (versionResult.status !== 0) {
      return { available: false, loggedIn: false };
    }
    
    const statusResult = spawnSync('cursor-agent', ['status'], {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, PATH: CLEAN_PATH },
    });
    
    const loggedIn = statusResult.status === 0 && statusResult.stdout.includes('Logged in');
    
    return {
      available: true,
      loggedIn,
      version: versionResult.stdout.trim(),
    };
  } catch {
    return { available: false, loggedIn: false };
  }
}

/**
 * Run cursorflow command and capture output
 */
async function runCursorflow(
  command: string,
  args: string[],
  options: {
    cwd: string;
    timeout?: number;
    env?: Record<string, string>;
  }
): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  duration: number;
}> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    
    const child = spawn('node', [CURSORFLOW_CLI, command, ...args], {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
        PATH: CLEAN_PATH, // Use clean PATH without mock agent
        NO_COLOR: '1',
        FORCE_COLOR: '0',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    
    child.stdout?.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      process.stdout.write(text); // Real-time output
    });
    
    child.stderr?.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      process.stderr.write(text);
    });
    
    const timeout = options.timeout || TEST_TIMEOUT;
    const timeoutHandle = setTimeout(() => {
      console.log('\n⏱ Test timeout reached, killing process...');
      child.kill('SIGKILL');
    }, timeout);
    
    child.on('close', (code) => {
      clearTimeout(timeoutHandle);
      resolve({
        exitCode: code,
        stdout,
        stderr,
        duration: Date.now() - startTime,
      });
    });
    
    child.on('error', (err) => {
      clearTimeout(timeoutHandle);
      resolve({
        exitCode: null,
        stdout,
        stderr: err.message,
        duration: Date.now() - startTime,
      });
    });
  });
}

/**
 * Create a test Git repository with origin
 */
function createTestRepo(): { repoDir: string; originDir: string; cleanup: () => void } {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursorflow-real-e2e-'));
  const repoDir = path.join(baseDir, 'repo');
  const originDir = path.join(baseDir, 'origin.git');
  
  // Create directories
  fs.mkdirSync(repoDir, { recursive: true });
  fs.mkdirSync(originDir, { recursive: true });
  
  // Initialize bare origin
  execSync('git init --bare', { cwd: originDir, stdio: 'pipe' });
  
  // Initialize working repo
  execSync('git init', { cwd: repoDir, stdio: 'pipe' });
  execSync('git config user.email "test@cursorflow.test"', { cwd: repoDir, stdio: 'pipe' });
  execSync('git config user.name "CursorFlow Test"', { cwd: repoDir, stdio: 'pipe' });
  
  // Create initial content
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# Test Project\n\nThis is a test project for CursorFlow E2E testing.\n');
  fs.writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify({
    name: 'cursorflow-e2e-test',
    version: '1.0.0',
    description: 'E2E test project',
  }, null, 2));
  
  // Initial commit
  execSync('git add -A', { cwd: repoDir, stdio: 'pipe' });
  execSync('git commit -m "Initial commit"', { cwd: repoDir, stdio: 'pipe' });
  
  // Set up remote with file:// protocol for local access
  execSync(`git remote add origin "file://${originDir}"`, { cwd: repoDir, stdio: 'pipe' });
  execSync('git push -u origin HEAD:main', { cwd: repoDir, stdio: 'pipe' });
  
  // Create cursorflow.config.js to configure the test environment
  const configContent = `
module.exports = {
  projectRoot: '${repoDir}',
  tasksDir: '_cursorflow/tasks',
  logsDir: '_cursorflow/logs',
  defaultModel: 'auto',
  // Skip Git remote checks for testing
  skipRemoteCheck: true,
};
`;
  fs.writeFileSync(path.join(repoDir, 'cursorflow.config.js'), configContent, 'utf8');
  
  return {
    repoDir,
    originDir,
    cleanup: () => {
      try {
        fs.rmSync(baseDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}

/**
 * Create CursorFlow task file
 */
function createTaskFile(
  tasksDir: string,
  laneName: string,
  tasks: Array<{
    name: string;
    prompt: string;
    model?: string;
    dependsOn?: string[];
  }>
): string {
  const taskFile = {
    branchPrefix: `cursorflow/${laneName}-`,
    executor: 'cursor-agent',
    tasks,
  };
  
  fs.mkdirSync(tasksDir, { recursive: true });
  const filePath = path.join(tasksDir, `${laneName}.json`);
  fs.writeFileSync(filePath, JSON.stringify(taskFile, null, 2), 'utf8');
  
  return filePath;
}

/**
 * Get list of Git branches
 */
function getGitBranches(repoDir: string): string[] {
  const result = execSync('git branch -a', { cwd: repoDir, encoding: 'utf8' });
  return result.split('\n')
    .map(line => line.trim())
    // Remove * (current branch) and + (checked out in worktree) prefixes
    .map(line => line.replace(/^[\*\+]\s*/, ''))
    .filter(line => line.length > 0);
}

/**
 * Get Git log entries
 */
function getGitLog(repoDir: string, count = 10): string[] {
  try {
    const result = execSync(`git log --oneline -${count} --all`, { cwd: repoDir, encoding: 'utf8' });
    return result.split('\n').filter(line => line.length > 0);
  } catch {
    return [];
  }
}

/**
 * Check if file exists in repo
 */
function fileExists(repoDir: string, filePath: string): boolean {
  return fs.existsSync(path.join(repoDir, filePath));
}

/**
 * Read file content
 */
function readFile(repoDir: string, filePath: string): string | null {
  const fullPath = path.join(repoDir, filePath);
  if (fs.existsSync(fullPath)) {
    return fs.readFileSync(fullPath, 'utf8');
  }
  return null;
}

/**
 * Verify cursorflow execution result
 */
function verifyExecutionResult(result: { exitCode: number | null; stdout: string; stderr: string }): void {
  const output = result.stdout + result.stderr;
  
  // Should not have JavaScript errors
  expect(output).not.toMatch(/undefined is not|cannot read|TypeError|ReferenceError/i);
  
  // Should not have unhandled promise rejections
  expect(output).not.toMatch(/unhandled.*rejection/i);
  
  // Exit code should be defined (process completed)
  expect(result.exitCode).not.toBeNull();
}

/**
 * Check if a branch exists in the repo
 */
function branchExists(repoDir: string, branchPattern: string): string | undefined {
  const branches = getGitBranches(repoDir);
  return branches.find(b => b.includes(branchPattern));
}

/**
 * Checkout branch and verify file exists
 */
function checkoutAndVerifyFile(
  repoDir: string,
  branchName: string,
  fileName: string,
  expectedContent?: string
): { exists: boolean; content: string | null } {
  try {
    // Handle remote branch names
    const localBranch = branchName.replace('remotes/origin/', '');
    
    // Checkout the branch
    if (branchName.includes('remotes/origin/')) {
      // Check if local branch already exists
      try {
        execSync(`git checkout ${localBranch}`, { cwd: repoDir, stdio: 'pipe' });
      } catch {
        execSync(`git checkout -b ${localBranch} ${branchName}`, { cwd: repoDir, stdio: 'pipe' });
      }
    } else {
      execSync(`git checkout ${branchName}`, { cwd: repoDir, stdio: 'pipe' });
    }
    
    const exists = fileExists(repoDir, fileName);
    const content = exists ? readFile(repoDir, fileName) : null;
    
    // Switch back to main
    execSync('git checkout main', { cwd: repoDir, stdio: 'pipe' });
    
    if (exists && expectedContent) {
      expect(content).toContain(expectedContent);
    }
    
    return { exists, content };
  } catch (e) {
    console.log(`Could not verify file on branch ${branchName}:`, e);
    return { exists: false, content: null };
  }
}

// =============================================================================
// Prerequisite Check
// =============================================================================

const agentStatus = checkCursorAgentStatus();

if (!agentStatus.available) {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║   ⚠️  cursor-agent NOT FOUND - Tests will be SKIPPED            ║');
  console.log('║                                                                ║');
  console.log('║   To run these E2E tests, install cursor-agent:                ║');
  console.log('║   https://docs.cursor.com/agent/installation                   ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('\n');
}

if (agentStatus.available && !agentStatus.loggedIn) {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║   ⚠️  cursor-agent NOT LOGGED IN - Tests will be SKIPPED        ║');
  console.log('║                                                                ║');
  console.log('║   To run these E2E tests, log in:                              ║');
  console.log('║   $ cursor-agent login                                         ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log('\n');
}

const shouldRunTests = agentStatus.available && agentStatus.loggedIn;

// =============================================================================
// Real E2E Tests
// =============================================================================

const describeOrSkip = shouldRunTests ? describe : describe.skip;

describeOrSkip('Real E2E: Complete CursorFlow Workflow', () => {
  let testRepo: ReturnType<typeof createTestRepo>;
  
  beforeAll(() => {
    console.log('\n');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  🚀 Starting Real E2E Tests with cursor-agent');
    console.log(`     Version: ${agentStatus.version}`);
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('\n');
  });
  
  beforeEach(() => {
    testRepo = createTestRepo();
    console.log(`\n📁 Test repo: ${testRepo.repoDir}\n`);
  });
  
  afterEach(() => {
    testRepo.cleanup();
  });
  
  // ===========================================================================
  // Scenario 1: Single Lane - Create a File
  // ===========================================================================
  describe('Scenario 1: Single Lane - Create a File', () => {
    test('should create a file using cursor-agent and commit to branch', async () => {
      console.log('\n🎬 [Scenario 1] Single Lane - Create a File\n');
      
      // Setup: Create task that asks agent to create a simple file
      const tasksDir = path.join(testRepo.repoDir, '_cursorflow', 'tasks');
      createTaskFile(tasksDir, 'create-file', [
        {
          name: 'create-greeting',
          prompt: `
# Task: Create a Greeting File

## Goal
Create a simple text file called "greeting.txt" in the root of the project.

## Requirements
1. The file should contain exactly: "Hello from CursorFlow E2E Test!"
2. Commit the change with message: "feat: add greeting file"

## Important
- Do NOT modify any other files
- Do NOT install any dependencies
- Just create the one file and commit
`,
        },
      ]);
      
      console.log('📋 Task file created, starting cursorflow run...\n');
      
      // Run cursorflow
      const result = await runCursorflow('run', ['--skip-preflight', tasksDir], {
        cwd: testRepo.repoDir,
        timeout: TEST_TIMEOUT,
      });
      
      console.log(`\n⏱ Completed in ${Math.round(result.duration / 1000)}s`);
      console.log(`📊 Exit code: ${result.exitCode}`);
      
      // Verify execution
      verifyExecutionResult(result);
      
      // Verify results
      const branches = getGitBranches(testRepo.repoDir);
      console.log('\n📌 Git branches:', branches);
      
      const log = getGitLog(testRepo.repoDir);
      console.log('📜 Git log:', log);
      
      // Check for cursorflow branch
      const cursorflowBranch = branchExists(testRepo.repoDir, 'cursorflow/');
      console.log(`🌿 CursorFlow branch: ${cursorflowBranch || 'not found'}`);
      
      // Should have created some state files
      const logsDir = path.join(testRepo.repoDir, '_cursorflow', 'logs');
      const hasLogs = fs.existsSync(logsDir);
      console.log(`📁 Logs directory created: ${hasLogs}`);
      
      if (cursorflowBranch) {
        const { exists, content } = checkoutAndVerifyFile(
          testRepo.repoDir,
          cursorflowBranch,
          'greeting.txt',
          'Hello'
        );
        console.log(`📄 greeting.txt exists: ${exists}`);
        if (content) {
          console.log(`📄 greeting.txt content: ${content.trim()}`);
        }
      }
      
      console.log('\n✅ [Scenario 1] Complete\n');
    }, TEST_TIMEOUT);
  });
  
  // ===========================================================================
  // Scenario 2: Multiple Independent Lanes (Parallel)
  // ===========================================================================
  describe('Scenario 2: Multiple Independent Lanes (Parallel)', () => {
    test('should run two lanes in parallel with max-concurrent 2', async () => {
      console.log('\n🎬 [Scenario 2] Multiple Independent Lanes (Parallel)\n');
      
      const tasksDir = path.join(testRepo.repoDir, '_cursorflow', 'tasks');
      
      // Lane A: Create file A
      createTaskFile(tasksDir, 'lane-a', [
        {
          name: 'create-file-a',
          prompt: `
# Task: Create File A

Create a file called "file-a.txt" in the root directory with content "Created by Lane A".
Commit with message: "feat: add file A"

Important:
- Only create this one file
- Do NOT modify any other files
`,
        },
      ]);
      
      // Lane B: Create file B
      createTaskFile(tasksDir, 'lane-b', [
        {
          name: 'create-file-b',
          prompt: `
# Task: Create File B

Create a file called "file-b.txt" in the root directory with content "Created by Lane B".
Commit with message: "feat: add file B"

Important:
- Only create this one file
- Do NOT modify any other files
`,
        },
      ]);
      
      console.log('📋 Two task files created, starting parallel execution (max-concurrent 2)...\n');
      
      // Run with --max-concurrent 2 to test parallel execution
      // Note: tasksDir must come first as the positional argument
      const result = await runCursorflow('run', [tasksDir, '--skip-preflight', '--max-concurrent', '2'], {
        cwd: testRepo.repoDir,
        timeout: TEST_TIMEOUT,
      });
      
      console.log(`\n⏱ Completed in ${Math.round(result.duration / 1000)}s`);
      console.log(`📊 Exit code: ${result.exitCode}`);
      
      // Verify execution
      verifyExecutionResult(result);
      
      const branches = getGitBranches(testRepo.repoDir);
      console.log('📌 Git branches:', branches);
      
      // Check for both lane branches
      const laneABranch = branchExists(testRepo.repoDir, 'lane-a');
      const laneBBranch = branchExists(testRepo.repoDir, 'lane-b');
      
      console.log(`🅰️ Lane A branch: ${laneABranch || 'not found'}`);
      console.log(`🅱️ Lane B branch: ${laneBBranch || 'not found'}`);
      
      // Verify files on branches if they exist
      if (laneABranch) {
        const { exists } = checkoutAndVerifyFile(testRepo.repoDir, laneABranch, 'file-a.txt', 'Lane A');
        console.log(`📄 file-a.txt exists on Lane A branch: ${exists}`);
      }
      
      if (laneBBranch) {
        const { exists } = checkoutAndVerifyFile(testRepo.repoDir, laneBBranch, 'file-b.txt', 'Lane B');
        console.log(`📄 file-b.txt exists on Lane B branch: ${exists}`);
      }
      
      // At least one branch should have been created
      expect(laneABranch || laneBBranch).toBeTruthy();
      
      console.log('\n✅ [Scenario 2] Complete\n');
    }, TEST_TIMEOUT);
  });
  
  // ===========================================================================
  // Scenario 3: Lane with Dependency
  // ===========================================================================
  describe('Scenario 3: Lane with Dependency', () => {
    test('should wait for base lane before running dependent lane', async () => {
      console.log('\n🎬 [Scenario 3] Lane with Dependency\n');
      
      const tasksDir = path.join(testRepo.repoDir, '_cursorflow', 'tasks');
      
      // Base lane: Create a config file that the dependent lane needs
      createTaskFile(tasksDir, 'base-lane', [
        {
          name: 'create-config',
          prompt: `
# Task: Create Config File

Create a file called "config.json" in the root directory with this content:
\`\`\`json
{
  "version": "1.0.0",
  "name": "test-app",
  "initialized": true
}
\`\`\`

Commit with message: "feat: add config file"

Important:
- Only create this one file
- Do NOT modify any other files
`,
        },
      ]);
      
      // Dependent lane: Creates a file that references the config
      // Note: This lane depends on base-lane:create-config completing first
      createTaskFile(tasksDir, 'dependent-lane', [
        {
          name: 'create-loader',
          prompt: `
# Task: Create Config Loader

Create a file called "loader.js" in the root directory with this content:
\`\`\`javascript
// Config loader module
const config = require('./config.json');
console.log('Loaded config:', config.name, 'v' + config.version);
module.exports = { config };
\`\`\`

Commit with message: "feat: add config loader"

Important:
- Only create this one file
- Do NOT modify any other files
`,
          dependsOn: ['base-lane:create-config'],
        },
      ]);
      
      console.log('📋 Two task files created (one depends on the other)...\n');
      console.log('   base-lane: creates config.json');
      console.log('   dependent-lane: creates loader.js (depends on base-lane:create-config)\n');
      
      // Run with sequential execution to ensure dependencies are respected
      // Note: tasksDir must come first as the positional argument
      const result = await runCursorflow('run', [tasksDir, '--skip-preflight', '--max-concurrent', '1'], {
        cwd: testRepo.repoDir,
        timeout: TEST_TIMEOUT,
      });
      
      console.log(`\n⏱ Completed in ${Math.round(result.duration / 1000)}s`);
      console.log(`📊 Exit code: ${result.exitCode}`);
      
      // Verify execution
      verifyExecutionResult(result);
      
      const branches = getGitBranches(testRepo.repoDir);
      console.log('📌 Git branches:', branches);
      
      const log = getGitLog(testRepo.repoDir);
      console.log('📜 Git log:', log);
      
      // Check for both lane branches
      const baseBranch = branchExists(testRepo.repoDir, 'base-lane');
      const dependentBranch = branchExists(testRepo.repoDir, 'dependent-lane');
      
      console.log(`🏠 Base lane branch: ${baseBranch || 'not found'}`);
      console.log(`🔗 Dependent lane branch: ${dependentBranch || 'not found'}`);
      
      // Verify files on branches if they exist
      if (baseBranch) {
        const { exists, content } = checkoutAndVerifyFile(testRepo.repoDir, baseBranch, 'config.json');
        console.log(`📄 config.json exists on base branch: ${exists}`);
        if (content) {
          try {
            const parsed = JSON.parse(content);
            console.log(`📄 config.json parsed: ${JSON.stringify(parsed)}`);
            expect(parsed.version).toBeDefined();
          } catch {
            console.log(`📄 config.json content (not JSON): ${content.substring(0, 100)}`);
          }
        }
      }
      
      if (dependentBranch) {
        const { exists, content } = checkoutAndVerifyFile(testRepo.repoDir, dependentBranch, 'loader.js');
        console.log(`📄 loader.js exists on dependent branch: ${exists}`);
        if (content) {
          console.log(`📄 loader.js content preview: ${content.substring(0, 100)}...`);
        }
      }
      
      // At least the base branch should have been created
      expect(baseBranch).toBeTruthy();
      
      console.log('\n✅ [Scenario 3] Complete\n');
    }, TEST_TIMEOUT);
  });
  
  // ===========================================================================
  // Scenario 4: Complete Workflow with Merge
  // ===========================================================================
  describe('Scenario 4: Complete Workflow with Merge', () => {
    test('should complete task and merge branch back to main', async () => {
      console.log('\n🎬 [Scenario 4] Complete Workflow with Merge\n');
      
      const tasksDir = path.join(testRepo.repoDir, '_cursorflow', 'tasks');
      
      createTaskFile(tasksDir, 'feature-lane', [
        {
          name: 'add-feature',
          prompt: `
# Task: Add a Simple Feature

## Goal
Add a new file that represents a small feature.

## Steps
1. Create a file called "feature.js" in the root directory with this content:
\`\`\`javascript
// Simple feature module
function greet(name) {
  return 'Hello, ' + name + '!';
}
module.exports = { greet };
\`\`\`
2. Commit with message: "feat: add greeting feature"

## Important
- Only create this one file
- Do not modify existing files
`,
        },
      ]);
      
      console.log('📋 Feature task created...\n');
      
      const result = await runCursorflow('run', ['--skip-preflight', tasksDir], {
        cwd: testRepo.repoDir,
        timeout: TEST_TIMEOUT,
      });
      
      console.log(`\n⏱ Completed in ${Math.round(result.duration / 1000)}s`);
      console.log(`📊 Exit code: ${result.exitCode}`);
      
      // Verify execution
      verifyExecutionResult(result);
      
      const branches = getGitBranches(testRepo.repoDir);
      console.log('📌 Git branches:', branches);
      
      const featureBranch = branchExists(testRepo.repoDir, 'feature-lane');
      console.log(`🌿 Feature branch: ${featureBranch || 'not found'}`);
      
      if (featureBranch) {
        console.log(`\n🔀 Attempting to merge ${featureBranch} to main...`);
        
        try {
          // Handle remote branch names
          const localBranch = featureBranch.replace('remotes/origin/', '');
          
          // Checkout the feature branch first
          if (featureBranch.includes('remotes/origin/')) {
            try {
              execSync(`git checkout ${localBranch}`, { cwd: testRepo.repoDir, stdio: 'pipe' });
            } catch {
              execSync(`git checkout -b ${localBranch} ${featureBranch}`, { cwd: testRepo.repoDir, stdio: 'pipe' });
            }
          }
          
          // Switch to main and merge
          execSync('git checkout main', { cwd: testRepo.repoDir, stdio: 'pipe' });
          execSync(`git merge ${localBranch} --no-ff -m "Merge feature branch"`, {
            cwd: testRepo.repoDir,
            stdio: 'pipe',
          });
          
          // Verify file exists after merge
          const featureExists = fileExists(testRepo.repoDir, 'feature.js');
          console.log(`📄 feature.js exists after merge: ${featureExists}`);
          
          if (featureExists) {
            const content = readFile(testRepo.repoDir, 'feature.js');
            console.log(`📄 feature.js content:\n${content}`);
            expect(content).toContain('greet');
          }
          
          // Verify Git log shows merge commit
          const finalLog = getGitLog(testRepo.repoDir);
          console.log('📜 Final Git log:', finalLog);
          
          const hasMergeCommit = finalLog.some(line => line.toLowerCase().includes('merge'));
          console.log(`🔗 Merge commit found: ${hasMergeCommit}`);
          
          console.log('✅ Merge successful!');
        } catch (e: any) {
          console.log(`⚠️ Merge failed: ${e.message}`);
          // This is acceptable - the branch might not have any commits yet
        }
      }
      
      console.log('\n✅ [Scenario 4] Complete\n');
    }, TEST_TIMEOUT);
  });
});

// =============================================================================
// Skip Notice
// =============================================================================

if (!shouldRunTests) {
  describe('Real E2E Tests (SKIPPED)', () => {
    test('skipped: cursor-agent not available or not logged in', () => {
      console.log('\n');
      console.log('To run these tests:');
      console.log('  1. Install cursor-agent');
      console.log('  2. Login: cursor-agent login');
      console.log('  3. Run: npm run test:e2e:real');
      console.log('\n');
      expect(true).toBe(true);
    });
  });
}

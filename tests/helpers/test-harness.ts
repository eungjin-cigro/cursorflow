/**
 * Test Harness
 * 
 * Sets up the complete test environment:
 * - Mock cursor-agent in PATH
 * - Temporary Git repository
 * - Scenario controller
 * - Environment variable management
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createMockGitRepo, MockGitRepo } from './mock-git-repo';
import { ScenarioController, ScenarioName, SCENARIOS } from './scenario-controller';

export interface TestHarness {
  /** Mock cursor-agent directory (added to PATH) */
  mockAgentPath: string;
  
  /** Temporary Git repository */
  gitRepo: MockGitRepo;
  
  /** Scenario controller */
  scenarioController: ScenarioController;
  
  /** Temporary directory for test artifacts */
  tempDir: string;
  
  /** Run directory for cursorflow output */
  runDir: string;
  
  /** Tasks directory */
  tasksDir: string;
  
  /** Original PATH value */
  originalPath: string;
  
  /** Original environment variables */
  originalEnv: Record<string, string | undefined>;
  
  /** Set the scenario for mock agent */
  setScenario(name: ScenarioName): void;
  
  /** Get environment variables for subprocess */
  getEnv(): NodeJS.ProcessEnv;
  
  /** Create a tasks file */
  createTasksFile(fileName: string, tasks: TaskDefinition[]): string;
  
  /** Clean up all resources */
  cleanup(): Promise<void>;
}

export interface TaskDefinition {
  name: string;
  prompt: string;
  dependsOn?: string[];
  timeout?: number;
}

export interface SetupTestEnvironmentOptions {
  /** Git repository options */
  gitOptions?: {
    initialBranch?: string;
    initialFiles?: Record<string, string>;
    initialCommits?: number;
  };
  /** Skip Git repository creation */
  skipGit?: boolean;
}

/**
 * Set up the complete test environment
 */
export async function setupTestEnvironment(
  options: SetupTestEnvironmentOptions = {}
): Promise<TestHarness> {
  // Create temp directory
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursorflow-harness-'));
  const runDir = path.join(tempDir, 'runs');
  const tasksDir = path.join(tempDir, 'tasks');
  
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(tasksDir, { recursive: true });

  // Store original environment
  const originalPath = process.env['PATH'] || '';
  const originalEnv: Record<string, string | undefined> = {
    PATH: originalPath,
    MOCK_AGENT_SCENARIO: process.env['MOCK_AGENT_SCENARIO'],
    MOCK_AGENT_SCENARIO_DIR: process.env['MOCK_AGENT_SCENARIO_DIR'],
    MOCK_AGENT_CONTROL_FILE: process.env['MOCK_AGENT_CONTROL_FILE'],
    MOCK_AGENT_DELAY: process.env['MOCK_AGENT_DELAY'],
  };

  // Mock cursor-agent path
  const mockAgentPath = path.resolve(__dirname, '../fixtures/mock-cursor-agent');
  
  // Update PATH to include mock agent first
  process.env['PATH'] = `${mockAgentPath}:${originalPath}`;

  // Create scenario controller
  const scenarioController = new ScenarioController({
    scenarioDir: path.join(mockAgentPath, 'scenarios'),
  });
  scenarioController.setupControlFile(tempDir);

  // Create Git repository (unless skipped)
  let gitRepo: MockGitRepo;
  if (options.skipGit) {
    // Create a minimal mock
    gitRepo = {
      repoDir: path.join(tempDir, 'mock-repo'),
      bareDir: path.join(tempDir, 'mock-bare'),
      tempDir: tempDir,
      cleanup: async () => {},
    };
    fs.mkdirSync(gitRepo.repoDir, { recursive: true });
  } else {
    gitRepo = await createMockGitRepo(options.gitOptions);
  }

  // Set default scenario
  scenarioController.setScenario(SCENARIOS.SUCCESS);
  
  // Apply scenario environment
  const scenarioEnv = scenarioController.getEnvironment();
  for (const [key, value] of Object.entries(scenarioEnv)) {
    process.env[key] = value;
  }

  const harness: TestHarness = {
    mockAgentPath,
    gitRepo,
    scenarioController,
    tempDir,
    runDir,
    tasksDir,
    originalPath,
    originalEnv,

    setScenario(name: ScenarioName): void {
      scenarioController.setScenario(name);
      const env = scenarioController.getEnvironment();
      for (const [key, value] of Object.entries(env)) {
        process.env[key] = value;
      }
    },

    getEnv(): NodeJS.ProcessEnv {
      return {
        ...process.env,
        ...scenarioController.getEnvironment(),
        PATH: `${mockAgentPath}:${originalPath}`,
      };
    },

    createTasksFile(fileName: string, tasks: TaskDefinition[]): string {
      const tasksFilePath = path.join(tasksDir, fileName);
      const config = {
        tasks: tasks.map(t => ({
          name: t.name,
          prompt: t.prompt,
          dependsOn: t.dependsOn,
          timeout: t.timeout,
        })),
        dependencyPolicy: {
          allowDependencyChange: false,
          lockfileReadOnly: true,
        },
      };
      fs.writeFileSync(tasksFilePath, JSON.stringify(config, null, 2), 'utf8');
      return tasksFilePath;
    },

    async cleanup(): Promise<void> {
      // Restore original environment
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }

      // Cleanup scenario controller
      scenarioController.cleanupControlFile();

      // Cleanup Git repo
      if (!options.skipGit) {
        await gitRepo.cleanup();
      }

      // Cleanup temp directory
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    },
  };

  return harness;
}

/**
 * Wait for a condition with timeout
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: { timeoutMs?: number; intervalMs?: number; message?: string } = {}
): Promise<void> {
  const { timeoutMs = 10000, intervalMs = 100, message = 'Condition not met' } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timeout (${timeoutMs}ms): ${message}`);
}

/**
 * Wait for a file to exist
 */
export async function waitForFile(
  filePath: string,
  options: { timeoutMs?: number } = {}
): Promise<void> {
  await waitFor(
    () => fs.existsSync(filePath),
    { ...options, message: `File not found: ${filePath}` }
  );
}

/**
 * Wait for a file to contain specific content
 */
export async function waitForFileContent(
  filePath: string,
  matcher: string | RegExp | ((content: string) => boolean),
  options: { timeoutMs?: number } = {}
): Promise<void> {
  await waitFor(
    () => {
      if (!fs.existsSync(filePath)) return false;
      const content = fs.readFileSync(filePath, 'utf8');
      
      if (typeof matcher === 'string') {
        return content.includes(matcher);
      } else if (matcher instanceof RegExp) {
        return matcher.test(content);
      } else {
        return matcher(content);
      }
    },
    { ...options, message: `File content not matched: ${filePath}` }
  );
}

/**
 * Sleep utility
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Read state.json from run directory
 */
export function readState(runDir: string, laneName?: string): any {
  const statePath = laneName 
    ? path.join(runDir, 'lanes', laneName, 'state.json')
    : path.join(runDir, 'state.json');
  
  if (!fs.existsSync(statePath)) {
    return null;
  }
  
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

/**
 * Read JSONL log file
 */
export function readJsonlLog(logPath: string): any[] {
  if (!fs.existsSync(logPath)) {
    return [];
  }
  
  return fs.readFileSync(logPath, 'utf8')
    .split('\n')
    .filter(line => line.trim())
    .map(line => JSON.parse(line));
}

// Re-export for convenience
export { SCENARIOS } from './scenario-controller';
export type { ScenarioName } from './scenario-controller';


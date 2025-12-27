/**
 * Test Mode Configuration
 * 
 * Provides centralized control over mock vs real dependency usage in tests.
 * 
 * Environment Variables:
 * - USE_REAL_AGENT: When 'true', uses real cursor-agent CLI instead of mock
 * - USE_REAL_GIT: When 'false', would use mock git (not implemented, git is always real)
 * 
 * Usage:
 * ```typescript
 * import { TestMode } from '../config/test-mode';
 * 
 * const agentPath = TestMode.getAgentPath();
 * const env = TestMode.getTestEnvironment('success');
 * ```
 */

import * as path from 'path';

/**
 * Test mode configuration singleton
 */
export const TestMode = {
  /**
   * Whether to use real cursor-agent CLI
   * Set USE_REAL_AGENT=true to enable
   */
  get USE_REAL_AGENT(): boolean {
    return process.env.USE_REAL_AGENT === 'true';
  },

  /**
   * Whether to use real Git (always true - Git is tested with real ephemeral repos)
   */
  get USE_REAL_GIT(): boolean {
    return true;
  },

  /**
   * Path to mock cursor-agent fixtures
   */
  get mockAgentDir(): string {
    return path.resolve(__dirname, '../fixtures/mock-cursor-agent');
  },

  /**
   * Path to mock cursor-agent executable
   */
  get mockAgentPath(): string {
    return path.join(this.mockAgentDir, 'cursor-agent');
  },

  /**
   * Path to mock scenarios directory
   */
  get scenariosDir(): string {
    return path.join(this.mockAgentDir, 'scenarios');
  },

  /**
   * Get the cursor-agent path based on test mode
   */
  getAgentPath(): string {
    if (this.USE_REAL_AGENT) {
      return 'cursor-agent';
    }
    return this.mockAgentPath;
  },

  /**
   * Get the agent command (for spawn)
   */
  getAgentCommand(): string {
    if (this.USE_REAL_AGENT) {
      return 'cursor-agent';
    }
    return 'node';
  },

  /**
   * Get agent arguments (for spawn)
   */
  getAgentArgs(baseArgs: string[] = []): string[] {
    if (this.USE_REAL_AGENT) {
      return baseArgs;
    }
    return [this.mockAgentPath, ...baseArgs];
  },

  /**
   * Get environment variables for test execution
   */
  getTestEnvironment(scenario = 'success', options: TestEnvOptions = {}): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NO_COLOR: '1',
      FORCE_COLOR: '0',
    };

    if (!this.USE_REAL_AGENT) {
      // Mock agent configuration
      env.MOCK_AGENT_SCENARIO = scenario;
      env.MOCK_AGENT_SCENARIO_DIR = this.scenariosDir;
      
      if (options.delay !== undefined) {
        env.MOCK_AGENT_DELAY = String(options.delay);
      }
      
      if (options.controlFile) {
        env.MOCK_AGENT_CONTROL_FILE = options.controlFile;
      }
      
      if (options.debug) {
        env.MOCK_AGENT_DEBUG = '1';
      }

      // Add mock agent to PATH
      const currentPath = process.env.PATH || '';
      if (!currentPath.includes(this.mockAgentDir)) {
        env.PATH = `${this.mockAgentDir}:${currentPath}`;
      }
    }

    return env;
  },

  /**
   * Get PATH with mock agent included (if needed)
   */
  getPathWithAgent(): string {
    const currentPath = process.env.PATH || '';
    
    if (this.USE_REAL_AGENT) {
      return currentPath;
    }
    
    if (currentPath.includes(this.mockAgentDir)) {
      return currentPath;
    }
    
    return `${this.mockAgentDir}:${currentPath}`;
  },

  /**
   * Check if the configured agent is available
   */
  isAgentAvailable(): boolean {
    const { spawnSync } = require('child_process');
    
    try {
      const result = spawnSync(
        this.getAgentCommand(),
        [...this.getAgentArgs(['--version'])],
        {
          encoding: 'utf8',
          stdio: 'pipe',
          timeout: 5000,
          env: this.getTestEnvironment(),
        }
      );
      return result.status === 0;
    } catch {
      return false;
    }
  },

  /**
   * Log current test mode configuration
   */
  logConfiguration(): void {
    console.log('Test Mode Configuration:');
    console.log(`  USE_REAL_AGENT: ${this.USE_REAL_AGENT}`);
    console.log(`  USE_REAL_GIT: ${this.USE_REAL_GIT}`);
    console.log(`  Agent Path: ${this.getAgentPath()}`);
    console.log(`  Agent Available: ${this.isAgentAvailable()}`);
  },
};

/**
 * Options for test environment configuration
 */
export interface TestEnvOptions {
  /** Mock agent delay in milliseconds */
  delay?: number;
  /** Path to control file for dynamic mock agent control */
  controlFile?: string;
  /** Enable debug output from mock agent */
  debug?: boolean;
}

/**
 * Available mock scenarios
 */
export const MockScenarios = {
  /** Successful task completion */
  SUCCESS: 'success',
  /** Task times out (for idle detection testing) */
  TIMEOUT: 'timeout',
  /** Task fails with error */
  FAILURE: 'failure',
  /** Task requests dependency change */
  DEPENDENCY_REQUEST: 'dependency-request',
  /** Hangs briefly then responds (for signal testing) */
  HANG_THEN_RESPOND: 'hang-then-respond',
  /** Simulates crash */
  CRASH: 'crash',
  /** Partial progress scenario */
  PARTIAL_PROGRESS: 'partial-progress',
} as const;

export type MockScenario = typeof MockScenarios[keyof typeof MockScenarios];

/**
 * Helper to conditionally skip tests based on agent availability
 */
export function describeWithRealAgent(name: string, fn: () => void): void {
  const describe = global.describe;
  
  if (TestMode.USE_REAL_AGENT && TestMode.isAgentAvailable()) {
    describe(name, fn);
  } else {
    describe.skip(name, fn);
  }
}

/**
 * Helper to conditionally skip tests when using mock
 */
export function describeWithMockAgent(name: string, fn: () => void): void {
  const describe = global.describe;
  
  if (!TestMode.USE_REAL_AGENT) {
    describe(name, fn);
  } else {
    describe.skip(name, fn);
  }
}

// Export default for convenience
export default TestMode;


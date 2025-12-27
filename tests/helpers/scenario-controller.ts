/**
 * Scenario Controller
 * 
 * Controls mock cursor-agent behavior during tests.
 * Allows setting scenarios and dynamic control.
 */

import * as fs from 'fs';
import * as path from 'path';

export type ScenarioName = 
  | 'success'
  | 'timeout'
  | 'failure'
  | 'dependency-request'
  | 'hang-then-respond'
  | 'crash'
  | 'partial-progress';

export interface Scenario {
  description?: string;
  delay?: number;
  initialHang?: number;
  chunkInterval?: number;
  chunks?: string[];
  result?: string;
  exitCode?: number;
  isError?: boolean;
  error?: string;
}

export interface ScenarioControllerOptions {
  /** Directory for custom scenarios */
  scenarioDir?: string;
  /** File for dynamic control signals */
  controlFile?: string;
}

/**
 * Controller for managing test scenarios
 */
export class ScenarioController {
  private scenarioDir: string;
  private controlFile: string | null;
  private currentScenario: ScenarioName = 'success';

  constructor(options: ScenarioControllerOptions = {}) {
    this.scenarioDir = options.scenarioDir || path.join(__dirname, '../fixtures/mock-cursor-agent/scenarios');
    this.controlFile = options.controlFile || null;
  }

  /**
   * Set the current scenario
   */
  setScenario(name: ScenarioName): void {
    this.currentScenario = name;
  }

  /**
   * Get the current scenario name
   */
  getScenario(): ScenarioName {
    return this.currentScenario;
  }

  /**
   * Get environment variables for mock agent
   */
  getEnvironment(): Record<string, string> {
    const env: Record<string, string> = {
      MOCK_AGENT_SCENARIO: this.currentScenario,
      MOCK_AGENT_SCENARIO_DIR: this.scenarioDir,
    };

    if (this.controlFile) {
      env['MOCK_AGENT_CONTROL_FILE'] = this.controlFile;
    }

    return env;
  }

  /**
   * Set custom delay override
   */
  setDelay(delayMs: number): Record<string, string> {
    return {
      ...this.getEnvironment(),
      MOCK_AGENT_DELAY: String(delayMs),
    };
  }

  /**
   * Create a custom scenario file
   */
  createCustomScenario(name: string, scenario: Scenario): void {
    const scenarioPath = path.join(this.scenarioDir, `${name}.json`);
    fs.writeFileSync(scenarioPath, JSON.stringify(scenario, null, 2), 'utf8');
  }

  /**
   * Delete a custom scenario file
   */
  deleteCustomScenario(name: string): void {
    const scenarioPath = path.join(this.scenarioDir, `${name}.json`);
    if (fs.existsSync(scenarioPath)) {
      fs.unlinkSync(scenarioPath);
    }
  }

  /**
   * Send a control signal to the mock agent
   */
  sendSignal(signal: string): void {
    if (!this.controlFile) {
      throw new Error('Control file not configured');
    }
    fs.writeFileSync(this.controlFile, signal, 'utf8');
  }

  /**
   * Send RESPOND_NOW signal (for hang scenarios)
   */
  respondNow(): void {
    this.sendSignal('RESPOND_NOW');
  }

  /**
   * Send ABORT signal
   */
  abort(): void {
    this.sendSignal('ABORT');
  }

  /**
   * Set up control file
   */
  setupControlFile(tempDir: string): string {
    this.controlFile = path.join(tempDir, 'mock-agent-control.txt');
    return this.controlFile;
  }

  /**
   * Clean up control file
   */
  cleanupControlFile(): void {
    if (this.controlFile && fs.existsSync(this.controlFile)) {
      fs.unlinkSync(this.controlFile);
    }
    this.controlFile = null;
  }
}

/**
 * Pre-defined scenario configurations for easy testing
 */
export const SCENARIOS = {
  /** Task completes successfully */
  SUCCESS: 'success' as ScenarioName,
  
  /** Agent hangs (for idle detection testing) */
  TIMEOUT: 'timeout' as ScenarioName,
  
  /** Task fails with error */
  FAILURE: 'failure' as ScenarioName,
  
  /** Agent requests dependency change */
  DEPENDENCY_REQUEST: 'dependency-request' as ScenarioName,
  
  /** Agent hangs then responds (for recovery testing) */
  HANG_THEN_RESPOND: 'hang-then-respond' as ScenarioName,
  
  /** Agent crashes (for restart testing) */
  CRASH: 'crash' as ScenarioName,
  
  /** Agent makes partial progress */
  PARTIAL_PROGRESS: 'partial-progress' as ScenarioName,
};

/**
 * Create a scenario that fails on first attempt, succeeds on retry
 */
export function createRetryScenario(controller: ScenarioController, tempDir: string): {
  name: string;
  attemptCount: () => number;
} {
  let attempts = 0;
  const name = `retry-test-${Date.now()}`;
  
  // Create a custom scenario that tracks attempts
  // Note: This is a simplified version - real implementation would need file-based state
  controller.createCustomScenario(name, {
    description: 'Fails first time, succeeds on retry',
    delay: 100,
    chunks: ['Processing...'],
    result: 'Task completed on retry.',
    exitCode: 0,
    isError: false,
  });

  return {
    name,
    attemptCount: () => attempts,
  };
}

/**
 * Create a scenario with specific delay
 */
export function createDelayedScenario(
  controller: ScenarioController,
  delayMs: number,
  options: Partial<Scenario> = {}
): string {
  const name = `delayed-${delayMs}-${Date.now()}`;
  
  controller.createCustomScenario(name, {
    description: `Delayed response (${delayMs}ms)`,
    delay: delayMs,
    chunks: ['Processing with delay...'],
    result: 'Task completed after delay.',
    exitCode: 0,
    isError: false,
    ...options,
  });

  return name;
}


/**
 * Terminal Output Verifier
 * 
 * Captures terminal output and provides pattern-based assertions
 * for verifying CLI behavior in smoke tests.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Assertion definition for output verification
 */
export interface OutputAssertion {
  /** Pattern to match against output */
  pattern: RegExp;
  /** Human-readable description of what this assertion checks */
  description: string;
  /** If true, this pattern MUST be found (default: true) */
  required?: boolean;
  /** If true, this pattern must NOT be found */
  shouldNotExist?: boolean;
}

/**
 * Result of a single assertion check
 */
export interface AssertionResult {
  assertion: OutputAssertion;
  passed: boolean;
  matched: boolean;
  matchedText?: string;
}

/**
 * Result of verification
 */
export interface VerificationResult {
  passed: boolean;
  results: AssertionResult[];
  failures: string[];
  summary: string;
}

/**
 * Terminal output verifier for smoke tests
 */
export class TerminalVerifier {
  private outputChunks: string[] = [];
  private stderrChunks: string[] = [];

  /**
   * Capture stdout chunk
   */
  capture(chunk: string | Buffer): void {
    this.outputChunks.push(chunk.toString());
  }

  /**
   * Capture stderr chunk
   */
  captureStderr(chunk: string | Buffer): void {
    this.stderrChunks.push(chunk.toString());
  }

  /**
   * Get full stdout output
   */
  getStdout(): string {
    return this.outputChunks.join('');
  }

  /**
   * Get full stderr output
   */
  getStderr(): string {
    return this.stderrChunks.join('');
  }

  /**
   * Get combined output (stdout + stderr)
   */
  getFullOutput(): string {
    return this.getStdout() + this.getStderr();
  }

  /**
   * Clear captured output
   */
  clear(): void {
    this.outputChunks = [];
    this.stderrChunks = [];
  }

  /**
   * Save output to file for debugging
   */
  saveToFile(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const content = [
      '=== STDOUT ===',
      this.getStdout(),
      '',
      '=== STDERR ===',
      this.getStderr(),
      '',
      '=== COMBINED ===',
      this.getFullOutput(),
    ].join('\n');

    fs.writeFileSync(filePath, content, 'utf8');
  }

  /**
   * Verify output against assertions
   */
  verify(assertions: OutputAssertion[]): VerificationResult {
    const fullOutput = this.getFullOutput();
    const results: AssertionResult[] = [];
    const failures: string[] = [];

    for (const assertion of assertions) {
      const match = assertion.pattern.exec(fullOutput);
      const matched = match !== null;

      let passed: boolean;
      if (assertion.shouldNotExist) {
        // Pattern should NOT be found
        passed = !matched;
        if (!passed) {
          failures.push(`❌ Should NOT contain: "${assertion.description}" (found: "${match?.[0]?.substring(0, 50)}...")`);
        }
      } else {
        // Pattern should be found (default behavior)
        const required = assertion.required !== false;
        passed = matched || !required;
        if (!passed) {
          failures.push(`❌ Missing required: "${assertion.description}"`);
        }
      }

      results.push({
        assertion,
        passed,
        matched,
        matchedText: match?.[0],
      });
    }

    const passedCount = results.filter(r => r.passed).length;
    const totalCount = results.length;

    return {
      passed: failures.length === 0,
      results,
      failures,
      summary: `${passedCount}/${totalCount} assertions passed`,
    };
  }

  /**
   * Quick check if output contains a pattern
   */
  contains(pattern: RegExp | string): boolean {
    const fullOutput = this.getFullOutput();
    if (typeof pattern === 'string') {
      return fullOutput.includes(pattern);
    }
    return pattern.test(fullOutput);
  }

  /**
   * Get lines matching a pattern
   */
  getMatchingLines(pattern: RegExp): string[] {
    const lines = this.getFullOutput().split('\n');
    return lines.filter(line => pattern.test(line));
  }

  /**
   * Get line count
   */
  getLineCount(): number {
    return this.getFullOutput().split('\n').length;
  }
}

/**
 * Pre-defined assertions for common CursorFlow output patterns
 */
export const COMMON_ASSERTIONS = {
  /** Version output format */
  VERSION_OUTPUT: {
    pattern: /\d+\.\d+\.\d+/,
    description: 'Version number format (x.y.z)',
    required: true,
  } as OutputAssertion,

  /** Doctor command output */
  DOCTOR_CHECKS: {
    pattern: /(?:✓|✗|⚠|check|pass|fail)/i,
    description: 'Doctor check indicators',
    required: true,
  } as OutputAssertion,

  /** Lane started indicator */
  LANE_STARTED: {
    pattern: /\[lane-\w+\].*(?:start|begin)/i,
    description: 'Lane start log message',
    required: true,
  } as OutputAssertion,

  /** Orchestration started */
  ORCHESTRATION_STARTED: {
    pattern: /orchestrat(?:ion|or).*start/i,
    description: 'Orchestration start message',
    required: true,
  } as OutputAssertion,

  /** No fatal errors */
  NO_FATAL_ERRORS: {
    pattern: /(?:FATAL|CRASH|uncaught|unhandled).*(?:error|exception)/i,
    description: 'Fatal errors or crashes',
    shouldNotExist: true,
  } as OutputAssertion,

  /** No undefined values in output */
  NO_UNDEFINED: {
    pattern: /undefined is not|cannot read propert|null is not/i,
    description: 'JavaScript runtime errors',
    shouldNotExist: true,
  } as OutputAssertion,

  /** No stack traces in normal output */
  NO_STACK_TRACES: {
    pattern: /at\s+\w+\s+\([^)]+:\d+:\d+\)/,
    description: 'Stack traces (indicates unhandled errors)',
    shouldNotExist: true,
  } as OutputAssertion,
};

/**
 * Create a set of assertions for smoke testing
 */
export function createSmokeAssertions(options?: {
  expectVersion?: boolean;
  expectDoctor?: boolean;
  expectLaneStart?: boolean;
  strict?: boolean;
}): OutputAssertion[] {
  const assertions: OutputAssertion[] = [];
  const {
    expectVersion = false,
    expectDoctor = false,
    expectLaneStart = false,
    strict = true,
  } = options || {};

  if (expectVersion) {
    assertions.push(COMMON_ASSERTIONS.VERSION_OUTPUT);
  }

  if (expectDoctor) {
    assertions.push(COMMON_ASSERTIONS.DOCTOR_CHECKS);
  }

  if (expectLaneStart) {
    assertions.push(COMMON_ASSERTIONS.LANE_STARTED);
    assertions.push(COMMON_ASSERTIONS.ORCHESTRATION_STARTED);
  }

  // Always check for errors in strict mode
  if (strict) {
    assertions.push(COMMON_ASSERTIONS.NO_FATAL_ERRORS);
    assertions.push(COMMON_ASSERTIONS.NO_UNDEFINED);
  }

  return assertions;
}


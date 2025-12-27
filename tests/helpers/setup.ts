/**
 * Jest Setup for Integration Tests
 * 
 * This file runs before each test file in the integration test suite.
 * It sets up global configuration and cleanup handlers.
 * 
 * Uses TestMode for centralized mock/real agent configuration.
 */

import * as path from 'path';
import { TestMode } from '../config/test-mode';

// Store original PATH for restoration
const originalPath = process.env['PATH'] || '';

// Configure agent path based on TestMode
if (!TestMode.USE_REAL_AGENT) {
  // Ensure mock-cursor-agent is in PATH for integration tests
  const pathWithAgent = TestMode.getPathWithAgent();
  if (process.env['PATH'] !== pathWithAgent) {
    process.env['PATH'] = pathWithAgent;
  }
  
  // Set default mock scenario
  process.env['MOCK_AGENT_SCENARIO'] = process.env['MOCK_AGENT_SCENARIO'] || 'success';
  process.env['MOCK_AGENT_SCENARIO_DIR'] = TestMode.scenariosDir;
}

// Global timeout for integration tests
jest.setTimeout(60000);

// Cleanup handler
afterAll(async () => {
  // Restore original PATH
  process.env['PATH'] = originalPath;
});

// Console output filter for cleaner test output
const originalConsoleError = console.error;
console.error = (...args: any[]) => {
  // Filter out some noisy warnings
  const message = args.join(' ');
  if (message.includes('[MOCK]') && !process.env['MOCK_AGENT_DEBUG']) {
    return;
  }
  originalConsoleError.apply(console, args);
};

// Re-export TestMode and mockAgentPath for backward compatibility
const mockAgentPath = TestMode.mockAgentDir;
export { mockAgentPath, TestMode };


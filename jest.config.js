/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  
  // Use projects for different test configurations
  projects: [
    // Unit tests (fast, no external dependencies)
    {
      displayName: 'unit',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: [
        '**/tests/cli/**/*.test.ts',
        '**/tests/core/**/*.test.ts',
        '**/tests/utils/**/*.test.ts',
        '**/tests/ui/**/*.test.ts',
        '**/tests/types/**/*.test.ts',
      ],
      testPathIgnorePatterns: [
        '<rootDir>/node_modules/',
        '<rootDir>/_cursorflow/',
        '<rootDir>/test-projects/',
        '<rootDir>/examples/',
      ],
      modulePathIgnorePatterns: [
        '<rootDir>/_cursorflow/',
        '<rootDir>/test-projects/',
        '<rootDir>/examples/',
      ],
    },
    
    // Contract tests (API schema validation, mock or real agent)
    {
      displayName: 'contract',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['**/tests/contract/**/*.test.ts'],
      testTimeout: 30000,  // 30 seconds for contract tests
      testPathIgnorePatterns: [
        '<rootDir>/node_modules/',
        '<rootDir>/_cursorflow/',
        '<rootDir>/test-projects/',
        '<rootDir>/examples/',
      ],
      modulePathIgnorePatterns: [
        '<rootDir>/_cursorflow/',
        '<rootDir>/test-projects/',
        '<rootDir>/examples/',
      ],
    },
    
    // Integration tests (mock agent + real git, longer timeout)
    {
      displayName: 'integration',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['**/tests/integration/**/*.test.ts'],
      testTimeout: 60000,  // 60 seconds for integration tests
      testPathIgnorePatterns: [
        '<rootDir>/node_modules/',
        '<rootDir>/_cursorflow/',
        '<rootDir>/test-projects/',
        '<rootDir>/examples/',
      ],
      modulePathIgnorePatterns: [
        '<rootDir>/_cursorflow/',
        '<rootDir>/test-projects/',
        '<rootDir>/examples/',
      ],
      // Setup file for integration tests
      setupFilesAfterEnv: ['<rootDir>/tests/helpers/setup.ts'],
    },
    
    // E2E tests (full orchestration, very long timeout)
    {
      displayName: 'e2e',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['**/tests/e2e/**/*.test.ts'],
      testTimeout: 120000,  // 2 minutes for e2e tests
      testPathIgnorePatterns: [
        '<rootDir>/node_modules/',
        '<rootDir>/_cursorflow/',
        '<rootDir>/test-projects/',
        '<rootDir>/examples/',
      ],
      modulePathIgnorePatterns: [
        '<rootDir>/_cursorflow/',
        '<rootDir>/test-projects/',
        '<rootDir>/examples/',
      ],
      // Setup file for e2e tests
      setupFilesAfterEnv: ['<rootDir>/tests/helpers/setup.ts'],
    },
    
    // Smoke tests (real CLI execution, real verification)
    {
      displayName: 'smoke',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['**/tests/smoke/**/*.test.ts'],
      testTimeout: 120000,  // 2 minutes for smoke tests
      testPathIgnorePatterns: [
        '<rootDir>/node_modules/',
        '<rootDir>/_cursorflow/',
        '<rootDir>/examples/',
      ],
      modulePathIgnorePatterns: [
        '<rootDir>/_cursorflow/',
        '<rootDir>/examples/',
      ],
    },
  ],
};

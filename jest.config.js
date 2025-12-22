/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['**/tests/**/*.test.ts', '**/src/**/__tests__/*.test.ts'],
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/test-projects/',
    '<rootDir>/examples/'
  ],
  modulePathIgnorePatterns: [
    '<rootDir>/test-projects/',
    '<rootDir>/examples/'
  ],
};

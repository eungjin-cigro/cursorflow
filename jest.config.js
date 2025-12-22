/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/_cursorflow/',
    '<rootDir>/test-projects/',
    '<rootDir>/examples/'
  ],
  modulePathIgnorePatterns: [
    '<rootDir>/_cursorflow/',
    '<rootDir>/test-projects/',
    '<rootDir>/examples/'
  ],
};

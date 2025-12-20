/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/_cursorflow/',
    '/test-projects/',
    '/examples/'
  ],
  modulePathIgnorePatterns: [
    '/_cursorflow/',
    '/test-projects/',
    '/examples/'
  ],
};

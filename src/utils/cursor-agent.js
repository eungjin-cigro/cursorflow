#!/usr/bin/env node
/**
 * Cursor Agent CLI wrapper and utilities
 */

const { execSync, spawnSync } = require('child_process');

/**
 * Check if cursor-agent CLI is installed
 */
function checkCursorAgentInstalled() {
  try {
    execSync('cursor-agent --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get cursor-agent version
 */
function getCursorAgentVersion() {
  try {
    const version = execSync('cursor-agent --version', {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
    return version;
  } catch {
    return null;
  }
}

/**
 * Ensure cursor-agent is installed, exit with error message if not
 */
function ensureCursorAgent() {
  if (!checkCursorAgentInstalled()) {
    console.error(`
❌ cursor-agent CLI is not installed

Installation:
  npm install -g @cursor/agent
  # or
  pnpm add -g @cursor/agent
  # or
  yarn global add @cursor/agent

More info: https://docs.cursor.com/agent
    `);
    process.exit(1);
  }
}

/**
 * Print installation guide
 */
function printInstallationGuide() {
  console.log(`
📦 cursor-agent CLI Installation Guide

The cursor-agent CLI is required to run CursorFlow orchestration.

Installation methods:

  npm install -g @cursor/agent
  pnpm add -g @cursor/agent
  yarn global add @cursor/agent

Verification:

  cursor-agent --version

Documentation:

  https://docs.cursor.com/agent

After installation, run your command again.
  `);
}

/**
 * Check if CURSOR_API_KEY is set (for cloud execution)
 */
function checkCursorApiKey() {
  return !!process.env.CURSOR_API_KEY;
}

/**
 * Validate cursor-agent setup for given executor type
 */
function validateSetup(executor = 'cursor-agent') {
  const errors = [];
  
  if (executor === 'cursor-agent') {
    if (!checkCursorAgentInstalled()) {
      errors.push('cursor-agent CLI is not installed');
    }
  }
  
  if (executor === 'cloud') {
    if (!checkCursorApiKey()) {
      errors.push('CURSOR_API_KEY environment variable is not set');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get available models (if cursor-agent supports it)
 */
function getAvailableModels() {
  try {
    // This is a placeholder - actual implementation depends on cursor-agent API
    const result = execSync('cursor-agent --model invalid "test"', {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    
    // Parse models from error message
    // This is an example - actual parsing depends on cursor-agent output
    return [];
  } catch (error) {
    // Parse from error message
    const output = error.stderr || error.stdout || '';
    // Extract model names from output
    return parseModelsFromOutput(output);
  }
}

/**
 * Parse model names from cursor-agent output
 */
function parseModelsFromOutput(output) {
  // This is a placeholder implementation
  // Actual parsing depends on cursor-agent CLI output format
  const models = [];
  
  // Example parsing logic
  const lines = output.split('\n');
  for (const line of lines) {
    if (line.includes('sonnet') || line.includes('opus') || line.includes('gpt')) {
      const match = line.match(/['"]([^'"]+)['"]/);
      if (match) {
        models.push(match[1]);
      }
    }
  }
  
  return models;
}

/**
 * Test cursor-agent with a simple command
 */
function testCursorAgent() {
  try {
    const result = spawnSync('cursor-agent', ['--help'], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    
    return {
      success: result.status === 0,
      output: result.stdout,
      error: result.stderr,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

module.exports = {
  checkCursorAgentInstalled,
  getCursorAgentVersion,
  ensureCursorAgent,
  printInstallationGuide,
  checkCursorApiKey,
  validateSetup,
  getAvailableModels,
  testCursorAgent,
};

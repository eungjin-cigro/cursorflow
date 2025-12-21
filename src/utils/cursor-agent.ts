/**
 * Cursor Agent CLI wrapper and utilities
 */

import { execSync, spawnSync } from 'child_process';

/**
 * Check if cursor-agent CLI is installed
 */
export function checkCursorAgentInstalled(): boolean {
  try {
    const result = spawnSync('cursor-agent', ['--version'], { stdio: 'pipe' });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Get cursor-agent version
 */
export function getCursorAgentVersion(): string | null {
  try {
    const result = spawnSync('cursor-agent', ['--version'], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return result.status === 0 ? result.stdout.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Ensure cursor-agent is installed, exit with error message if not
 */
export function ensureCursorAgent(): void {
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
export function printInstallationGuide(): void {
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
export function checkCursorApiKey(): boolean {
  return !!process.env['CURSOR_API_KEY'];
}

/**
 * Validate cursor-agent setup for given executor type
 */
export function validateSetup(executor = 'cursor-agent'): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
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
export function getAvailableModels(): string[] {
  // Known models in the current version of cursor-agent
  const knownModels = [
    'sonnet-4.5',
    'sonnet-4.5-thinking',
    'opus-4.5',
    'opus-4.5-thinking',
    'gpt-5.2',
    'gpt-5.2-high',
  ];

  try {
    // Try to trigger a model list by using an invalid model with --print
    // Some versions of cursor-agent output valid models when an invalid one is used.
    const result = spawnSync('cursor-agent', ['--print', '--model', 'list-available-models', 'test'], {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 5000,
    });
    
    const output = (result.stderr || result.stdout || '').toString();
    const discoveredModels = parseModelsFromOutput(output);
    
    if (discoveredModels.length > 0) {
      return [...new Set([...knownModels, ...discoveredModels])];
    }
    
    return knownModels;
  } catch (error: any) {
    return knownModels;
  }
}

/**
 * Parse model names from cursor-agent output
 */
export function parseModelsFromOutput(output: string): string[] {
  // This is a placeholder implementation
  // Actual parsing depends on cursor-agent CLI output format
  const models: string[] = [];
  
  // Example parsing logic
  const lines = output.split('\n');
  for (const line of lines) {
    if (line.includes('sonnet') || line.includes('opus') || line.includes('gpt')) {
      const match = line.match(/['"]([^'"]+)['"]/);
      if (match) {
        models.push(match[1]!);
      }
    }
  }
  
  return models;
}

/**
 * Test cursor-agent with a simple command
 */
export function testCursorAgent(): { success: boolean; output?: string; error?: string } {
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
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Run interactive agent test to prime permissions (MCP, user approval, etc.)
 */
export function runInteractiveAgentTest(): boolean {
  const { spawnSync } = require('child_process');
  
  console.log('\n' + '━'.repeat(60));
  console.log('🤖 Interactive Agent Priming Test');
  console.log('━'.repeat(60));
  console.log('\nThis will start cursor-agent in interactive mode (NOT --print).');
  console.log('Use this to approve MCP permissions or initial setup requests.\n');
  console.log('MISSION: Just say hello and confirm MCP connectivity.');
  console.log('ACTION: Once the agent responds and finishes, you can exit.');
  console.log('\n' + '─'.repeat(60) + '\n');

  try {
    // Run WITHOUT --print to allow interactive user input and UI popups
    const result = spawnSync('cursor-agent', ['Hello, verify MCP and system access.'], {
      stdio: 'inherit', // Crucial for interactivity
      env: process.env,
    });

    console.log('\n' + '─'.repeat(60));
    if (result.status === 0) {
      console.log('✅ Interactive test completed successfully!');
      return true;
    } else {
      console.log('❌ Interactive test exited with code: ' + result.status);
      return false;
    }
  } catch (error: any) {
    console.log('❌ Failed to run interactive test: ' + error.message);
    return false;
  }
}

export interface AuthCheckResult {
  authenticated: boolean;
  message: string;
  details?: string;
  help?: string;
  error?: string;
}

/**
 * Check cursor-agent authentication
 */
export function checkCursorAuth(): AuthCheckResult {
  try {
    const result = spawnSync('cursor-agent', ['create-chat'], {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 10000, // 10 second timeout
    });
    
    if (result.status === 0 && result.stdout.trim()) {
      return {
        authenticated: true,
        message: 'Cursor authentication OK',
      };
    }
    
    const errorMsg = (result.stderr?.trim() || result.stdout?.trim() || '').toString();
    
    // Check for authentication errors
    if (errorMsg.includes('not authenticated') || 
        errorMsg.includes('login') || 
        errorMsg.includes('auth')) {
      return {
        authenticated: false,
        message: 'Not authenticated with Cursor',
        details: errorMsg,
        help: 'Please open Cursor IDE and sign in to your account',
      };
    }
    
    // Check for network errors
    if (errorMsg.includes('network') || 
        errorMsg.includes('connection') ||
        errorMsg.includes('timeout')) {
      return {
        authenticated: false,
        message: 'Network error',
        details: errorMsg,
        help: 'Check your internet connection',
      };
    }
    
    return {
      authenticated: false,
      message: 'Unknown error',
      details: errorMsg,
    };
  } catch (error: any) {
    if (error.code === 'ETIMEDOUT') {
      return {
        authenticated: false,
        message: 'Connection timeout',
        help: 'Check your internet connection',
      };
    }
    
    return {
      authenticated: false,
      message: 'Failed to check authentication',
      error: error.message,
    };
  }
}

/**
 * Print authentication help
 */
export function printAuthHelp(): void {
  console.log(`
🔐 Cursor Authentication Required

CursorFlow requires an authenticated Cursor session to use AI features.

Steps to authenticate:

  1. Open Cursor IDE
  2. Sign in to your Cursor account (if not already)
  3. Verify AI features work in the IDE
  4. Run your CursorFlow command again

Common issues:

  • Not signed in to Cursor
  • Subscription expired or inactive
  • Network connectivity issues
  • VPN or firewall blocking Cursor API

For more help, visit: https://docs.cursor.com
  `);
}

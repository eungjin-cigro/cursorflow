#!/usr/bin/env node
/**
 * Test cursor-agent authentication
 */

const { 
  checkCursorAgentInstalled, 
  checkCursorAuth, 
  printAuthHelp 
} = require('./src/utils/cursor-agent');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  🔍 Cursor Agent Authentication Test');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Check if cursor-agent is installed
console.log('1. Checking cursor-agent installation...');
const installed = checkCursorAgentInstalled();

if (!installed) {
  console.log('   ❌ cursor-agent is NOT installed\n');
  console.log('   Install with: npm install -g @cursor/agent\n');
  process.exit(1);
}

console.log('   ✅ cursor-agent is installed\n');

// Check authentication
console.log('2. Checking Cursor authentication...');
console.log('   (This may take a few seconds...)\n');

const authStatus = checkCursorAuth();

if (authStatus.authenticated) {
  console.log('   ✅ Authentication successful!\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  🎉 You\'re ready to use CursorFlow!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.exit(0);
} else {
  console.log('   ❌ Authentication failed\n');
  console.log(`   Reason: ${authStatus.message}`);
  
  if (authStatus.details) {
    console.log(`   Details: ${authStatus.details}`);
  }
  
  if (authStatus.help) {
    console.log(`   Help: ${authStatus.help}`);
  }
  
  console.log('');
  printAuthHelp();
  process.exit(1);
}


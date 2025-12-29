/**
 * Test script for log parsing using existing LogBufferService
 * 
 * Uses the production logging modules to parse and display logs,
 * comparing with actual terminal output.
 * 
 * Usage: npx ts-node scripts/test-log-parser.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { createLogBuffer } from '../src/services/logging/buffer';
import { StreamingMessageParser } from '../src/services/logging/parser';
import { formatMessageForConsole, stripAnsi } from '../src/services/logging/formatter';
import { ParsedMessage } from '../src/types/logging';

const FIXTURES_DIR = path.join(__dirname, '../tests/fixtures/real-agent-logs/sample-run');

async function main() {
  console.log('='.repeat(80));
  console.log('📋 Log Parser Test - Using Production Modules');
  console.log('='.repeat(80));
  console.log(`\nFixtures directory: ${FIXTURES_DIR}\n`);

  // Check if fixtures exist
  if (!fs.existsSync(FIXTURES_DIR)) {
    console.error('❌ Fixtures not found! Run E2E tests first to generate logs.');
    console.error('   npm run test:e2e:real');
    process.exit(1);
  }

  // ===========================================================================
  // Test 1: LogBufferService (Production streaming service)
  // ===========================================================================
  console.log('━'.repeat(80));
  console.log('  📦 Test 1: LogBufferService (Production Module)');
  console.log('━'.repeat(80) + '\n');

  const logBuffer = createLogBuffer(FIXTURES_DIR);

  // Start streaming to read logs
  logBuffer.startStreaming();

  // Wait a moment for initial poll
  await new Promise(resolve => setTimeout(resolve, 200));

  const entries = logBuffer.getEntries({ limit: 1000, fromEnd: false });
  const state = logBuffer.getState();

  console.log(`📊 LogBufferService Stats:`);
  console.log(`   Total entries: ${state.totalEntries}`);
  console.log(`   Lanes: ${state.lanes.join(', ') || 'none'}`);
  console.log(`   Streaming: ${state.isStreaming}`);

  logBuffer.stopStreaming();

  if (entries.length > 0) {
    console.log(`\n📝 First 15 entries (formatted by LogBufferService):`);
    console.log('-'.repeat(60));
    for (const entry of entries.slice(0, 15)) {
      const formatted = logBuffer.formatEntry(entry, { showLane: true, showTimestamp: true });
      console.log(stripAnsi(formatted).substring(0, 100));
    }
  }

  // ===========================================================================
  // Test 2: StreamingMessageParser (JSONL parsing)
  // ===========================================================================
  console.log('\n' + '━'.repeat(80));
  console.log('  📦 Test 2: StreamingMessageParser (JSONL Parsing)');
  console.log('━'.repeat(80) + '\n');

  const jsonlLogPath = path.join(FIXTURES_DIR, 'lanes/test-lane/terminal.jsonl');
  if (fs.existsSync(jsonlLogPath)) {
    const jsonlLog = fs.readFileSync(jsonlLogPath, 'utf8');
    const lines = jsonlLog.split('\n').filter(l => l.trim());
    
    console.log(`📄 JSONL log: ${jsonlLogPath}`);
    console.log(`   Total lines: ${lines.length}`);
    
    // Parse with StreamingMessageParser
    const parsedMessages: ParsedMessage[] = [];
    const parser = new StreamingMessageParser((msg) => {
      parsedMessages.push(msg);
    });
    
    for (const line of lines) {
      parser.parseLine(line);
    }
    parser.flush();
    
    console.log(`   Parsed messages: ${parsedMessages.length}\n`);
    
    // Type distribution
    const typeCount: Record<string, number> = {};
    for (const msg of parsedMessages) {
      typeCount[msg.type] = (typeCount[msg.type] || 0) + 1;
    }
    
    console.log('Message types:');
    for (const [type, count] of Object.entries(typeCount).sort((a, b) => b[1] - a[1])) {
      console.log(`   ${type.padEnd(15)}: ${count}`);
    }
    
    // Show formatted messages
    console.log(`\n📝 Formatted output (using formatMessageForConsole):`);
    console.log('-'.repeat(60));
    for (const msg of parsedMessages.slice(0, 15)) {
      const formatted = formatMessageForConsole(msg, {
        includeTimestamp: true,
        laneLabel: '[1-1-test-lan]',
        compact: true,
        showBorders: false,
      });
      console.log(stripAnsi(formatted).substring(0, 100));
    }
  } else {
    console.log('⚠️ JSONL log not found at:', jsonlLogPath);
  }

  // ===========================================================================
  // Test 3: Summary
  // ===========================================================================
  console.log('\n' + '='.repeat(80));
  console.log('✅ Log Parser Test Complete');
  console.log('='.repeat(80));
  console.log('\n📁 Modules used:');
  console.log('   - LogBufferService: src/services/logging/buffer.ts');
  console.log('   - StreamingMessageParser: src/services/logging/parser.ts');
  console.log('   - formatMessageForConsole: src/services/logging/formatter.ts');
}

// Run the tests
main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

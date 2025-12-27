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

  const rawLogPath = path.join(FIXTURES_DIR, 'lanes/test-lane/terminal-raw.log');
  if (fs.existsSync(rawLogPath)) {
    const rawLog = fs.readFileSync(rawLogPath, 'utf8');
    const lines = rawLog.split('\n');
    const jsonLines = lines.filter(l => l.trim().startsWith('{') && l.trim().endsWith('}'));
    
    console.log(`📄 Raw log: ${rawLogPath}`);
    console.log(`   Total lines: ${lines.length}`);
    console.log(`   JSON lines: ${jsonLines.length}`);
    
    // Parse with StreamingMessageParser
    const parsedMessages: ParsedMessage[] = [];
    const parser = new StreamingMessageParser((msg) => {
      parsedMessages.push(msg);
    });
    
    for (const line of jsonLines) {
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
    console.log('⚠️ Raw log not found at:', rawLogPath);
  }

  // ===========================================================================
  // Test 3: Compare with actual readable log
  // ===========================================================================
  console.log('\n' + '━'.repeat(80));
  console.log('  🔍 Test 3: Compare Parser Output with Actual Log');
  console.log('━'.repeat(80) + '\n');

  const readableLogPath = path.join(FIXTURES_DIR, 'lanes/test-lane/terminal-readable.log');
  if (fs.existsSync(readableLogPath)) {
    const readableLog = fs.readFileSync(readableLogPath, 'utf8');
    const readableLines = readableLog.split('\n');
    
    // Find agent message lines
    const agentLines = readableLines.filter(line => 
      line.includes('⚙️ SYS') || 
      line.includes('🧑 USER') || 
      line.includes('🤖 ASST') || 
      line.includes('🔧 TOOL') || 
      line.includes('📄 RESL')
    );
    
    console.log(`📄 Readable log: ${readableLogPath}`);
    console.log(`   Total lines: ${readableLines.length}`);
    console.log(`   Agent message lines: ${agentLines.length}`);
    
    console.log(`\n📝 Actual terminal output (first 15 agent messages):`);
    console.log('-'.repeat(60));
    for (const line of agentLines.slice(0, 15)) {
      console.log(stripAnsi(line).substring(0, 100));
    }
  }

  // ===========================================================================
  // Summary
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

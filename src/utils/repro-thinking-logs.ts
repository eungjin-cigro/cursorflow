import * as fs from 'fs';
import * as path from 'path';
import { createLogManager } from './enhanced-logger';
import { getLaneLogPath } from '../services/logging/paths';

async function testThinkingLogs() {
  const testDir = path.join(process.cwd(), '_test_thinking_logs');
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  console.log('--- Initializing Log Manager ---');
  const manager = createLogManager(testDir, 'test-lane-thinking', {
    writeJsonLog: true,
    keepRawLogs: true
  });

  manager.setTask('repro-thinking-task', 'sonnet-4.5-thinking');

  const logLines = [
    '{"type":"tool_call","subtype":"started","call_id":"0_tool_54a8fcc9-6981-4f59-aeb6-3ab6d37b2","tool_call":{"readToolCall":{"args":{"path":"/home/eugene/workbench/workbench-os-eungjin/_cursorflow/worktrees/cursorflow/run-mjfxp57i/agent_output.txt"}}}}',
    '{"type":"thinking","subtype":"delta","text":"**Defining Installation Strategy**\\n\\nI\'ve considered the `package.json` file as the central point for installation in automated environments. Thinking now about how that impacts the user\'s ultimate goal, given this is how the process begins in these environments.\\n\\n\\n"}',
    '{"type":"thinking","subtype":"delta","text":"**Clarifying Execution Context**\\n\\nI\'m focused on the user\'s explicit command: `pnpm add @convex-dev/agent ai @ai-sdk/google zod`. My inability to directly execute this is a key constraint. I\'m exploring ways to inform the user about this. I\'ve considered that, without the tools required to run the original command, any attempt to run a command like `grep` or `date` is pointless and will fail.\\n\\n\\n"}',
    '{"type":"tool_call","subtype":"started","call_id":"0_tool_d8f826c8-9d8f-4cab-9ff8-1c47d1ac1","tool_call":{"shellToolCall":{"args":{"command":"date"}}}}'
  ];

  console.log('\n--- Feeding Log Lines to Manager ---');
  for (const line of logLines) {
    console.log('Processing:', line.substring(0, 100) + '...');
    manager.writeStdout(line + '\n');
  }

  manager.close();

  console.log('\n--- Verifying terminal-raw.log ---');
  const rawLog = fs.readFileSync(getLaneLogPath(testDir, 'raw'), 'utf8');
  console.log(rawLog);
}

testThinkingLogs().catch(console.error);

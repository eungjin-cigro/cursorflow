
import { formatMessageForConsole } from './src/utils/log-formatter';

const samples = [
  {
    type: 'tool',
    content: '[Tool: read_file] {"target_file": "/home/eugene/workbench/workbench-os-eungjin/_curso/src/index.ts"}',
    laneLabel: '[1-1-tool       ]'
  },
  {
    type: 'tool_result',
    content: '[Tool Result: read_file]',
    laneLabel: '[1-1-tool       ]'
  }
];

console.log('--- Tool Verification ---');
for (const s of samples) {
  const formatted = formatMessageForConsole({
    type: s.type as any,
    content: s.content,
    timestamp: Date.now(),
    role: s.type as any
  }, { 
    laneLabel: s.laneLabel,
    includeTimestamp: true 
  });
  if (formatted) {
    console.log(formatted);
  } else {
    console.log(`(Skipped ${s.type})`);
  }
}


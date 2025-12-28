
import { formatMessageForConsole } from './src/utils/log-formatter';

const samples = [
  {
    type: 'tool',
    content: '[Tool: read_file] {"target_file": "/home/eugene/workbench/workbench-os-eungjin/_curso/src/index.ts"}',
    laneLabel: '[1-1-tool       ]'
  },
  {
    type: 'tool',
    content: '[Tool: search_replace] {"file_path": "/home/eugene/workbench/workbench-os-eungjin/_curso/src/index.ts", "old_string": "foo", "new_string": "bar"}',
    laneLabel: '[1-1-tool       ]'
  },
  {
    type: 'tool',
    content: '[Tool: run_terminal_cmd] {"command": "npm test"}',
    laneLabel: '[1-1-tool       ]'
  }
];

console.log('--- Specific Tool Verification ---');
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
  console.log(formatted);
}


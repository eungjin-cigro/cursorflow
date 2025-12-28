
import { formatMessageForConsole } from './src/utils/log-formatter';

const samples = [
  {
    type: 'info',
    content: 'Merging task verify into branch...',
    laneLabel: ''
  },
  {
    type: 'raw',
    content: 'Switched to branch \'cursorflow/run-...\'',
    laneLabel: '[4-1-shared-u]'
  },
  {
    type: 'user',
    content: 'Hello world',
    laneLabel: '[1-1-shared-u]'
  },
  {
    type: 'system',
    content: 'Model: Gemini...',
    laneLabel: '[1-1-shared-u]'
  }
];

console.log('--- Consistency Verification ---');
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


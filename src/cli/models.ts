/**
 * CursorFlow models command
 * 
 * List available models
 */

import * as logger from '../utils/logger';
import { getAvailableModels } from '../utils/cursor-agent';

/**
 * Model details metadata
 */
const MODEL_METADATA: Record<string, { name: string; provider: string; description: string }> = {
  'sonnet-4.5': { name: 'Claude 3.7 Sonnet', provider: 'Anthropic', description: 'General implementation, fast work (Most versatile)' },
  'sonnet-4.5-thinking': { name: 'Claude 3.7 Sonnet (Thinking)', provider: 'Anthropic', description: 'Code review, deeper reasoning (Thinking model)' },
  'opus-4.5': { name: 'Claude 4.0 Opus', provider: 'Anthropic', description: 'Complex tasks, high quality (Advanced)' },
  'opus-4.5-thinking': { name: 'Claude 4.0 Opus (Thinking)', provider: 'Anthropic', description: 'Architecture design (Premium)' },
  'gpt-5.2': { name: 'GPT-5.2', provider: 'OpenAI', description: 'General tasks' },
  'gpt-5.2-high': { name: 'GPT-5.2 High Reasoning', provider: 'OpenAI', description: 'Advanced reasoning (High performance)' },
  'gemini-3-flash': { name: 'Gemini 3 Flash', provider: 'Google', description: 'General tasks' },
  'gemini-3-pro': { name: 'Gemini 3 Pro', provider: 'Google', description: 'Advanced reasoning (High performance)' }
};

function printHelp(): void {
  console.log(`
Usage: cursorflow models [options]

List available AI models for use in tasks.

Options:
  --list, -l         List models in a table (default)
  --json             Output as JSON
  --help, -h         Show help

Examples:
  cursorflow models
  cursorflow models --json
  `);
}

async function models(args: string[]): Promise<void> {
  const isJson = args.includes('--json');
  const isHelp = args.includes('--help') || args.includes('-h');

  if (isHelp) {
    printHelp();
    return;
  }

  // Fetch available models from cursor-agent
  const availableModelIds = getAvailableModels();
  
  const modelsData = availableModelIds.map(id => {
    const meta = MODEL_METADATA[id] || { 
      name: id, 
      provider: 'Unknown', 
      description: 'Discovered via cursor-agent' 
    };
    return { id, ...meta };
  });

  if (isJson) {
    console.log(JSON.stringify(modelsData, null, 2));
    return;
  }

  logger.section('🤖 Available AI Models (from cursor-agent)');
  
  const maxIdLen = Math.max(...modelsData.map(m => m.id.length), 10);
  const maxNameLen = Math.max(...modelsData.map(m => m.name.length), 15);
  const maxProviderLen = Math.max(...modelsData.map(m => m.provider.length), 10);

  console.log(`  ${'ID'.padEnd(maxIdLen)}  ${'Name'.padEnd(maxNameLen)}  ${'Provider'.padEnd(maxProviderLen)}  Description`);
  console.log(`  ${'─'.repeat(maxIdLen)}  ${'─'.repeat(maxNameLen)}  ${'─'.repeat(maxProviderLen)}  ${'─'.repeat(30)}`);

  for (const m of modelsData) {
    console.log(`  ${m.id.padEnd(maxIdLen)}  ${m.name.padEnd(maxNameLen)}  ${m.provider.padEnd(maxProviderLen)}  ${m.description}`);
  }

  console.log('\n💡 Tip: Use these IDs in your task JSON files under the "model" field.\n');
}

export = models;

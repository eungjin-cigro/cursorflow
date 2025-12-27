import { cursorAgentCreateChat, cursorAgentSend } from './runner/agent';
import { events } from '../utils/events';
import { AgentSendResult } from '../types';
import { analyzeFailure, logFailure } from './failure-policy';

export interface AgentPromptOptions {
  workspaceDir: string;
  chatId: string;
  prompt: string;
  model?: string;
  laneName?: string;
  signalDir?: string;
  timeout?: number;
  enableIntervention?: boolean;
  outputFormat?: 'json' | 'stream-json';
  taskName?: string;
}

export class AgentSupervisor {
  createChat(workspaceDir?: string): string {
    return cursorAgentCreateChat(workspaceDir);
  }

  async sendTaskPrompt(options: AgentPromptOptions): Promise<AgentSendResult> {
    const startTime = Date.now();

    events.emit('agent.prompt_sent', {
      taskName: options.taskName || 'task',
      model: options.model || 'unknown',
      promptLength: options.prompt.length,
    });

    const result = await cursorAgentSend(options);
    const duration = Date.now() - startTime;

    events.emit('agent.response_received', {
      taskName: options.taskName || 'task',
      ok: result.ok,
      duration,
      responseLength: result.resultText?.length || 0,
      error: result.error,
    });

    if (!result.ok) {
      const analysis = analyzeFailure(result.error, {
        circuitBreakerName: options.laneName,
      });
      logFailure(options.laneName || options.taskName || 'agent', analysis);
      events.emit('agent.recovery_suggested', {
        laneName: options.laneName,
        taskName: options.taskName || 'task',
        analysis,
      });
    }

    return result;
  }
}

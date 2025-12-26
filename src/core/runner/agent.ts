import { spawn, spawnSync, ChildProcess } from 'child_process';
import * as logger from '../../utils/logger';
import { AgentSendResult, DependencyRequestPlan } from '../../types';
import { withRetry } from '../failure-policy';
import * as path from 'path';
import * as fs from 'fs';
import { appendLog, createConversationEntry } from '../../utils/state';

/**
 * Track active child processes for cleanup
 */
const activeChildren = new Set<ChildProcess>();

/**
 * Cleanup all active children
 */
export function cleanupAgentChildren(): void {
  if (activeChildren.size > 0) {
    logger.warn(`Cleaning up ${activeChildren.size} active agent child processes...`);
    for (const child of activeChildren) {
      if (!child.killed) {
        try {
          child.kill('SIGKILL');
        } catch {
          // Ignore
        }
      }
    }
    activeChildren.clear();
  }
}

/**
 * Execute cursor-agent command with timeout and better error handling
 */
export function cursorAgentCreateChat(workspaceDir?: string): string {
  try {
    const args = ['create-chat'];
    if (workspaceDir) {
      args.push('--workspace', workspaceDir);
    }

    const res = spawnSync('cursor-agent', args, {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 30000, // 30 second timeout
      cwd: workspaceDir || process.cwd(),
    });
    
    if (res.error || res.status !== 0) {
      throw res.error || new Error(res.stderr || 'Failed to create chat');
    }

    const out = res.stdout;
    const lines = out.split('\n').filter(Boolean);
    const chatId = lines[lines.length - 1] || null;
    
    if (!chatId) {
      throw new Error('Failed to get chat ID from cursor-agent');
    }
    
    logger.info(`Created chat session: ${chatId}`);
    return chatId;
  } catch (error: any) {
    // Check for common errors
    if (error.message.includes('ENOENT')) {
      throw new Error('cursor-agent CLI not found. Install with: npm install -g @cursor/agent');
    }
    
    if (error.message.includes('ETIMEDOUT') || error.killed) {
      throw new Error('cursor-agent timed out. Check your internet connection and Cursor authentication.');
    }
    
    if (error.stderr) {
      const stderr = error.stderr.toString();
      
      // Check for authentication errors
      if (stderr.includes('not authenticated') || 
          stderr.includes('login') || 
          stderr.includes('auth')) {
        throw new Error(
          'Cursor authentication failed. Please:\n' +
          '  1. Open Cursor IDE\n' +
          '  2. Sign in to your account\n' +
          '  3. Verify you can use AI features\n' +
          '  4. Try running cursorflow again\n\n' +
          `Original error: ${stderr.trim()}`
        );
      }
      
      // Check for API key errors
      if (stderr.includes('api key') || stderr.includes('API_KEY')) {
        throw new Error(
          'Cursor API key error. Please check your Cursor account and subscription.\n' +
          `Error: ${stderr.trim()}`
        );
      }
    }
    
    throw error;
  }
}

/**
 * Helper to parse JSON from stdout
 */
function parseJsonFromStdout(stdout: string): any {
  if (!stdout) return null;
  
  // Try to find JSON in the output (sometimes mixed with other text)
  const lines = stdout.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (line.startsWith('{') && line.endsWith('}')) {
      try {
        return JSON.parse(line);
      } catch {
        // Continue searching
      }
    }
  }
  
  // If no single-line JSON, try the whole stdout
  try {
    return JSON.parse(stdout.trim());
  } catch {
    return null;
  }
}

/**
 * Execute cursor-agent command with timeout and better error handling
 */
async function cursorAgentSendRaw({ workspaceDir, chatId, prompt, model, signalDir, timeout, enableIntervention, outputFormat, taskName }: { 
  workspaceDir: string; 
  chatId: string; 
  prompt: string; 
  model?: string; 
  signalDir?: string;
  timeout?: number;
  enableIntervention?: boolean;
  outputFormat?: 'json' | 'plain' | 'stream-json';
  taskName?: string;
}): Promise<AgentSendResult> {
  const timeoutMs = timeout || 10 * 60 * 1000; // 10 minutes default
  const args = ['send', chatId, prompt];
  
  if (model) {
    args.push('--model', model);
  }
  
  if (outputFormat === 'json' || outputFormat === 'stream-json') {
    args.push('--print', '--output-format', 'json');
  }

  // Ensure non-interactive execution with automatic approvals
  args.push('--force', '--approve-mcps');

  // Add worktree context if provided
  if (workspaceDir) {
    args.push('--workspace', workspaceDir);
  }

  return new Promise((resolve) => {
    logger.info(`Sending prompt to cursor-agent (timeout: ${Math.round(timeoutMs / 1000)}s)...`);
    
    const child = spawn('cursor-agent', args, {
      cwd: workspaceDir || process.cwd(),
      stdio: enableIntervention ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    });

    activeChildren.add(child);

    if (!enableIntervention) {
      logger.info('ℹ️ Intervention is disabled. Stall recovery using "continue" will not be available for this agent session.');
    }

    let fullStdout = '';
    let fullStderr = '';
    let timeoutHandle: NodeJS.Timeout;
    let heartbeatInterval: NodeJS.Timeout | undefined;
    let lastActivity = Date.now();
    let bytesReceived = 0;

    // Signal watching for intervention and timeout
    let signalWatcher: fs.FSWatcher | null = null;
    if (signalDir) {
      if (!fs.existsSync(signalDir)) {
        fs.mkdirSync(signalDir, { recursive: true });
      }
      
      const interventionPath = path.join(signalDir, 'intervention.txt');
      const timeoutPath = path.join(signalDir, 'timeout.txt');
      
      // Watch for intervention or timeout signals from UI
      signalWatcher = fs.watch(signalDir, (event, filename) => {
        if (filename === 'intervention.txt' && fs.existsSync(interventionPath)) {
          try {
            const message = fs.readFileSync(interventionPath, 'utf8').trim();
            if (message) {
              logger.info(`👋 Human intervention received: ${message.substring(0, 50)}...`);
              if (child.stdin && child.stdin.writable) {
                child.stdin.write(message + '\n');
                
                if (signalDir) {
                  const convoPath = path.join(signalDir, 'conversation.jsonl');
                  appendLog(convoPath, createConversationEntry('intervention', `[HUMAN INTERVENTION]: ${message}`, {
                    task: taskName || 'AGENT_TURN',
                    model: 'manual'
                  }));
                }
              } else {
                logger.warn(`Intervention requested but stdin not available: ${message}`);
              }
              fs.unlinkSync(interventionPath);
            }
          } catch {}
        }
        
        if (filename === 'timeout.txt' && timeoutPath && fs.existsSync(timeoutPath)) {
          try {
            const newTimeoutStr = fs.readFileSync(timeoutPath, 'utf8').trim();
            const newTimeoutMs = parseInt(newTimeoutStr);
            if (!isNaN(newTimeoutMs) && newTimeoutMs > 0) {
              logger.info(`⏱ Dynamic timeout update: ${Math.round(newTimeoutMs / 1000)}s`);
              if (timeoutHandle) clearTimeout(timeoutHandle);
              const elapsed = Date.now() - startTime;
              const remaining = Math.max(1000, newTimeoutMs - elapsed);
              timeoutHandle = setTimeout(() => {
                clearInterval(heartbeatInterval);
                child.kill();
                resolve({ ok: false, exitCode: -1, error: `cursor-agent timed out after updated limit.` });
              }, remaining);
              fs.unlinkSync(timeoutPath);
            }
          } catch {}
        }
      });
    }

    if (child.stdout) {
      child.stdout.on('data', (data) => {
        fullStdout += data.toString();
        bytesReceived += data.length;
        process.stdout.write(data);
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (data) => {
        fullStderr += data.toString();
        process.stderr.write(data);
      });
    }

    const startTime = Date.now();
    timeoutHandle = setTimeout(() => {
      clearInterval(heartbeatInterval);
      child.kill();
      resolve({
        ok: false,
        exitCode: -1,
        error: `cursor-agent timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
      });
    }, timeoutMs);

    child.on('close', (code) => {
      activeChildren.delete(child);
      clearTimeout(timeoutHandle);
      clearInterval(heartbeatInterval);
      if (signalWatcher) signalWatcher.close();
      
      const json = parseJsonFromStdout(fullStdout);
      
      if (code !== 0 || !json || json.type !== 'result') {
        let errorMsg = fullStderr.trim() || fullStdout.trim() || `exit=${code}`;
        resolve({ ok: false, exitCode: code ?? -1, error: errorMsg });
      } else {
        resolve({
          ok: !json.is_error,
          exitCode: code ?? 0,
          sessionId: json.session_id || chatId,
          resultText: json.result || '',
        });
      }
    });

    child.on('error', (err) => {
      activeChildren.delete(child);
      clearTimeout(timeoutHandle);
      if (signalWatcher) signalWatcher.close();
      resolve({ ok: false, exitCode: -1, error: `Failed to start cursor-agent: ${err.message}` });
    });
  });
}

/**
 * Execute cursor-agent command with retries for transient errors
 */
export async function cursorAgentSend(options: { 
  workspaceDir: string; 
  chatId: string; 
  prompt: string; 
  model?: string; 
  signalDir?: string;
  timeout?: number;
  enableIntervention?: boolean;
  outputFormat?: 'json' | 'plain' | 'stream-json';
  taskName?: string;
}): Promise<AgentSendResult> {
  const laneName = options.signalDir ? path.basename(path.dirname(options.signalDir)) : 'agent';
  
  return withRetry(
    laneName,
    () => cursorAgentSendRaw(options),
    (res) => ({ ok: res.ok, error: res.error }),
    { maxRetries: 3 }
  );
}

/**
 * Extract dependency change request from agent response
 */
export function extractDependencyRequest(text: string): { required: boolean; plan?: DependencyRequestPlan; raw: string } {
  const t = String(text || '');
  const marker = 'DEPENDENCY_CHANGE_REQUIRED';
  
  if (!t.includes(marker)) {
    return { required: false, raw: t };
  }
  
  const after = t.split(marker).slice(1).join(marker);
  const match = after.match(/\{[\s\S]*?\}/);
  
  if (match) {
    try {
      return {
        required: true,
        plan: JSON.parse(match[0]!) as DependencyRequestPlan,
        raw: t,
      };
    } catch {
      return { required: true, raw: t };
    }
  }
  
  return { required: true, raw: t };
}


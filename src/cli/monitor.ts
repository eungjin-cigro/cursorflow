/**
 * CursorFlow interactive monitor command
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as logger from '../utils/logger';
import { loadState, readLog } from '../utils/state';
import { LaneState, ConversationEntry } from '../utils/types';
import { loadConfig } from '../utils/config';
import { safeJoin } from '../utils/path';

interface LaneWithDeps {
  name: string;
  path: string;
  dependsOn: string[];
}

interface MonitorOptions {
  runDir?: string;
  interval: number;
  help: boolean;
}

function printHelp(): void {
  console.log(`
Usage: cursorflow monitor [run-dir] [options]

Interactive lane dashboard to track progress and dependencies.

Options:
  [run-dir]              Run directory to monitor (default: latest)
  --interval <seconds>   Refresh interval (default: 2)
  --help, -h             Show help
  `);
}

enum View {
  LIST,
  LANE_DETAIL,
  MESSAGE_DETAIL,
  FLOW,
  TERMINAL,
  INTERVENE,
  TIMEOUT
}

class InteractiveMonitor {
  private runDir: string;
  private interval: number;
  private view: View = View.LIST;
  private selectedLaneIndex: number = 0;
  private selectedMessageIndex: number = 0;
  private selectedLaneName: string | null = null;
  private lanes: LaneWithDeps[] = [];
  private currentLogs: ConversationEntry[] = [];
  private timer: NodeJS.Timeout | null = null;
  private scrollOffset: number = 0;
  private terminalScrollOffset: number = 0;
  private lastTerminalTotalLines: number = 0;
  private interventionInput: string = '';
  private timeoutInput: string = '';
  private notification: { message: string; type: 'info' | 'error' | 'success'; time: number } | null = null;

  constructor(runDir: string, interval: number) {
    this.runDir = runDir;
    this.interval = interval;
  }

  public async start() {
    this.setupTerminal();
    this.refresh();
    this.timer = setInterval(() => this.refresh(), this.interval * 1000);
  }

  private setupTerminal() {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    readline.emitKeypressEvents(process.stdin);
    process.stdin.on('keypress', (str, key) => {
      // Handle Ctrl+C
      if (key && key.ctrl && key.name === 'c') {
        this.stop();
        return;
      }

      // Safeguard against missing key object
      const keyName = key ? key.name : str;

      if (this.view === View.LIST) {
        this.handleListKey(keyName);
      } else if (this.view === View.LANE_DETAIL) {
        this.handleDetailKey(keyName);
      } else if (this.view === View.FLOW) {
        this.handleFlowKey(keyName);
      } else if (this.view === View.TERMINAL) {
        this.handleTerminalKey(keyName);
      } else if (this.view === View.INTERVENE) {
        this.handleInterveneKey(str, key);
      } else if (this.view === View.TIMEOUT) {
        this.handleTimeoutKey(str, key);
      } else if (this.view === View.MESSAGE_DETAIL) {
        this.handleMessageDetailKey(keyName);
      }
    });

    // Hide cursor
    process.stdout.write('\x1B[?25l');
  }

  private stop() {
    if (this.timer) clearInterval(this.timer);
    // Show cursor and clear screen
    process.stdout.write('\x1B[?25h');
    process.stdout.write('\x1Bc');
    console.log('\n👋 Monitoring stopped\n');
    process.exit(0);
  }

  private handleListKey(key: string) {
    switch (key) {
      case 'up':
        this.selectedLaneIndex = Math.max(0, this.selectedLaneIndex - 1);
        this.render();
        break;
      case 'down':
        this.selectedLaneIndex = Math.min(this.lanes.length - 1, this.selectedLaneIndex + 1);
        this.render();
        break;
      case 'right':
      case 'return':
      case 'enter':
        if (this.lanes[this.selectedLaneIndex]) {
          this.selectedLaneName = this.lanes[this.selectedLaneIndex]!.name;
          this.view = View.LANE_DETAIL;
          this.selectedMessageIndex = 0;
          this.scrollOffset = 0;
          this.refreshLogs();
          this.render();
        }
        break;
      case 'left':
      case 'f':
        this.view = View.FLOW;
        this.render();
        break;
      case 'q':
        this.stop();
        break;
    }
  }

  private handleDetailKey(key: string) {
    switch (key) {
      case 'up':
        this.selectedMessageIndex = Math.max(0, this.selectedMessageIndex - 1);
        this.render();
        break;
      case 'down':
        this.selectedMessageIndex = Math.min(this.currentLogs.length - 1, this.selectedMessageIndex + 1);
        this.render();
        break;
      case 'right':
      case 'return':
      case 'enter':
        if (this.currentLogs[this.selectedMessageIndex]) {
          this.view = View.MESSAGE_DETAIL;
          this.render();
        }
        break;
      case 't':
        this.view = View.TERMINAL;
        this.terminalScrollOffset = 0;
        this.render();
        break;
      case 'k':
        this.killLane();
        break;
      case 'i':
        const lane = this.lanes.find(l => l.name === this.selectedLaneName);
        if (lane) {
          const status = this.getLaneStatus(lane.path, lane.name);
          if (status.status === 'running') {
            this.view = View.INTERVENE;
            this.interventionInput = '';
            this.render();
          } else {
            this.showNotification('Intervention only available for RUNNING lanes', 'error');
          }
        }
        break;
      case 'o':
        const timeoutLane = this.lanes.find(l => l.name === this.selectedLaneName);
        if (timeoutLane) {
          const status = this.getLaneStatus(timeoutLane.path, timeoutLane.name);
          if (status.status === 'running') {
            this.view = View.TIMEOUT;
            this.timeoutInput = '';
            this.render();
          } else {
            this.showNotification('Timeout update only available for RUNNING lanes', 'error');
          }
        }
        break;
      case 'escape':
      case 'backspace':
      case 'left':
        this.view = View.LIST;
        this.selectedLaneName = null;
        this.render();
        break;
      case 'q':
        this.stop();
        break;
    }
  }

  private handleMessageDetailKey(key: string) {
    switch (key) {
      case 'escape':
      case 'backspace':
      case 'left':
        this.view = View.LANE_DETAIL;
        this.render();
        break;
      case 'q':
        this.stop();
        break;
    }
  }

  private handleTerminalKey(key: string) {
    switch (key) {
      case 'up':
        this.terminalScrollOffset++;
        this.render();
        break;
      case 'down':
        this.terminalScrollOffset = Math.max(0, this.terminalScrollOffset - 1);
        this.render();
        break;
      case 't':
      case 'escape':
      case 'backspace':
      case 'left':
        this.view = View.LANE_DETAIL;
        this.render();
        break;
      case 'i':
        this.view = View.INTERVENE;
        this.interventionInput = '';
        this.render();
        break;
      case 'q':
        this.stop();
        break;
    }
  }

  private handleInterveneKey(str: string, key: any) {
    if (key && key.name === 'escape') {
      this.view = View.LANE_DETAIL;
      this.render();
      return;
    }

    if (key && (key.name === 'return' || key.name === 'enter')) {
      if (this.interventionInput.trim()) {
        this.sendIntervention(this.interventionInput.trim());
      }
      this.view = View.LANE_DETAIL;
      this.render();
      return;
    }

    if (key && key.name === 'backspace') {
      this.interventionInput = this.interventionInput.slice(0, -1);
      this.render();
      return;
    }

    if (str && str.length === 1 && !key.ctrl && !key.meta) {
      this.interventionInput += str;
      this.render();
    }
  }

  private handleTimeoutKey(str: string, key: any) {
    if (key && key.name === 'escape') {
      this.view = View.LANE_DETAIL;
      this.render();
      return;
    }

    if (key && (key.name === 'return' || key.name === 'enter')) {
      if (this.timeoutInput.trim()) {
        this.sendTimeoutUpdate(this.timeoutInput.trim());
      }
      this.view = View.LANE_DETAIL;
      this.render();
      return;
    }

    if (key && key.name === 'backspace') {
      this.timeoutInput = this.timeoutInput.slice(0, -1);
      this.render();
      return;
    }

    // Only allow numbers
    if (str && /^\d$/.test(str)) {
      this.timeoutInput += str;
      this.render();
    }
  }

  private handleFlowKey(key: string) {
    switch (key) {
      case 'f':
      case 'escape':
      case 'backspace':
      case 'right':
      case 'return':
      case 'enter':
      case 'left':
        this.view = View.LIST;
        this.render();
        break;
      case 'q':
        this.stop();
        break;
    }
  }

  private sendIntervention(message: string) {
    if (!this.selectedLaneName) return;
    const lane = this.lanes.find(l => l.name === this.selectedLaneName);
    if (!lane) return;

    try {
      const interventionPath = safeJoin(lane.path, 'intervention.txt');
      fs.writeFileSync(interventionPath, message, 'utf8');

      // Also log it to the conversation
      const convoPath = safeJoin(lane.path, 'conversation.jsonl');
      const entry = {
        timestamp: new Date().toISOString(),
        role: 'user',
        task: 'INTERVENTION',
        fullText: `[HUMAN INTERVENTION]: ${message}`,
        textLength: message.length + 20,
        model: 'manual'
      };
      fs.appendFileSync(convoPath, JSON.stringify(entry) + '\n', 'utf8');
      
      this.showNotification('Intervention message sent', 'success');
    } catch (e) {
      this.showNotification('Failed to send intervention', 'error');
    }
  }

  private sendTimeoutUpdate(timeoutStr: string) {
    if (!this.selectedLaneName) return;
    const lane = this.lanes.find(l => l.name === this.selectedLaneName);
    if (!lane) return;

    try {
      const timeoutMs = parseInt(timeoutStr);
      if (isNaN(timeoutMs) || timeoutMs <= 0) {
        this.showNotification('Invalid timeout value', 'error');
        return;
      }

      const timeoutPath = safeJoin(lane.path, 'timeout.txt');
      fs.writeFileSync(timeoutPath, String(timeoutMs), 'utf8');
      
      this.showNotification(`Timeout updated to ${Math.round(timeoutMs/1000)}s`, 'success');
    } catch (e) {
      this.showNotification('Failed to update timeout', 'error');
    }
  }

  private refreshLogs() {
    if (!this.selectedLaneName) return;
    const lane = this.lanes.find(l => l.name === this.selectedLaneName);
    if (!lane) return;
    const convoPath = safeJoin(lane.path, 'conversation.jsonl');
    this.currentLogs = readLog<ConversationEntry>(convoPath);
    // Keep selection in bounds after refresh
    if (this.selectedMessageIndex >= this.currentLogs.length) {
      this.selectedMessageIndex = Math.max(0, this.currentLogs.length - 1);
    }
  }

  private refresh() {
    this.lanes = this.listLanesWithDeps(this.runDir);
    if (this.view !== View.LIST) {
      this.refreshLogs();
    }
    this.render();
  }

  private killLane() {
    if (!this.selectedLaneName) return;
    const lane = this.lanes.find(l => l.name === this.selectedLaneName);
    if (!lane) return;

    const status = this.getLaneStatus(lane.path, lane.name);
    if (status.pid && status.status === 'running') {
      try {
        process.kill(status.pid, 'SIGTERM');
        this.showNotification(`Sent SIGTERM to PID ${status.pid}`, 'success');
      } catch (e) {
        this.showNotification(`Failed to kill PID ${status.pid}`, 'error');
      }
    } else {
      this.showNotification(`No running process found for ${this.selectedLaneName}`, 'info');
    }
  }

  private showNotification(message: string, type: 'info' | 'error' | 'success') {
    this.notification = { message, type, time: Date.now() };
    this.render();
  }

  private render() {
    // Clear screen
    process.stdout.write('\x1Bc');
    
    // Clear old notifications
    if (this.notification && Date.now() - this.notification.time > 3000) {
      this.notification = null;
    }

    if (this.notification) {
      const color = this.notification.type === 'error' ? '\x1b[31m' : this.notification.type === 'success' ? '\x1b[32m' : '\x1b[36m';
      console.log(`${color}🔔 ${this.notification.message}\x1b[0m\n`);
    }
    
    switch (this.view) {
      case View.LIST:
        this.renderList();
        break;
      case View.LANE_DETAIL:
        this.renderLaneDetail();
        break;
      case View.MESSAGE_DETAIL:
        this.renderMessageDetail();
        break;
      case View.FLOW:
        this.renderFlow();
        break;
      case View.TERMINAL:
        this.renderTerminal();
        break;
      case View.INTERVENE:
        this.renderIntervene();
        break;
      case View.TIMEOUT:
        this.renderTimeout();
        break;
    }
  }

  private renderList() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📊 CursorFlow Monitor - Run: ${path.basename(this.runDir)}`);
    console.log(`🕒 Updated: ${new Date().toLocaleTimeString()} | [↑/↓/→] Nav [←] Flow [Q] Quit`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (this.lanes.length === 0) {
      console.log('  No lanes found\n');
      return;
    }

    const laneStatuses: Record<string, any> = {};
    this.lanes.forEach(l => laneStatuses[l.name] = this.getLaneStatus(l.path, l.name));

    const maxNameLen = Math.max(...this.lanes.map(l => l.name.length), 15);
    console.log(`    ${'Lane'.padEnd(maxNameLen)}  Status              Progress  Time      Tasks   Next Action`);
    console.log(`    ${'─'.repeat(maxNameLen)}  ${'─'.repeat(18)}  ${'─'.repeat(8)}  ${'─'.repeat(8)}  ${'─'.repeat(6)}  ${'─'.repeat(20)}`);

    this.lanes.forEach((lane, i) => {
      const isSelected = i === this.selectedLaneIndex;
      const status = laneStatuses[lane.name];
      const statusIcon = this.getStatusIcon(status.status);
      const statusText = `${statusIcon} ${status.status}`.padEnd(18);
      const progressText = status.progress.padEnd(8);
      const timeText = this.formatDuration(status.duration).padEnd(8);
      
      let tasksDisplay = '-';
      if (typeof status.totalTasks === 'number') {
        tasksDisplay = `${status.currentTask}/${status.totalTasks}`;
      }
      const tasksText = tasksDisplay.padEnd(6);
      
      // Determine "Next Action"
      let nextAction = '-';
      if (status.status === 'completed') {
        const dependents = this.lanes.filter(l => laneStatuses[l.name].dependsOn.includes(lane.name));
        if (dependents.length > 0) {
          nextAction = `Unlock: ${dependents.map(d => d.name).join(', ')}`;
        } else {
          nextAction = '🏁 Done';
        }
      } else if (status.status === 'waiting') {
        if (status.waitingFor && status.waitingFor.length > 0) {
          nextAction = `Wait for task: ${status.waitingFor.join(', ')}`;
        } else {
          const missingDeps = status.dependsOn.filter((d: string) => laneStatuses[d] && laneStatuses[d].status !== 'completed');
          nextAction = `Wait for lane: ${missingDeps.join(', ')}`;
        }
      } else if (status.status === 'running') {
        nextAction = '🚀 Working...';
      }

      const prefix = isSelected ? '  ▶ ' : '    ';
      const line = `${prefix}${lane.name.padEnd(maxNameLen)}  ${statusText}  ${progressText}  ${timeText}  ${tasksText}  ${nextAction}`;
      
      if (isSelected) {
        process.stdout.write(`\x1b[36m${line}\x1b[0m\n`);
      } else {
        process.stdout.write(`${line}\n`);
      }
    });

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  private renderLaneDetail() {
    const lane = this.lanes.find(l => l.name === this.selectedLaneName);
    if (!lane) {
      this.view = View.LIST;
      this.render();
      return;
    }

    const status = this.getLaneStatus(lane.path, lane.name);
    const logPath = safeJoin(lane.path, 'terminal.log');
    let liveLog = '(No live terminal output)';
    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, 'utf8');
      liveLog = content.split('\n').slice(-15).join('\n');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🔍 Lane: ${lane.name}`);
    console.log(`🕒 Updated: ${new Date().toLocaleTimeString()} | [↑/↓] Browse [T] Term [I] Intervene [O] Timeout [Esc] Back`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    process.stdout.write(`  Status:    ${this.getStatusIcon(status.status)} ${status.status}\n`);
    process.stdout.write(`  PID:       ${status.pid || '-'}\n`);
    process.stdout.write(`  Progress:  ${status.progress} (${status.currentTask}/${status.totalTasks} tasks)\n`);
    process.stdout.write(`  Time:      ${this.formatDuration(status.duration)}\n`);
    process.stdout.write(`  Branch:    ${status.pipelineBranch}\n`);
    process.stdout.write(`  Chat ID:   ${status.chatId}\n`);
    process.stdout.write(`  Depends:   ${status.dependsOn.join(', ') || 'None'}\n`);
    
    if (status.waitingFor && status.waitingFor.length > 0) {
      process.stdout.write(`\x1b[33m  Wait For:  ${status.waitingFor.join(', ')}\x1b[0m\n`);
    }
    
    if (status.error) {
      process.stdout.write(`\x1b[31m  Error:     ${status.error}\x1b[0m\n`);
    }

    console.log('\n🖥️  Live Terminal Output (Last 15 lines):');
    console.log('─'.repeat(80));
    console.log(`\x1b[90m${liveLog}\x1b[0m`);

    console.log('\n💬 Conversation History (Select to see full details):');
    console.log('─'.repeat(80));
    process.stdout.write('  [↑/↓] Browse | [→/Enter] Full Msg | [I] Intervene | [K] Kill | [T] Live Terminal | [Esc/←] Back\n\n');

    if (this.currentLogs.length === 0) {
      console.log('  (No messages yet)');
    } else {
      // Simple windowed view for long histories
      const maxVisible = 15; // Number of messages to show
      if (this.selectedMessageIndex < this.scrollOffset) {
        this.scrollOffset = this.selectedMessageIndex;
      } else if (this.selectedMessageIndex >= this.scrollOffset + maxVisible) {
        this.scrollOffset = this.selectedMessageIndex - maxVisible + 1;
      }

      const visibleLogs = this.currentLogs.slice(this.scrollOffset, this.scrollOffset + maxVisible);
      
      visibleLogs.forEach((log, i) => {
        const actualIndex = i + this.scrollOffset;
        const isSelected = actualIndex === this.selectedMessageIndex;
        const roleColor = log.role === 'user' ? '\x1b[33m' : log.role === 'reviewer' ? '\x1b[35m' : '\x1b[32m';
        const role = log.role.toUpperCase().padEnd(10);
        
        const prefix = isSelected ? '▶ ' : '  ';
        const header = `${prefix}${roleColor}${role}\x1b[0m [${new Date(log.timestamp).toLocaleTimeString()}]`;
        
        if (isSelected) {
          process.stdout.write(`\x1b[48;5;236m${header}\x1b[0m\n`);
        } else {
          process.stdout.write(`${header}\n`);
        }
        
        const lines = log.fullText.split('\n').filter(l => l.trim());
        const preview = lines[0]?.substring(0, 70) || '...';
        process.stdout.write(`    ${preview}${log.fullText.length > 70 ? '...' : ''}\n\n`);
      });

      if (this.currentLogs.length > maxVisible) {
        console.log(`  -- (${this.currentLogs.length - maxVisible} more messages, use ↑/↓ to scroll) --`);
      }
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  private renderMessageDetail() {
    const log = this.currentLogs[this.selectedMessageIndex];
    if (!log) {
      this.view = View.LANE_DETAIL;
      this.render();
      return;
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📄 Full Message Detail - ${log.role.toUpperCase()}`);
    console.log(`🕒 ${new Date(log.timestamp).toLocaleString()} | [Esc/←] Back to History`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const roleColor = log.role === 'user' ? '\x1b[33m' : log.role === 'reviewer' ? '\x1b[35m' : '\x1b[32m';
    process.stdout.write(`${roleColor}ROLE: ${log.role.toUpperCase()}\x1b[0m\n`);
    if (log.model) process.stdout.write(`MODEL: ${log.model}\n`);
    if (log.task) process.stdout.write(`TASK: ${log.task}\n`);
    console.log('─'.repeat(40));
    console.log(log.fullText);
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  private renderFlow() {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`⛓️  Task Dependency Flow`);
    console.log(`🕒 Updated: ${new Date().toLocaleTimeString()} | [→/Enter/Esc] Back to List`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const laneMap = new Map<string, any>();
    this.lanes.forEach(lane => {
      laneMap.set(lane.name, this.getLaneStatus(lane.path, lane.name));
    });

    // Enhanced visualization with box-like structure and clear connections
    this.lanes.forEach(lane => {
      const status = laneMap.get(lane.name);
      const statusIcon = this.getStatusIcon(status.status);
      
      let statusColor = '\x1b[90m'; // Grey for pending/waiting
      if (status.status === 'completed') statusColor = '\x1b[32m'; // Green
      if (status.status === 'running') statusColor = '\x1b[36m'; // Cyan
      if (status.status === 'failed') statusColor = '\x1b[31m'; // Red

      // Render the node
      const nodeText = `[ ${statusIcon} ${lane.name.padEnd(18)} ]`;
      process.stdout.write(`  ${statusColor}${nodeText}\x1b[0m`);
      
      // Render dependencies
      if (status.dependsOn && status.dependsOn.length > 0) {
        process.stdout.write(` \x1b[90m◀───\x1b[0m \x1b[33m( ${status.dependsOn.join(', ')} )\x1b[0m`);
      }
      process.stdout.write('\n');
    });

    console.log('\n\x1b[90m  (Lanes wait for their dependencies to complete before starting)\x1b[0m');
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  private renderTerminal() {
    const lane = this.lanes.find(l => l.name === this.selectedLaneName);
    if (!lane) {
      this.view = View.LIST;
      this.render();
      return;
    }

    const logPath = safeJoin(lane.path, 'terminal.log');
    let logLines: string[] = [];
    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, 'utf8');
      logLines = content.split('\n');
    }

    const maxVisible = 40;
    const totalLines = logLines.length;

    // Sticky scroll logic: if new lines arrived and we are already scrolled up,
    // increase the offset to stay on the same content.
    if (this.terminalScrollOffset > 0 && this.lastTerminalTotalLines > 0 && totalLines > this.lastTerminalTotalLines) {
      this.terminalScrollOffset += (totalLines - this.lastTerminalTotalLines);
    }
    this.lastTerminalTotalLines = totalLines;
    
    // Clamp scroll offset
    const maxScroll = Math.max(0, totalLines - maxVisible);
    if (this.terminalScrollOffset > maxScroll) {
      this.terminalScrollOffset = maxScroll;
    }

    // Slice based on scroll (0 means bottom, >0 means scrolled up)
    const end = totalLines - this.terminalScrollOffset;
    const start = Math.max(0, end - maxVisible);
    const visibleLines = logLines.slice(start, end);

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🖥️  Full Live Terminal: ${lane.name}`);
    console.log(`🕒 Streaming... | [↑/↓] Scroll (${this.terminalScrollOffset > 0 ? `Scrolled Up ${this.terminalScrollOffset}` : 'Bottom'}) | [I] Intervene | [T/Esc/←] Back`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    visibleLines.forEach(line => {
      let formattedLine = line;
      // Highlight human intervention
      if (line.includes('[HUMAN INTERVENTION]') || line.includes('Injecting intervention:')) {
        formattedLine = `\x1b[33m\x1b[1m${line}\x1b[0m`;
      } 
      // Highlight agent execution starts
      else if (line.includes('Executing cursor-agent')) {
        formattedLine = `\x1b[36m\x1b[1m${line}\x1b[0m`;
      }
      // Highlight task headers
      else if (line.includes('=== Task:')) {
        formattedLine = `\x1b[32m\x1b[1m${line}\x1b[0m`;
      }
      // Highlight errors
      else if (line.toLowerCase().includes('error') || line.toLowerCase().includes('failed')) {
        formattedLine = `\x1b[31m${line}\x1b[0m`;
      }
      
      process.stdout.write(`  ${formattedLine}\n`);
    });
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  private renderIntervene() {
    console.clear();
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🙋 HUMAN INTERVENTION: ${this.selectedLaneName}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n Type your message to the agent. This will be sent as a direct prompt.');
    console.log(` Press \x1b[1mENTER\x1b[0m to send, \x1b[1mESC\x1b[0m to cancel.\n`);
    console.log(`\x1b[33m > \x1b[0m${this.interventionInput}\x1b[37m█\x1b[0m`);
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  private renderTimeout() {
    console.clear();
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`⏱ UPDATE TIMEOUT: ${this.selectedLaneName}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('\n Enter new timeout in milliseconds (e.g., 600000 for 10 minutes).');
    console.log(` Press \x1b[1mENTER\x1b[0m to apply, \x1b[1mESC\x1b[0m to cancel.\n`);
    console.log(`\x1b[33m > \x1b[0m${this.timeoutInput}\x1b[37m█\x1b[0m`);
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  private listLanesWithDeps(runDir: string): LaneWithDeps[] {
    const lanesDir = safeJoin(runDir, 'lanes');
    if (!fs.existsSync(lanesDir)) return [];
    
    const config = loadConfig();
    const tasksDir = safeJoin(config.projectRoot, config.tasksDir);
    
    const laneConfigs = this.listLaneFilesFromDir(tasksDir);
    
    return fs.readdirSync(lanesDir)
      .filter(d => fs.statSync(safeJoin(lanesDir, d)).isDirectory())
      .map(name => {
        const config = laneConfigs.find(c => c.name === name);
        return {
          name,
          path: safeJoin(lanesDir, name),
          dependsOn: config?.dependsOn || [],
        };
      });
  }

  private listLaneFilesFromDir(tasksDir: string): { name: string; dependsOn: string[] }[] {
    if (!fs.existsSync(tasksDir)) return [];
    return fs.readdirSync(tasksDir)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const filePath = safeJoin(tasksDir, f);
        try {
          const config = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          return { name: path.basename(f, '.json'), dependsOn: config.dependsOn || [] };
        } catch {
          return { name: path.basename(f, '.json'), dependsOn: [] };
        }
      });
  }

  private getLaneStatus(lanePath: string, laneName: string) {
    const statePath = safeJoin(lanePath, 'state.json');
    const state = loadState<LaneState & { chatId?: string }>(statePath);
    
    const laneInfo = this.lanes.find(l => l.name === laneName);
    const dependsOn = state?.dependsOn || laneInfo?.dependsOn || [];
    
    if (!state) {
      return { status: 'pending', currentTask: 0, totalTasks: '?', progress: '0%', dependsOn, duration: 0, pipelineBranch: '-', chatId: '-' };
    }
    
    const progress = state.totalTasks > 0 ? Math.round((state.currentTaskIndex / state.totalTasks) * 100) : 0;
    
    const duration = state.startTime ? (state.endTime 
      ? state.endTime - state.startTime 
      : (state.status === 'running' || state.status === 'reviewing' ? Date.now() - state.startTime : 0)) : 0;
    
    return {
      status: state.status || 'unknown',
      currentTask: state.currentTaskIndex || 0,
      totalTasks: state.totalTasks || '?',
      progress: `${progress}%`,
      pipelineBranch: state.pipelineBranch || '-',
      chatId: state.chatId || '-',
      dependsOn,
      duration,
      error: state.error,
      pid: state.pid,
      waitingFor: state.waitingFor || [],
    };
}

  private formatDuration(ms: number): string {
    if (ms <= 0) return '-';
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor(ms / (1000 * 60 * 60));
    
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  }

  private getStatusIcon(status: string): string {
    const icons: Record<string, string> = {
      'running': '🔄',
      'waiting': '⏳',
      'completed': '✅',
      'failed': '❌',
      'blocked_dependency': '🚫',
      'pending': '⚪',
      'reviewing': '👀',
    };
    return icons[status] || '❓';
  }
}

/**
 * Find the latest run directory
 */
function findLatestRunDir(logsDir: string): string | null {
  const runsDir = safeJoin(logsDir, 'runs');
  if (!fs.existsSync(runsDir)) return null;
  const runs = fs.readdirSync(runsDir)
    .filter(d => d.startsWith('run-'))
    .map(d => ({ name: d, path: safeJoin(runsDir, d), mtime: fs.statSync(safeJoin(runsDir, d)).mtime.getTime() }))
    .sort((a, b) => b.mtime - a.mtime);
  return runs.length > 0 ? runs[0]!.path : null;
}

/**
 * Monitor lanes
 */
async function monitor(args: string[]): Promise<void> {
  const help = args.includes('--help') || args.includes('-h');
  if (help) {
    printHelp();
    return;
  }

  const watchIdx = args.indexOf('--watch');
  const intervalIdx = args.indexOf('--interval');
  const interval = intervalIdx >= 0 ? parseInt(args[intervalIdx + 1] || '2') || 2 : 2;
  
  const runDirArg = args.find(arg => !arg.startsWith('--') && args.indexOf(arg) !== intervalIdx + 1);
  const config = loadConfig();
  
  let runDir = runDirArg;
  if (!runDir || runDir === 'latest') {
    runDir = findLatestRunDir(config.logsDir) || undefined;
    if (!runDir) throw new Error('No run directories found');
  }
  
  if (!fs.existsSync(runDir)) throw new Error(`Run directory not found: ${runDir}`);
  
  const monitor = new InteractiveMonitor(runDir, interval);
  await monitor.start();
}

export = monitor;

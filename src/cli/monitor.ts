/**
 * CursorFlow interactive monitor command
 * 
 * Features:
 * - Lane dashboard with accurate process status
 * - Unified log view for all lanes
 * - Readable log format support
 * - Multiple flows dashboard
 * - Consistent layout across all views
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { loadState, readLog } from '../utils/state';
import { LaneState, ConversationEntry } from '../utils/types';
import { loadConfig } from '../utils/config';
import { safeJoin } from '../utils/path';
import { getLaneProcessStatus, getFlowSummary, LaneProcessStatus } from '../services/process';
import { LogBufferService, BufferedLogEntry } from '../services/logging/buffer';
import { formatReadableEntry, formatMessageForConsole, stripAnsi } from '../services/logging/formatter';
import { MessageType } from '../types/logging';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UI Constants
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const UI = {
  COLORS: {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    magenta: '\x1b[35m',
    gray: '\x1b[90m',
    white: '\x1b[37m',
    bgGray: '\x1b[48;5;236m',
    bgCyan: '\x1b[46m',
  },
  CHARS: {
    hLine: '━',
    vLine: '│',
    corner: {
      tl: '┌', tr: '┐', bl: '└', br: '┘'
    },
    arrow: {
      right: '▶', left: '◀', up: '▲', down: '▼'
    },
    bullet: '•',
    check: '✓',
  },
};

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
  TIMEOUT,
  UNIFIED_LOG,
  FLOWS_DASHBOARD
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
  private followMode: boolean = true;
  private unseenLineCount: number = 0;
  private lastTerminalTotalLines: number = 0;
  private interventionInput: string = '';
  private timeoutInput: string = '';
  private notification: { message: string; type: 'info' | 'error' | 'success'; time: number } | null = null;
  
  // Process status tracking
  private laneProcessStatuses: Map<string, LaneProcessStatus> = new Map();
  
  // Unified log buffer for all lanes
  private unifiedLogBuffer: LogBufferService | null = null;
  private unifiedLogScrollOffset: number = 0;
  private unifiedLogFollowMode: boolean = true;
  
  // Multiple flows support
  private allFlows: { runDir: string; runId: string; isAlive: boolean; summary: ReturnType<typeof getFlowSummary> }[] = [];
  private selectedFlowIndex: number = 0;
  private logsDir: string = '';
  
  // NEW: UX improvements
  private readableFormat: boolean = true; // Toggle readable log format
  private laneFilter: string | null = null; // Filter by lane name
  private confirmAction: { type: 'delete-flow' | 'kill-lane'; target: string; time: number } | null = null;
  
  // Screen dimensions
  private get screenWidth(): number {
    return process.stdout.columns || 120;
  }
  private get screenHeight(): number {
    return process.stdout.rows || 24;
  }

  constructor(runDir: string, interval: number, logsDir?: string) {
    this.runDir = runDir;
    this.interval = interval;
    
    // Set logs directory for multiple flows discovery
    if (logsDir) {
      this.logsDir = logsDir;
    } else {
      const config = loadConfig();
      this.logsDir = safeJoin(config.logsDir, 'runs');
    }
    
    // Initialize unified log buffer
    this.unifiedLogBuffer = new LogBufferService(runDir);
  }

  public async start() {
    this.setupTerminal();
    
    // Start unified log streaming
    if (this.unifiedLogBuffer) {
      this.unifiedLogBuffer.startStreaming();
      this.unifiedLogBuffer.on('update', () => {
        if (this.view === View.UNIFIED_LOG && this.unifiedLogFollowMode) {
          this.render();
        }
      });
    }
    
    // Discover all flows
    this.discoverFlows();
    
    this.refresh();
    this.timer = setInterval(() => this.refresh(), this.interval * 1000);
  }
  
  /**
   * Discover all run directories (flows) for multi-flow view
   */
  private discoverFlows(): void {
    try {
      if (!fs.existsSync(this.logsDir)) return;
      
      const runs = fs.readdirSync(this.logsDir)
        .filter(d => d.startsWith('run-'))
        .map(d => {
          const runDir = safeJoin(this.logsDir, d);
          const summary = getFlowSummary(runDir);
          return {
            runDir,
            runId: d,
            isAlive: summary.isAlive,
            summary,
          };
        })
        .sort((a, b) => {
          // Sort by run ID (timestamp-based) descending
          return b.runId.localeCompare(a.runId);
        });
      
      this.allFlows = runs;
    } catch {
      // Ignore errors
    }
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
      } else if (this.view === View.UNIFIED_LOG) {
        this.handleUnifiedLogKey(keyName);
      } else if (this.view === View.FLOWS_DASHBOARD) {
        this.handleFlowsDashboardKey(keyName);
      }
    });

    // Hide cursor
    process.stdout.write('\x1B[?25l');
  }

  private stop() {
    if (this.timer) clearInterval(this.timer);
    
    // Stop unified log streaming
    if (this.unifiedLogBuffer) {
      this.unifiedLogBuffer.stopStreaming();
    }
    
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
      case 'u':
        // Unified log view
        this.view = View.UNIFIED_LOG;
        this.unifiedLogScrollOffset = 0;
        this.unifiedLogFollowMode = true;
        this.render();
        break;
      case 'm':
        // Multiple flows dashboard
        this.discoverFlows();
        this.view = View.FLOWS_DASHBOARD;
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
        this.followMode = false;
        this.terminalScrollOffset++;
        this.render();
        break;
      case 'down':
        this.terminalScrollOffset = Math.max(0, this.terminalScrollOffset - 1);
        if (this.terminalScrollOffset === 0) {
          this.followMode = true;
          this.unseenLineCount = 0;
        }
        this.render();
        break;
      case 'f':
        this.followMode = true;
        this.terminalScrollOffset = 0;
        this.unseenLineCount = 0;
        this.render();
        break;
      case 'r':
        // Toggle readable log format
        this.readableFormat = !this.readableFormat;
        this.terminalScrollOffset = 0;
        this.lastTerminalTotalLines = 0;
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

  private handleUnifiedLogKey(key: string) {
    const pageSize = Math.max(10, this.screenHeight - 12);
    
    switch (key) {
      case 'up':
        this.unifiedLogFollowMode = false;
        this.unifiedLogScrollOffset++;
        this.render();
        break;
      case 'down':
        this.unifiedLogScrollOffset = Math.max(0, this.unifiedLogScrollOffset - 1);
        if (this.unifiedLogScrollOffset === 0) {
          this.unifiedLogFollowMode = true;
        }
        this.render();
        break;
      case 'pageup':
        this.unifiedLogFollowMode = false;
        this.unifiedLogScrollOffset += pageSize;
        this.render();
        break;
      case 'pagedown':
        this.unifiedLogScrollOffset = Math.max(0, this.unifiedLogScrollOffset - pageSize);
        if (this.unifiedLogScrollOffset === 0) {
          this.unifiedLogFollowMode = true;
        }
        this.render();
        break;
      case 'f':
        this.unifiedLogFollowMode = true;
        this.unifiedLogScrollOffset = 0;
        this.render();
        break;
      case 'r':
        // Toggle readable format
        this.readableFormat = !this.readableFormat;
        this.render();
        break;
      case 'l':
        // Cycle through lane filter
        this.cycleLaneFilter();
        this.unifiedLogScrollOffset = 0;
        this.render();
        break;
      case 'escape':
      case 'backspace':
      case 'u':
        this.view = View.LIST;
        this.render();
        break;
      case 'q':
        this.stop();
        break;
    }
  }
  
  /**
   * Cycle through available lanes for filtering
   */
  private cycleLaneFilter(): void {
    const lanes = this.unifiedLogBuffer?.getLanes() || [];
    if (lanes.length === 0) {
      this.laneFilter = null;
      return;
    }
    
    if (this.laneFilter === null) {
      // Show first lane
      this.laneFilter = lanes[0]!;
    } else {
      const currentIndex = lanes.indexOf(this.laneFilter);
      if (currentIndex === -1 || currentIndex === lanes.length - 1) {
        // Reset to all lanes
        this.laneFilter = null;
      } else {
        // Next lane
        this.laneFilter = lanes[currentIndex + 1]!;
      }
    }
  }

  private handleFlowsDashboardKey(key: string) {
    // Handle confirmation dialog first
    if (this.confirmAction) {
      if (key === 'y') {
        this.executeConfirmedAction();
        return;
      } else if (key === 'n' || key === 'escape') {
        this.confirmAction = null;
        this.render();
        return;
      }
      // Other keys cancel confirmation
      this.confirmAction = null;
      this.render();
      return;
    }
    
    switch (key) {
      case 'up':
        this.selectedFlowIndex = Math.max(0, this.selectedFlowIndex - 1);
        this.render();
        break;
      case 'down':
        this.selectedFlowIndex = Math.min(this.allFlows.length - 1, this.selectedFlowIndex + 1);
        this.render();
        break;
      case 'right':
      case 'return':
      case 'enter':
        // Switch to selected flow
        if (this.allFlows[this.selectedFlowIndex]) {
          const flow = this.allFlows[this.selectedFlowIndex]!;
          this.runDir = flow.runDir;
          
          // Restart log buffer for new run
          if (this.unifiedLogBuffer) {
            this.unifiedLogBuffer.stopStreaming();
          }
          this.unifiedLogBuffer = new LogBufferService(this.runDir);
          this.unifiedLogBuffer.startStreaming();
          
          this.lanes = [];
          this.laneProcessStatuses.clear();
          this.view = View.LIST;
          this.showNotification(`Switched to flow: ${flow.runId}`, 'info');
          this.refresh();
        }
        break;
      case 'd':
        // Delete flow (with confirmation)
        if (this.allFlows[this.selectedFlowIndex]) {
          const flow = this.allFlows[this.selectedFlowIndex]!;
          if (flow.isAlive) {
            this.showNotification('Cannot delete a running flow. Stop it first.', 'error');
          } else if (flow.runDir === this.runDir) {
            this.showNotification('Cannot delete the currently viewed flow.', 'error');
          } else {
            this.confirmAction = {
              type: 'delete-flow',
              target: flow.runId,
              time: Date.now(),
            };
            this.render();
          }
        }
        break;
      case 'r':
        // Refresh flows
        this.discoverFlows();
        this.showNotification('Flows refreshed', 'info');
        this.render();
        break;
      case 'escape':
      case 'backspace':
      case 'm':
        this.view = View.LIST;
        this.render();
        break;
      case 'q':
        this.stop();
        break;
    }
  }
  
  /**
   * Execute a confirmed action (delete flow, kill process, etc.)
   */
  private executeConfirmedAction(): void {
    if (!this.confirmAction) return;
    
    const { type, target } = this.confirmAction;
    this.confirmAction = null;
    
    if (type === 'delete-flow') {
      const flow = this.allFlows.find(f => f.runId === target);
      if (flow) {
        try {
          // Delete the flow directory
          fs.rmSync(flow.runDir, { recursive: true, force: true });
          this.showNotification(`Deleted flow: ${target}`, 'success');
          
          // Refresh the list
          this.discoverFlows();
          
          // Adjust selection if needed
          if (this.selectedFlowIndex >= this.allFlows.length) {
            this.selectedFlowIndex = Math.max(0, this.allFlows.length - 1);
          }
        } catch (err) {
          this.showNotification(`Failed to delete flow: ${err}`, 'error');
        }
      }
    }
    
    this.render();
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
        role: 'intervention',
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
    
    // Update process statuses for accurate display
    this.updateProcessStatuses();
    
    if (this.view !== View.LIST && this.view !== View.UNIFIED_LOG && this.view !== View.FLOWS_DASHBOARD) {
      this.refreshLogs();
    }
    
    // Refresh flows list periodically
    if (this.view === View.FLOWS_DASHBOARD) {
      this.discoverFlows();
    }
    
    this.render();
  }
  
  /**
   * Update process statuses for all lanes
   */
  private updateProcessStatuses(): void {
    const lanesDir = safeJoin(this.runDir, 'lanes');
    if (!fs.existsSync(lanesDir)) return;
    
    for (const lane of this.lanes) {
      const status = getLaneProcessStatus(lane.path, lane.name);
      this.laneProcessStatuses.set(lane.name, status);
    }
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

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // UI Layout Helpers - Consistent header/footer across all views
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  private renderHeader(title: string, breadcrumb: string[] = []): void {
    const width = Math.min(this.screenWidth, 120);
    const line = UI.CHARS.hLine.repeat(width);
    
    // Flow status
    const flowSummary = getFlowSummary(this.runDir);
    const flowStatusIcon = flowSummary.isAlive ? '🟢' : (flowSummary.completed === flowSummary.total && flowSummary.total > 0 ? '✅' : '🔴');
    
    // Breadcrumb
    const crumbs = ['CursorFlow', ...breadcrumb].join(` ${UI.COLORS.gray}›${UI.COLORS.reset} `);
    
    // Time
    const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false });
    
    process.stdout.write(`${UI.COLORS.cyan}${line}${UI.COLORS.reset}\n`);
    process.stdout.write(`${UI.COLORS.bold}${crumbs}${UI.COLORS.reset}  ${flowStatusIcon}  `);
    process.stdout.write(`${UI.COLORS.dim}${timeStr}${UI.COLORS.reset}\n`);
    process.stdout.write(`${UI.COLORS.cyan}${line}${UI.COLORS.reset}\n`);
  }
  
  private renderFooter(actions: string[]): void {
    const width = Math.min(this.screenWidth, 120);
    const line = UI.CHARS.hLine.repeat(width);
    
    // Notification area
    if (this.notification && Date.now() - this.notification.time < 3000) {
      const nColor = this.notification.type === 'error' ? UI.COLORS.red 
        : this.notification.type === 'success' ? UI.COLORS.green 
        : UI.COLORS.cyan;
      process.stdout.write(`\n${nColor}🔔 ${this.notification.message}${UI.COLORS.reset}\n`);
    }
    
    // Confirmation dialog area
    if (this.confirmAction && Date.now() - this.confirmAction.time < 10000) {
      const actionName = this.confirmAction.type === 'delete-flow' ? 'DELETE FLOW' : 'KILL PROCESS';
      process.stdout.write(`\n${UI.COLORS.yellow}⚠️  Confirm ${actionName}: ${this.confirmAction.target}? [Y] Yes / [N] No${UI.COLORS.reset}\n`);
    }
    
    process.stdout.write(`\n${UI.COLORS.cyan}${line}${UI.COLORS.reset}\n`);
    const formattedActions = actions.map(a => {
      const parts = a.split('] ');
      if (parts.length === 2) {
        // Use regex with global flag to replace all occurrences
        return `${UI.COLORS.yellow}[${parts[0]!.replace(/\[/g, '')}]${UI.COLORS.reset} ${parts[1]}`;
      }
      return a;
    });
    process.stdout.write(` ${formattedActions.join('  ')}\n`);
  }
  
  private renderSectionTitle(title: string, extra?: string): void {
    const extraStr = extra ? `  ${UI.COLORS.dim}${extra}${UI.COLORS.reset}` : '';
    process.stdout.write(`\n${UI.COLORS.bold}${title}${UI.COLORS.reset}${extraStr}\n`);
    process.stdout.write(`${UI.COLORS.gray}${'─'.repeat(40)}${UI.COLORS.reset}\n`);
  }
  
  private render() {
    // Clear screen
    process.stdout.write('\x1Bc');
    
    // Clear old notifications
    if (this.notification && Date.now() - this.notification.time > 3000) {
      this.notification = null;
    }
    
    // Clear old confirmation
    if (this.confirmAction && Date.now() - this.confirmAction.time > 10000) {
      this.confirmAction = null;
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
      case View.UNIFIED_LOG:
        this.renderUnifiedLog();
        break;
      case View.FLOWS_DASHBOARD:
        this.renderFlowsDashboard();
        break;
    }
  }

  private renderList() {
    const flowSummary = getFlowSummary(this.runDir);
    const runId = path.basename(this.runDir);
    
    this.renderHeader('Lane Dashboard', [runId]);
    
    // Summary line
    const summaryParts = [
      `${flowSummary.running} ${UI.COLORS.cyan}running${UI.COLORS.reset}`,
      `${flowSummary.completed} ${UI.COLORS.green}done${UI.COLORS.reset}`,
      `${flowSummary.failed} ${UI.COLORS.red}failed${UI.COLORS.reset}`,
      `${flowSummary.dead} ${UI.COLORS.yellow}stale${UI.COLORS.reset}`,
    ];
    process.stdout.write(` ${UI.COLORS.dim}Lanes:${UI.COLORS.reset} ${summaryParts.join(' │ ')}\n`);

    if (this.lanes.length === 0) {
      process.stdout.write(`\n ${UI.COLORS.dim}No lanes found${UI.COLORS.reset}\n`);
      this.renderFooter(['[Q] Quit', '[M] All Flows']);
      return;
    }

    const laneStatuses: Record<string, any> = {};
    this.lanes.forEach(l => laneStatuses[l.name] = this.getLaneStatus(l.path, l.name));

    const maxNameLen = Math.max(...this.lanes.map(l => l.name.length), 12);
    
    process.stdout.write(`\n    ${'Lane'.padEnd(maxNameLen)}  ${'Status'.padEnd(12)}  ${'PID'.padEnd(7)}  ${'Time'.padEnd(8)}  ${'Tasks'.padEnd(6)}  Next\n`);
    process.stdout.write(`    ${'─'.repeat(maxNameLen)}  ${'─'.repeat(12)}  ${'─'.repeat(7)}  ${'─'.repeat(8)}  ${'─'.repeat(6)}  ${'─'.repeat(25)}\n`);

    this.lanes.forEach((lane, i) => {
      const isSelected = i === this.selectedLaneIndex;
      const status = laneStatuses[lane.name];
      const processStatus = this.laneProcessStatuses.get(lane.name);
      
      // Determine the accurate status based on process detection
      let displayStatus = status.status;
      let statusColor = UI.COLORS.gray;
      let statusIcon = this.getStatusIcon(status.status);
      
      if (processStatus) {
        if (processStatus.isStale) {
          displayStatus = 'STALE';
          statusIcon = '💀';
          statusColor = UI.COLORS.yellow;
        } else if (processStatus.actualStatus === 'dead' && status.status === 'running') {
          displayStatus = 'DEAD';
          statusIcon = '☠️';
          statusColor = UI.COLORS.red;
        } else if (processStatus.actualStatus === 'running') {
          statusColor = UI.COLORS.cyan;
        } else if (status.status === 'completed') {
          statusColor = UI.COLORS.green;
        } else if (status.status === 'failed') {
          statusColor = UI.COLORS.red;
        }
      }
      
      const statusText = `${statusIcon} ${displayStatus}`.padEnd(12);
      
      // Process indicator
      let pidText = '-'.padEnd(7);
      if (processStatus?.pid) {
        const pidIcon = processStatus.processRunning ? '●' : '○';
        const pidColor = processStatus.processRunning ? UI.COLORS.green : UI.COLORS.red;
        pidText = `${pidColor}${pidIcon}${UI.COLORS.reset}${processStatus.pid}`.padEnd(7 + 9); // +9 for color codes
      }
      
      // Duration
      const duration = processStatus?.duration || status.duration;
      const timeText = this.formatDuration(duration).padEnd(8);
      
      // Tasks
      let tasksText = '-'.padEnd(6);
      if (typeof status.totalTasks === 'number') {
        tasksText = `${status.currentTask}/${status.totalTasks}`.padEnd(6);
      }
      
      // Next action
      let nextAction = '-';
      if (status.status === 'completed') {
        const dependents = this.lanes.filter(l => laneStatuses[l.name]?.dependsOn?.includes(lane.name));
        nextAction = dependents.length > 0 ? `→ ${dependents.map(d => d.name).join(', ')}` : '✓ Done';
      } else if (status.status === 'waiting') {
        if (status.waitingFor?.length > 0) {
          nextAction = `⏳ ${status.waitingFor.join(', ')}`;
        } else {
          const missingDeps = status.dependsOn.filter((d: string) => laneStatuses[d]?.status !== 'completed');
          nextAction = missingDeps.length > 0 ? `⏳ ${missingDeps.join(', ')}` : '⏳ waiting';
        }
      } else if (processStatus?.actualStatus === 'running') {
        nextAction = '🚀 working...';
      } else if (processStatus?.isStale) {
        nextAction = '⚠️ died unexpectedly';
      }
      
      // Truncate next action
      if (nextAction.length > 25) nextAction = nextAction.substring(0, 22) + '...';

      const prefix = isSelected ? ` ${UI.COLORS.cyan}▶${UI.COLORS.reset} ` : '   ';
      const rowBg = isSelected ? UI.COLORS.bgGray : '';
      const rowEnd = isSelected ? UI.COLORS.reset : '';
      
      process.stdout.write(`${rowBg}${prefix}${lane.name.padEnd(maxNameLen)}  ${statusColor}${statusText}${UI.COLORS.reset}  ${pidText}  ${timeText}  ${tasksText}  ${nextAction}${rowEnd}\n`);
    });

    this.renderFooter([
      '[↑↓] Select', '[→/Enter] Details', '[F] Flow', '[U] Unified Logs', '[M] All Flows', '[Q] Quit'
    ]);
  }

  private renderLaneDetail() {
    const lane = this.lanes.find(l => l.name === this.selectedLaneName);
    if (!lane) {
      this.view = View.LIST;
      this.render();
      return;
    }

    const status = this.getLaneStatus(lane.path, lane.name);
    const processStatus = this.laneProcessStatuses.get(lane.name);
    
    this.renderHeader('Lane Detail', [path.basename(this.runDir), lane.name]);

    // Status grid
    const statusColor = status.status === 'completed' ? UI.COLORS.green 
      : status.status === 'failed' ? UI.COLORS.red 
      : status.status === 'running' ? UI.COLORS.cyan : UI.COLORS.gray;
    
    const actualStatus = processStatus?.actualStatus || status.status;
    const isStale = processStatus?.isStale || false;
    
    process.stdout.write(`\n`);
    process.stdout.write(` ${UI.COLORS.dim}Status${UI.COLORS.reset}     ${statusColor}${this.getStatusIcon(actualStatus)} ${actualStatus.toUpperCase()}${UI.COLORS.reset}`);
    if (isStale) process.stdout.write(` ${UI.COLORS.yellow}(stale)${UI.COLORS.reset}`);
    process.stdout.write(`\n`);
    
    const pidDisplay = processStatus?.pid 
      ? `${processStatus.processRunning ? UI.COLORS.green : UI.COLORS.red}${processStatus.pid}${UI.COLORS.reset}` 
      : '-';
    process.stdout.write(` ${UI.COLORS.dim}PID${UI.COLORS.reset}        ${pidDisplay}\n`);
    process.stdout.write(` ${UI.COLORS.dim}Progress${UI.COLORS.reset}   ${status.currentTask}/${status.totalTasks} tasks (${status.progress})\n`);
    process.stdout.write(` ${UI.COLORS.dim}Duration${UI.COLORS.reset}   ${this.formatDuration(processStatus?.duration || status.duration)}\n`);
    process.stdout.write(` ${UI.COLORS.dim}Branch${UI.COLORS.reset}     ${status.pipelineBranch}\n`);
    
    if (status.dependsOn && status.dependsOn.length > 0) {
      process.stdout.write(` ${UI.COLORS.dim}Depends${UI.COLORS.reset}    ${status.dependsOn.join(', ')}\n`);
    }
    if (status.waitingFor && status.waitingFor.length > 0) {
      process.stdout.write(` ${UI.COLORS.yellow}Waiting${UI.COLORS.reset}    ${status.waitingFor.join(', ')}\n`);
    }
    if (status.error) {
      process.stdout.write(` ${UI.COLORS.red}Error${UI.COLORS.reset}      ${status.error}\n`);
    }

    // Live terminal preview
    this.renderSectionTitle('Live Terminal', 'last 10 lines');
    const logPath = safeJoin(lane.path, 'terminal-readable.log');
    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, 'utf8');
      const lines = content.split('\n').slice(-10);
      for (const line of lines) {
        const formatted = this.formatTerminalLine(line);
        process.stdout.write(` ${UI.COLORS.dim}${formatted.substring(0, this.screenWidth - 4)}${UI.COLORS.reset}\n`);
      }
    } else {
      process.stdout.write(` ${UI.COLORS.dim}(No output yet)${UI.COLORS.reset}\n`);
    }

    // Conversation preview
    this.renderSectionTitle('Conversation', `${this.currentLogs.length} messages`);
    
    const maxVisible = 8;
    if (this.selectedMessageIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedMessageIndex;
    } else if (this.selectedMessageIndex >= this.scrollOffset + maxVisible) {
      this.scrollOffset = this.selectedMessageIndex - maxVisible + 1;
    }

    if (this.currentLogs.length === 0) {
      process.stdout.write(` ${UI.COLORS.dim}(No messages yet)${UI.COLORS.reset}\n`);
    } else {
      const visibleLogs = this.currentLogs.slice(this.scrollOffset, this.scrollOffset + maxVisible);
      
      visibleLogs.forEach((log, i) => {
        const actualIndex = i + this.scrollOffset;
        const isSelected = actualIndex === this.selectedMessageIndex;
        
        const roleColor = this.getRoleColor(log.role);
        const role = log.role.toUpperCase().padEnd(10);
        const ts = new Date(log.timestamp).toLocaleTimeString('en-US', { hour12: false });
        
        const prefix = isSelected ? `${UI.COLORS.cyan}▶${UI.COLORS.reset}` : ' ';
        const bg = isSelected ? UI.COLORS.bgGray : '';
        const reset = isSelected ? UI.COLORS.reset : '';
        
        const preview = log.fullText.replace(/\n/g, ' ').substring(0, 60);
        process.stdout.write(`${bg}${prefix} ${roleColor}${role}${UI.COLORS.reset} ${UI.COLORS.dim}${ts}${UI.COLORS.reset} ${preview}...${reset}\n`);
      });
      
      if (this.currentLogs.length > maxVisible) {
        process.stdout.write(` ${UI.COLORS.dim}(${this.currentLogs.length - maxVisible} more messages)${UI.COLORS.reset}\n`);
      }
    }

    this.renderFooter([
      '[↑↓] Scroll', '[→/Enter] Full Msg', '[T] Terminal', '[I] Intervene', '[K] Kill', '[←/Esc] Back'
    ]);
  }
  
  private getRoleColor(role: string): string {
    const colors: Record<string, string> = {
      user: UI.COLORS.yellow,
      assistant: UI.COLORS.green,
      reviewer: UI.COLORS.magenta,
      intervention: UI.COLORS.red,
      system: UI.COLORS.cyan,
    };
    return colors[role] || UI.COLORS.gray;
  }

  private renderMessageDetail() {
    const log = this.currentLogs[this.selectedMessageIndex];
    if (!log) {
      this.view = View.LANE_DETAIL;
      this.render();
      return;
    }

    this.renderHeader('Message Detail', [path.basename(this.runDir), this.selectedLaneName || '', log.role.toUpperCase()]);

    const roleColor = this.getRoleColor(log.role);
    const ts = new Date(log.timestamp).toLocaleString();
    
    process.stdout.write(`\n`);
    process.stdout.write(` ${UI.COLORS.dim}Role${UI.COLORS.reset}      ${roleColor}${log.role.toUpperCase()}${UI.COLORS.reset}\n`);
    process.stdout.write(` ${UI.COLORS.dim}Time${UI.COLORS.reset}      ${ts}\n`);
    if (log.model) process.stdout.write(` ${UI.COLORS.dim}Model${UI.COLORS.reset}     ${log.model}\n`);
    if (log.task) process.stdout.write(` ${UI.COLORS.dim}Task${UI.COLORS.reset}      ${log.task}\n`);
    
    this.renderSectionTitle('Content');
    
    // Display message content with wrapping
    const maxWidth = this.screenWidth - 4;
    const lines = log.fullText.split('\n');
    const maxLines = this.screenHeight - 16;
    
    let lineCount = 0;
    for (const line of lines) {
      if (lineCount >= maxLines) {
        process.stdout.write(` ${UI.COLORS.dim}... (truncated, ${lines.length - lineCount} more lines)${UI.COLORS.reset}\n`);
        break;
      }
      
      // Word wrap long lines
      if (line.length > maxWidth) {
        const wrapped = this.wrapText(line, maxWidth);
        for (const wl of wrapped) {
          if (lineCount >= maxLines) break;
          process.stdout.write(` ${wl}\n`);
          lineCount++;
        }
      } else {
        process.stdout.write(` ${line}\n`);
        lineCount++;
      }
    }

    this.renderFooter(['[←/Esc] Back']);
  }
  
  /**
   * Wrap text to specified width
   */
  private wrapText(text: string, maxWidth: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';
    
    for (const word of words) {
      if (currentLine.length + word.length + 1 <= maxWidth) {
        currentLine += (currentLine ? ' ' : '') + word;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);
    
    return lines;
  }

  private renderFlow() {
    this.renderHeader('Dependency Flow', [path.basename(this.runDir), 'Flow']);

    const laneMap = new Map<string, any>();
    this.lanes.forEach(lane => {
      laneMap.set(lane.name, this.getLaneStatus(lane.path, lane.name));
    });

    process.stdout.write('\n');
    
    // Group lanes by dependency level
    const levels = this.calculateDependencyLevels();
    const maxLevelWidth = Math.max(...levels.map(l => l.length));
    
    for (let level = 0; level < levels.length; level++) {
      const lanesAtLevel = levels[level]!;
      
      // Level header
      process.stdout.write(` ${UI.COLORS.dim}Level ${level}${UI.COLORS.reset}\n`);
      
      for (const laneName of lanesAtLevel) {
        const status = laneMap.get(laneName);
        const statusIcon = this.getStatusIcon(status?.status || 'pending');
        
        let statusColor = UI.COLORS.gray;
        if (status?.status === 'completed') statusColor = UI.COLORS.green;
        else if (status?.status === 'running') statusColor = UI.COLORS.cyan;
        else if (status?.status === 'failed') statusColor = UI.COLORS.red;

        // Render the node
        const nodeText = `${statusIcon} ${laneName}`;
        process.stdout.write(`   ${statusColor}${nodeText.padEnd(20)}${UI.COLORS.reset}`);
        
        // Render dependencies
        if (status?.dependsOn?.length > 0) {
          process.stdout.write(` ${UI.COLORS.dim}←${UI.COLORS.reset} ${UI.COLORS.yellow}${status.dependsOn.join(', ')}${UI.COLORS.reset}`);
        }
        process.stdout.write('\n');
      }
      
      if (level < levels.length - 1) {
        process.stdout.write(`   ${UI.COLORS.dim}│${UI.COLORS.reset}\n`);
        process.stdout.write(`   ${UI.COLORS.dim}▼${UI.COLORS.reset}\n`);
      }
    }

    process.stdout.write(`\n ${UI.COLORS.dim}Lanes wait for dependencies to complete before starting${UI.COLORS.reset}\n`);
    
    this.renderFooter(['[←/Esc] Back']);
  }
  
  /**
   * Calculate dependency levels for visualization
   */
  private calculateDependencyLevels(): string[][] {
    const levels: string[][] = [];
    const assigned = new Set<string>();
    
    // First, find lanes with no dependencies
    const noDeps = this.lanes.filter(l => !l.dependsOn || l.dependsOn.length === 0);
    if (noDeps.length > 0) {
      levels.push(noDeps.map(l => l.name));
      noDeps.forEach(l => assigned.add(l.name));
    }
    
    // Then assign remaining lanes by dependency completion
    let maxIterations = 10;
    while (assigned.size < this.lanes.length && maxIterations-- > 0) {
      const nextLevel: string[] = [];
      
      for (const lane of this.lanes) {
        if (assigned.has(lane.name)) continue;
        
        // Check if all dependencies are assigned
        const allDepsAssigned = lane.dependsOn.every(d => assigned.has(d));
        if (allDepsAssigned) {
          nextLevel.push(lane.name);
        }
      }
      
      if (nextLevel.length === 0) {
        // Remaining lanes have circular deps or missing deps
        const remaining = this.lanes.filter(l => !assigned.has(l.name)).map(l => l.name);
        if (remaining.length > 0) {
          levels.push(remaining);
        }
        break;
      }
      
      levels.push(nextLevel);
      nextLevel.forEach(n => assigned.add(n));
    }
    
    return levels;
  }

  private renderTerminal() {
    const lane = this.lanes.find(l => l.name === this.selectedLaneName);
    if (!lane) {
      this.view = View.LIST;
      this.render();
      return;
    }

    this.renderHeader('Live Terminal', [path.basename(this.runDir), lane.name, 'Terminal']);

    // Get logs based on format mode
    let logLines: string[] = [];
    let totalLines = 0;
    
    if (this.readableFormat) {
      // Use JSONL for readable format
      const jsonlPath = safeJoin(lane.path, 'terminal.jsonl');
      logLines = this.getReadableLogLines(jsonlPath, lane.name);
      totalLines = logLines.length;
    } else {
      // Use readable log
      const logPath = safeJoin(lane.path, 'terminal-readable.log');
      if (fs.existsSync(logPath)) {
        const content = fs.readFileSync(logPath, 'utf8');
        logLines = content.split('\n');
        totalLines = logLines.length;
      }
    }

    const maxVisible = this.screenHeight - 10;

    // Follow mode logic
    if (this.followMode) {
      this.terminalScrollOffset = 0;
    } else {
      if (this.lastTerminalTotalLines > 0 && totalLines > this.lastTerminalTotalLines) {
        this.unseenLineCount += (totalLines - this.lastTerminalTotalLines);
        this.terminalScrollOffset += (totalLines - this.lastTerminalTotalLines);
      }
    }
    this.lastTerminalTotalLines = totalLines;
    
    // Clamp scroll offset
    const maxScroll = Math.max(0, totalLines - maxVisible);
    if (this.terminalScrollOffset > maxScroll) {
      this.terminalScrollOffset = maxScroll;
    }

    // Mode and status indicators
    const formatMode = this.readableFormat 
      ? `${UI.COLORS.green}[R] Readable ✓${UI.COLORS.reset}` 
      : `${UI.COLORS.dim}[R] Raw${UI.COLORS.reset}`;
    const followStatus = this.followMode 
      ? `${UI.COLORS.green}[F] Follow ✓${UI.COLORS.reset}` 
      : `${UI.COLORS.yellow}[F] Follow OFF${this.unseenLineCount > 0 ? ` (↓${this.unseenLineCount})` : ''}${UI.COLORS.reset}`;
    
    process.stdout.write(` ${formatMode}  ${followStatus}  ${UI.COLORS.dim}Lines: ${totalLines}${UI.COLORS.reset}\n\n`);

    // Slice based on scroll (0 means bottom, >0 means scrolled up)
    const end = totalLines - this.terminalScrollOffset;
    const start = Math.max(0, end - maxVisible);
    const visibleLines = logLines.slice(start, end);

    for (const line of visibleLines) {
      const formatted = this.readableFormat ? line : this.formatTerminalLine(line);
      // Truncate to screen width
      const displayLine = formatted.length > this.screenWidth - 2 
        ? formatted.substring(0, this.screenWidth - 5) + '...' 
        : formatted;
      process.stdout.write(` ${displayLine}\n`);
    }
    
    if (visibleLines.length === 0) {
      process.stdout.write(` ${UI.COLORS.dim}(No output yet)${UI.COLORS.reset}\n`);
    }

    this.renderFooter([
      '[↑↓] Scroll', '[F] Follow', '[R] Toggle Readable', '[I] Intervene', '[←/Esc] Back'
    ]);
  }
  
  /**
   * Format a raw terminal line with syntax highlighting
   */
  private formatTerminalLine(line: string): string {
    // Highlight patterns
    if (line.includes('[HUMAN INTERVENTION]') || line.includes('Injecting intervention:')) {
      return `${UI.COLORS.yellow}${UI.COLORS.bold}${line}${UI.COLORS.reset}`;
    }
    if (line.includes('Executing cursor-agent')) {
      return `${UI.COLORS.cyan}${UI.COLORS.bold}${line}${UI.COLORS.reset}`;
    }
    if (line.includes('=== Task:') || line.includes('Starting task:')) {
      return `${UI.COLORS.green}${UI.COLORS.bold}${line}${UI.COLORS.reset}`;
    }
    if (line.toLowerCase().includes('error') || line.toLowerCase().includes('failed')) {
      return `${UI.COLORS.red}${line}${UI.COLORS.reset}`;
    }
    if (line.toLowerCase().includes('success') || line.toLowerCase().includes('completed')) {
      return `${UI.COLORS.green}${line}${UI.COLORS.reset}`;
    }
    return line;
  }
  
  /**
   * Get readable log lines from JSONL file
   */
  private getReadableLogLines(jsonlPath: string, laneName: string): string[] {
    if (!fs.existsSync(jsonlPath)) {
      // Fallback: try to read raw log
      const rawPath = jsonlPath.replace('.jsonl', '.log');
      if (fs.existsSync(rawPath)) {
        return fs.readFileSync(rawPath, 'utf8').split('\n').map(l => this.formatTerminalLine(l));
      }
      return [];
    }
    
    try {
      const content = fs.readFileSync(jsonlPath, 'utf8');
      const lines = content.split('\n').filter(l => l.trim());
      
      return lines.map(line => {
        try {
          const entry = JSON.parse(line);
          const ts = new Date(entry.timestamp || Date.now()).toLocaleTimeString('en-US', { hour12: false });
          const type = (entry.type || 'info').toLowerCase();
          const content = entry.content || entry.message || '';
          
          // Format based on type
          const typeInfo = this.getLogTypeInfo(type);
          const preview = content.replace(/\n/g, ' ').substring(0, 100);
          
          return `${UI.COLORS.dim}[${ts}]${UI.COLORS.reset} ${typeInfo.color}[${typeInfo.label}]${UI.COLORS.reset} ${preview}`;
        } catch {
          return this.formatTerminalLine(line);
        }
      });
    } catch {
      return [];
    }
  }
  
  /**
   * Get log type display info
   */
  private getLogTypeInfo(type: string): { label: string; color: string } {
    const typeMap: Record<string, { label: string; color: string }> = {
      user: { label: 'USER  ', color: UI.COLORS.cyan },
      assistant: { label: 'ASST  ', color: UI.COLORS.green },
      tool: { label: 'TOOL  ', color: UI.COLORS.yellow },
      tool_result: { label: 'RESULT', color: UI.COLORS.gray },
      result: { label: 'DONE  ', color: UI.COLORS.green },
      system: { label: 'SYSTEM', color: UI.COLORS.gray },
      thinking: { label: 'THINK ', color: UI.COLORS.dim },
      error: { label: 'ERROR ', color: UI.COLORS.red },
      stderr: { label: 'STDERR', color: UI.COLORS.red },
      stdout: { label: 'STDOUT', color: UI.COLORS.white },
    };
    return typeMap[type] || { label: type.toUpperCase().padEnd(6).substring(0, 6), color: UI.COLORS.gray };
  }

  private renderIntervene() {
    this.renderHeader('Human Intervention', [path.basename(this.runDir), this.selectedLaneName || '', 'Intervene']);

    process.stdout.write(`\n`);
    process.stdout.write(` ${UI.COLORS.yellow}Send a message directly to the agent.${UI.COLORS.reset}\n`);
    process.stdout.write(` ${UI.COLORS.dim}This will interrupt the current flow and inject your instruction.${UI.COLORS.reset}\n\n`);
    
    // Input box
    const width = Math.min(this.screenWidth - 8, 80);
    process.stdout.write(` ${UI.COLORS.cyan}┌${'─'.repeat(width)}┐${UI.COLORS.reset}\n`);
    
    // Wrap input text
    const inputLines = this.wrapText(this.interventionInput || ' ', width - 4);
    for (const line of inputLines) {
      process.stdout.write(` ${UI.COLORS.cyan}│${UI.COLORS.reset} ${line.padEnd(width - 2)} ${UI.COLORS.cyan}│${UI.COLORS.reset}\n`);
    }
    if (inputLines.length === 0 || inputLines[inputLines.length - 1] === ' ') {
      process.stdout.write(` ${UI.COLORS.cyan}│${UI.COLORS.reset} ${UI.COLORS.white}█${UI.COLORS.reset}${' '.repeat(width - 3)} ${UI.COLORS.cyan}│${UI.COLORS.reset}\n`);
    }
    
    process.stdout.write(` ${UI.COLORS.cyan}└${'─'.repeat(width)}┘${UI.COLORS.reset}\n`);

    this.renderFooter(['[Enter] Send', '[Esc] Cancel']);
  }

  private renderTimeout() {
    this.renderHeader('Update Timeout', [path.basename(this.runDir), this.selectedLaneName || '', 'Timeout']);

    process.stdout.write(`\n`);
    process.stdout.write(` ${UI.COLORS.yellow}Update the task timeout for this lane.${UI.COLORS.reset}\n`);
    process.stdout.write(` ${UI.COLORS.dim}Enter timeout in milliseconds (e.g., 600000 = 10 minutes)${UI.COLORS.reset}\n\n`);
    
    // Common presets
    process.stdout.write(` ${UI.COLORS.dim}Presets: 300000 (5m) | 600000 (10m) | 1800000 (30m) | 3600000 (1h)${UI.COLORS.reset}\n\n`);
    
    // Input box
    const width = 40;
    process.stdout.write(` ${UI.COLORS.cyan}┌${'─'.repeat(width)}┐${UI.COLORS.reset}\n`);
    process.stdout.write(` ${UI.COLORS.cyan}│${UI.COLORS.reset} ${(this.timeoutInput || '').padEnd(width - 2)}${UI.COLORS.white}█${UI.COLORS.reset} ${UI.COLORS.cyan}│${UI.COLORS.reset}\n`);
    process.stdout.write(` ${UI.COLORS.cyan}└${'─'.repeat(width)}┘${UI.COLORS.reset}\n`);
    
    // Show human-readable interpretation
    if (this.timeoutInput) {
      const ms = parseInt(this.timeoutInput);
      if (!isNaN(ms) && ms > 0) {
        const formatted = this.formatDuration(ms);
        process.stdout.write(`\n ${UI.COLORS.green}= ${formatted}${UI.COLORS.reset}\n`);
      }
    }

    this.renderFooter(['[Enter] Apply', '[Esc] Cancel']);
  }

  /**
   * Render unified log view - all lanes combined
   */
  private renderUnifiedLog() {
    this.renderHeader('Unified Logs', [path.basename(this.runDir), 'All Lanes']);
    
    const bufferState = this.unifiedLogBuffer?.getState();
    const totalEntries = bufferState?.totalEntries || 0;
    const availableLanes = bufferState?.lanes || [];
    
    // Status bar
    const formatMode = this.readableFormat 
      ? `${UI.COLORS.green}[R] Readable ✓${UI.COLORS.reset}` 
      : `${UI.COLORS.dim}[R] Compact${UI.COLORS.reset}`;
    const followStatus = this.unifiedLogFollowMode
      ? `${UI.COLORS.green}[F] Follow ✓${UI.COLORS.reset}`
      : `${UI.COLORS.yellow}[F] Follow OFF${UI.COLORS.reset}`;
    const filterStatus = this.laneFilter 
      ? `${UI.COLORS.cyan}[L] ${this.laneFilter}${UI.COLORS.reset}`
      : `${UI.COLORS.dim}[L] All Lanes${UI.COLORS.reset}`;
    
    process.stdout.write(` ${formatMode}  ${followStatus}  ${filterStatus}  ${UI.COLORS.dim}Total: ${totalEntries}${UI.COLORS.reset}\n`);
    
    // Lane list for filtering hint
    if (availableLanes.length > 1) {
      process.stdout.write(` ${UI.COLORS.dim}Lanes: ${availableLanes.join(', ')}${UI.COLORS.reset}\n`);
    }
    process.stdout.write('\n');

    if (!this.unifiedLogBuffer) {
      process.stdout.write(` ${UI.COLORS.dim}(No log buffer available)${UI.COLORS.reset}\n`);
      this.renderFooter(['[U/Esc] Back', '[Q] Quit']);
      return;
    }

    const pageSize = this.screenHeight - 12;
    const filter = this.laneFilter ? { lane: this.laneFilter } : undefined;
    
    const entries = this.unifiedLogBuffer.getEntries({
      offset: this.unifiedLogScrollOffset,
      limit: pageSize,
      filter,
      fromEnd: true,
    });

    if (entries.length === 0) {
      process.stdout.write(` ${UI.COLORS.dim}(No log entries yet)${UI.COLORS.reset}\n`);
    } else {
      for (const entry of entries) {
        const formatted = this.formatUnifiedLogEntry(entry);
        const displayLine = formatted.length > this.screenWidth - 2 
          ? formatted.substring(0, this.screenWidth - 5) + '...' 
          : formatted;
        process.stdout.write(` ${displayLine}\n`);
      }
    }

    this.renderFooter([
      '[↑↓/PgUp/PgDn] Scroll', '[F] Follow', '[R] Readable', '[L] Filter Lane', '[U/Esc] Back'
    ]);
  }
  
  /**
   * Format a unified log entry
   */
  private formatUnifiedLogEntry(entry: BufferedLogEntry): string {
    const ts = entry.timestamp.toLocaleTimeString('en-US', { hour12: false });
    const lane = entry.laneName.padEnd(12);
    const typeInfo = this.getLogTypeInfo(entry.type || 'info');
    
    if (this.readableFormat) {
      // Readable format: show more context
      const content = entry.message.replace(/\n/g, ' ');
      return `${UI.COLORS.dim}[${ts}]${UI.COLORS.reset} ${entry.laneColor}[${lane}]${UI.COLORS.reset} ${typeInfo.color}[${typeInfo.label}]${UI.COLORS.reset} ${content}`;
    } else {
      // Compact format
      const preview = entry.message.replace(/\n/g, ' ').substring(0, 60);
      return `${UI.COLORS.dim}${ts}${UI.COLORS.reset} ${entry.laneColor}${entry.laneName.substring(0, 8).padEnd(8)}${UI.COLORS.reset} ${typeInfo.color}${typeInfo.label.trim().substring(0, 4)}${UI.COLORS.reset} ${preview}`;
    }
  }

  /**
   * Render multiple flows dashboard
   */
  private renderFlowsDashboard() {
    this.renderHeader('All Flows', ['Flows Dashboard']);
    
    process.stdout.write(` ${UI.COLORS.dim}Total: ${this.allFlows.length} flows${UI.COLORS.reset}\n\n`);

    if (this.allFlows.length === 0) {
      process.stdout.write(` ${UI.COLORS.dim}No flow runs found.${UI.COLORS.reset}\n\n`);
      process.stdout.write(` Run ${UI.COLORS.cyan}cursorflow run${UI.COLORS.reset} to start a new flow.\n`);
      this.renderFooter(['[M/Esc] Back', '[Q] Quit']);
      return;
    }

    // Header
    process.stdout.write(`    ${'Status'.padEnd(8)}  ${'Run ID'.padEnd(32)}  ${'Lanes'.padEnd(12)}  Progress\n`);
    process.stdout.write(`    ${'─'.repeat(8)}  ${'─'.repeat(32)}  ${'─'.repeat(12)}  ${'─'.repeat(20)}\n`);

    const maxVisible = this.screenHeight - 14;
    const startIdx = Math.max(0, this.selectedFlowIndex - Math.floor(maxVisible / 2));
    const endIdx = Math.min(this.allFlows.length, startIdx + maxVisible);
    
    for (let i = startIdx; i < endIdx; i++) {
      const flow = this.allFlows[i]!;
      const isSelected = i === this.selectedFlowIndex;
      const isCurrent = flow.runDir === this.runDir;
      
      // Status icon based on flow state
      let statusIcon = '⚪';
      if (flow.isAlive) {
        statusIcon = '🟢';
      } else if (flow.summary.completed === flow.summary.total && flow.summary.total > 0) {
        statusIcon = '✅';
      } else if (flow.summary.failed > 0 || flow.summary.dead > 0) {
        statusIcon = '🔴';
      }
      
      // Lanes summary
      const lanesSummary = [
        flow.summary.running > 0 ? `${UI.COLORS.cyan}${flow.summary.running}R${UI.COLORS.reset}` : '',
        flow.summary.completed > 0 ? `${UI.COLORS.green}${flow.summary.completed}C${UI.COLORS.reset}` : '',
        flow.summary.failed > 0 ? `${UI.COLORS.red}${flow.summary.failed}F${UI.COLORS.reset}` : '',
        flow.summary.dead > 0 ? `${UI.COLORS.yellow}${flow.summary.dead}D${UI.COLORS.reset}` : '',
      ].filter(Boolean).join('/') || '0';
      
      // Progress bar
      const total = flow.summary.total || 1;
      const completed = flow.summary.completed;
      const ratio = completed / total;
      const barWidth = 12;
      const filled = Math.round(ratio * barWidth);
      const progressBar = `${UI.COLORS.green}${'█'.repeat(filled)}${UI.COLORS.reset}${UI.COLORS.gray}${'░'.repeat(barWidth - filled)}${UI.COLORS.reset}`;
      const pct = `${Math.round(ratio * 100)}%`;
      
      // Display
      const prefix = isSelected ? ` ${UI.COLORS.cyan}▶${UI.COLORS.reset} ` : '   ';
      const currentTag = isCurrent ? ` ${UI.COLORS.cyan}●${UI.COLORS.reset}` : '';
      const bg = isSelected ? UI.COLORS.bgGray : '';
      const resetBg = isSelected ? UI.COLORS.reset : '';
      
      // Truncate run ID if needed
      const runIdDisplay = flow.runId.length > 30 ? flow.runId.substring(0, 27) + '...' : flow.runId.padEnd(30);
      
      process.stdout.write(`${bg}${prefix}${statusIcon}       ${runIdDisplay}  ${lanesSummary.padEnd(12 + 30)}  ${progressBar} ${pct}${currentTag}${resetBg}\n`);
    }
    
    if (this.allFlows.length > maxVisible) {
      process.stdout.write(`\n ${UI.COLORS.dim}(${this.allFlows.length - maxVisible} more flows, scroll to see)${UI.COLORS.reset}\n`);
    }

    this.renderFooter([
      '[↑↓] Select', '[→/Enter] Switch', '[D] Delete', '[R] Refresh', '[M/Esc] Back', '[Q] Quit'
    ]);
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


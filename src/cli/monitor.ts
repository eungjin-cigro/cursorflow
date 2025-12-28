/**
 * CursorFlow Interactive Monitor v2.0
 * 
 * Redesigned UX with:
 * - Tab-based main dashboard
 * - Arrow-key-first navigation
 * - Context-aware action menus
 * - Maximum 3-level depth
 * - Consistent key mappings across all views
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { loadState, readLog } from '../utils/state';
import { LaneState, ConversationEntry } from '../utils/types';
import { loadConfig, getLogsDir } from '../utils/config';
import { safeJoin } from '../utils/path';
import { getLaneProcessStatus, getFlowSummary, LaneProcessStatus } from '../services/process';
import { LogBufferService, BufferedLogEntry } from '../services/logging/buffer';
import { formatReadableEntry, stripAnsi } from '../services/logging/formatter';
import { createInterventionRequest, InterventionType, wrapUserIntervention } from '../core/intervention';

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
    bgYellow: '\x1b[43m',
    bgBlack: '\x1b[40m',
  },
  ICONS: {
    running: '🔄',
    completed: '✅',
    done: '✅',
    failed: '❌',
    waiting: '⏳',
    pending: '⚪',
    stale: '💀',
    dead: '☠️',
    live: '🟢',
    stopped: '🔴',
    arrow: '▶',
    arrowLeft: '◀',
    selected: '●',
    unselected: '○',
  },
  CHARS: {
    hLine: '━',
    hLineLight: '─',
    vLine: '│',
    corner: { tl: '┌', tr: '┐', bl: '└', br: '┘' },
    tee: { left: '├', right: '┤', top: '┬', bottom: '┴' },
    cross: '┼',
  },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Types
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface LaneInfo {
  name: string;
  path: string;
}

interface FlowInfo {
  runDir: string;
  runId: string;
  isAlive: boolean;
  summary: ReturnType<typeof getFlowSummary>;
}

interface ActionItem {
  id: string;
  label: string;
  icon: string;
  action: () => void;
  disabled?: boolean;
  disabledReason?: string;
}

enum Tab {
  CURRENT_FLOW = 0,
  ALL_FLOWS = 1,
  UNIFIED_LOG = 2,
}

enum Level {
  DASHBOARD = 1,
  DETAIL = 2,
  ACTION_MENU = 3,
}

enum Panel {
  LEFT = 0,
  RIGHT = 1,
}

interface MonitorState {
  // Navigation
  level: Level;
  currentTab: Tab;
  
  // Selection indexes
  selectedLaneIndex: number;
  selectedFlowIndex: number;
  selectedLogIndex: number;
  selectedActionIndex: number;
  selectedMessageIndex: number;
  
  // Detail view state
  selectedLaneName: string | null;
  currentPanel: Panel;
  terminalScrollOffset: number;
  messageScrollOffset: number;
  followMode: boolean;
  readableFormat: boolean; // Toggle between readable and raw log format
  
  // Log view state
  unifiedLogScrollOffset: number;
  unifiedLogFollowMode: boolean;
  laneFilter: string | null;
  readableLogFormat: boolean; // For unified log view
  
  // Action menu
  actionMenuVisible: boolean;
  actionItems: ActionItem[];
  
  // Input mode
  inputMode: 'none' | 'message' | 'timeout';
  inputBuffer: string;
  inputTarget: string | null;
  
  // Help overlay
  showHelp: boolean;
  
  // Notification
  notification: { message: string; type: 'info' | 'error' | 'success'; time: number } | null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Helper functions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function printHelp(): void {
  console.log(`
Usage: cursorflow monitor [run-dir] [options]

Interactive lane dashboard with improved UX.

Options:
  [run-dir]              Run directory to monitor (default: latest)
  --list, -l             Start with All Flows tab
  --interval <seconds>   Refresh interval (default: 2)
  --help, -h             Show help

Navigation:
  ←/→       Tab switch (Level 1) or Panel switch (Level 2)
  ↑/↓       Select item or scroll
  Enter     Open action menu
  Esc       Go back / Close menu
  Q         Quit

Examples:
  cursorflow monitor             # Monitor latest run
  cursorflow monitor --list      # Show all runs
  cursorflow monitor run-123     # Monitor specific run
  `);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Interactive Monitor Class
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class InteractiveMonitor {
  private runDir: string;
  private interval: number;
  private logsDir: string;
  private timer: NodeJS.Timeout | null = null;
  
  // Data
  private lanes: LaneInfo[] = [];
  private allFlows: FlowInfo[] = [];
  private currentLogs: ConversationEntry[] = [];
  private laneProcessStatuses: Map<string, LaneProcessStatus> = new Map();
  private unifiedLogBuffer: LogBufferService | null = null;
  
  // State
  private state: MonitorState;
  
  // Screen dimensions
  private get screenWidth(): number {
    return process.stdout.columns || 120;
  }
  private get screenHeight(): number {
    return process.stdout.rows || 24;
  }

  constructor(runDir: string, interval: number, initialTab: Tab = Tab.CURRENT_FLOW) {
    const config = loadConfig();
    
    if (config.projectRoot !== process.cwd()) {
      process.chdir(config.projectRoot);
    }

    this.runDir = runDir;
    this.interval = interval;
    this.logsDir = safeJoin(getLogsDir(config), 'runs');
    
    // Initialize state
    this.state = {
      level: Level.DASHBOARD,
      currentTab: initialTab,
      selectedLaneIndex: 0,
      selectedFlowIndex: 0,
      selectedLogIndex: 0,
      selectedActionIndex: 0,
      selectedMessageIndex: 0,
      selectedLaneName: null,
      currentPanel: Panel.LEFT,
      terminalScrollOffset: 0,
      messageScrollOffset: 0,
      followMode: true,
      readableFormat: true,
      unifiedLogScrollOffset: 0,
      unifiedLogFollowMode: true,
      laneFilter: null,
      readableLogFormat: true,
      actionMenuVisible: false,
      actionItems: [],
      inputMode: 'none',
      inputBuffer: '',
      inputTarget: null,
      showHelp: false,
      notification: null,
    };
    
    // Initialize unified log buffer
    this.unifiedLogBuffer = new LogBufferService(runDir);
  }

  public async start() {
    // Non-interactive mode for CI/pipes
    if (!process.stdout.isTTY || !process.stdin.isTTY) {
      this.discoverFlows();
      this.refresh();
      const flowSummary = getFlowSummary(this.runDir);
      console.log(`\nMonitoring run: ${path.basename(this.runDir)}`);
      console.log(`Status: ${flowSummary.running} running, ${flowSummary.completed} completed, ${flowSummary.failed} failed`);
      return;
    }

    this.setupTerminal();
    
    // Start unified log streaming
    if (this.unifiedLogBuffer) {
      this.unifiedLogBuffer.startStreaming();
      this.unifiedLogBuffer.on('update', () => {
        if (this.state.currentTab === Tab.UNIFIED_LOG && this.state.unifiedLogFollowMode) {
          this.render();
        }
      });
    }
    
    this.discoverFlows();
    this.refresh();
    this.timer = setInterval(() => this.refresh(), this.interval * 1000);
  }
  
  private discoverFlows(): void {
    try {
      if (!fs.existsSync(this.logsDir)) return;
      
      this.allFlows = fs.readdirSync(this.logsDir)
        .filter(d => d.startsWith('run-'))
        .map(d => {
          const runDir = safeJoin(this.logsDir, d);
          const summary = getFlowSummary(runDir);
          return { runDir, runId: d, isAlive: summary.isAlive, summary };
        })
        .sort((a, b) => b.runId.localeCompare(a.runId));
    } catch {
      // Ignore errors
    }
  }

  private setupTerminal() {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    readline.emitKeypressEvents(process.stdin);
    process.stdin.on('keypress', (str, key) => this.handleKeypress(str, key));
    process.stdout.write('\x1B[?25l'); // Hide cursor
  }

  private stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.unifiedLogBuffer) this.unifiedLogBuffer.stopStreaming();
    process.stdout.write('\x1B[?25h'); // Show cursor
    process.stdout.write('\x1Bc'); // Clear screen
    console.log('\n👋 Monitoring stopped\n');
    process.exit(0);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Key Handling - Unified handler
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  private handleKeypress(str: string, key: any) {
    // Ctrl+C always quits
    if (key && key.ctrl && key.name === 'c') {
      this.stop();
      return;
    }
    
    const keyName = key ? key.name : str;
    
    // Handle input mode first
    if (this.state.inputMode !== 'none') {
      this.handleInputKey(str, key);
      return;
    }
    
    // Handle action menu
    if (this.state.actionMenuVisible) {
      this.handleActionMenuKey(keyName);
      return;
    }
    
    // Handle based on level and tab
    if (this.state.level === Level.DASHBOARD) {
      this.handleDashboardKey(keyName);
    } else if (this.state.level === Level.DETAIL) {
      this.handleDetailKey(keyName);
    }
  }
  
  private handleDashboardKey(keyName: string) {
    switch (keyName) {
      // Tab navigation (Left/Right at dashboard level)
      case 'left':
        this.state.currentTab = Math.max(0, this.state.currentTab - 1) as Tab;
        this.resetSelectionForTab();
        this.render();
        break;
      case 'right':
        // If an item is selected, go to detail
        if (this.canEnterDetail()) {
          this.enterDetail();
        } else {
          // Otherwise switch tab
          this.state.currentTab = Math.min(2, this.state.currentTab + 1) as Tab;
          this.resetSelectionForTab();
        }
        this.render();
        break;
      case 'tab':
        this.state.currentTab = ((this.state.currentTab + 1) % 3) as Tab;
        this.resetSelectionForTab();
        this.render();
        break;
        
      // Item selection
      case 'up':
        this.moveSelectionUp();
        this.render();
        break;
      case 'down':
        this.moveSelectionDown();
        this.render();
        break;
        
      // Actions
      case 'return':
      case 'enter':
        this.openActionMenu();
        this.render();
        break;
        
      // Quit
      case 'q':
        this.stop();
        break;
        
      // Space for follow toggle in log tab
      case 'space':
        if (this.state.currentTab === Tab.UNIFIED_LOG) {
          this.state.unifiedLogFollowMode = !this.state.unifiedLogFollowMode;
          if (this.state.unifiedLogFollowMode) {
            this.state.unifiedLogScrollOffset = 0;
          }
          this.render();
        }
        break;
        
      // Help
      case '?':
        this.state.showHelp = !this.state.showHelp;
        this.render();
        break;
        
      // Readable format toggle (for log tab)
      case 'r':
        if (this.state.currentTab === Tab.UNIFIED_LOG) {
          this.state.readableLogFormat = !this.state.readableLogFormat;
          this.render();
        }
        break;
    }
  }
  
  private handleDetailKey(keyName: string) {
    switch (keyName) {
      // Back to dashboard
      case 'left':
        if (this.state.currentPanel === Panel.RIGHT) {
          this.state.currentPanel = Panel.LEFT;
        } else {
          this.state.level = Level.DASHBOARD;
          this.state.selectedLaneName = null;
        }
        this.render();
        break;
      case 'escape':
        this.state.level = Level.DASHBOARD;
        this.state.selectedLaneName = null;
        this.render();
        break;
        
      // Panel switch
      case 'right':
        if (this.state.currentPanel === Panel.LEFT) {
          this.state.currentPanel = Panel.RIGHT;
        }
        this.render();
        break;
        
      // Scroll in current panel
      case 'up':
        if (this.state.currentPanel === Panel.LEFT) {
          this.state.followMode = false;
          this.state.terminalScrollOffset++;
        } else {
          this.state.messageScrollOffset = Math.max(0, this.state.messageScrollOffset - 1);
        }
        this.render();
        break;
      case 'down':
        if (this.state.currentPanel === Panel.LEFT) {
          this.state.terminalScrollOffset = Math.max(0, this.state.terminalScrollOffset - 1);
          if (this.state.terminalScrollOffset === 0) {
            this.state.followMode = true;
          }
        } else {
          this.state.messageScrollOffset++;
        }
        this.render();
        break;
        
      // Actions
      case 'return':
      case 'enter':
        this.openActionMenu();
        this.render();
        break;
        
      // Follow toggle
      case 'space':
        this.state.followMode = !this.state.followMode;
        if (this.state.followMode) {
          this.state.terminalScrollOffset = 0;
        }
        this.render();
        break;
        
      // Readable format toggle
      case 'r':
        this.state.readableFormat = !this.state.readableFormat;
        this.render();
        break;
        
      // Help
      case '?':
        this.state.showHelp = !this.state.showHelp;
        this.render();
        break;
        
      // Quit
      case 'q':
        this.stop();
        break;
    }
  }
  
  private handleActionMenuKey(keyName: string) {
    switch (keyName) {
      case 'up':
        this.state.selectedActionIndex = Math.max(0, this.state.selectedActionIndex - 1);
        this.render();
        break;
      case 'down':
        this.state.selectedActionIndex = Math.min(
          this.state.actionItems.length - 1,
          this.state.selectedActionIndex + 1
        );
        this.render();
        break;
      case 'return':
      case 'enter':
        this.executeAction();
        break;
      case 'escape':
      case 'left':
        this.state.actionMenuVisible = false;
        this.render();
        break;
      case 'q':
        this.state.actionMenuVisible = false;
        this.render();
        break;
      default:
        // Number keys for quick selection
        const num = parseInt(keyName);
        if (!isNaN(num) && num >= 1 && num <= this.state.actionItems.length) {
          this.state.selectedActionIndex = num - 1;
          this.executeAction();
        }
        break;
    }
  }
  
  private handleInputKey(str: string, key: any) {
    if (key && key.name === 'escape') {
      this.state.inputMode = 'none';
      this.state.inputBuffer = '';
      this.render();
      return;
    }
    
    if (key && (key.name === 'return' || key.name === 'enter')) {
      this.submitInput();
      return;
    }
    
    if (key && key.name === 'backspace') {
      this.state.inputBuffer = this.state.inputBuffer.slice(0, -1);
      this.render();
      return;
    }
    
    if (str && str.length === 1 && !key?.ctrl && !key?.meta) {
      // For timeout, only allow numbers
      if (this.state.inputMode === 'timeout' && !/^\d$/.test(str)) {
        return;
      }
      this.state.inputBuffer += str;
      this.render();
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Navigation Helpers
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  private resetSelectionForTab() {
    this.state.selectedLaneIndex = 0;
    this.state.selectedFlowIndex = 0;
    this.state.selectedLogIndex = 0;
    this.state.unifiedLogScrollOffset = 0;
  }
  
  private canEnterDetail(): boolean {
    switch (this.state.currentTab) {
      case Tab.CURRENT_FLOW:
        return this.lanes.length > 0;
      case Tab.ALL_FLOWS:
        return this.allFlows.length > 0;
      case Tab.UNIFIED_LOG:
        return false; // Log detail is inline
    }
  }
  
  private enterDetail() {
    if (this.state.currentTab === Tab.CURRENT_FLOW && this.lanes[this.state.selectedLaneIndex]) {
      this.state.selectedLaneName = this.lanes[this.state.selectedLaneIndex]!.name;
      this.state.level = Level.DETAIL;
      this.state.currentPanel = Panel.LEFT;
      this.state.terminalScrollOffset = 0;
      this.state.messageScrollOffset = 0;
      this.state.followMode = true;
      this.refreshLogs();
    } else if (this.state.currentTab === Tab.ALL_FLOWS && this.allFlows[this.state.selectedFlowIndex]) {
      // Switch to selected flow
      const flow = this.allFlows[this.state.selectedFlowIndex]!;
      this.switchToFlow(flow);
    }
  }
  
  private moveSelectionUp() {
    switch (this.state.currentTab) {
      case Tab.CURRENT_FLOW:
        this.state.selectedLaneIndex = Math.max(0, this.state.selectedLaneIndex - 1);
        break;
      case Tab.ALL_FLOWS:
        this.state.selectedFlowIndex = Math.max(0, this.state.selectedFlowIndex - 1);
        break;
      case Tab.UNIFIED_LOG:
        this.state.unifiedLogFollowMode = false;
        this.state.unifiedLogScrollOffset++;
        break;
    }
  }
  
  private moveSelectionDown() {
    switch (this.state.currentTab) {
      case Tab.CURRENT_FLOW:
        this.state.selectedLaneIndex = Math.min(this.lanes.length - 1, this.state.selectedLaneIndex + 1);
        break;
      case Tab.ALL_FLOWS:
        this.state.selectedFlowIndex = Math.min(this.allFlows.length - 1, this.state.selectedFlowIndex + 1);
        break;
      case Tab.UNIFIED_LOG:
        this.state.unifiedLogScrollOffset = Math.max(0, this.state.unifiedLogScrollOffset - 1);
        if (this.state.unifiedLogScrollOffset === 0) {
          this.state.unifiedLogFollowMode = true;
        }
        break;
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Action Menu
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  private openActionMenu() {
    this.state.actionItems = this.getContextActions();
    if (this.state.actionItems.length === 0) return;
    this.state.selectedActionIndex = 0;
    this.state.actionMenuVisible = true;
  }
  
  private getContextActions(): ActionItem[] {
    // Get actions based on current context
    if (this.state.level === Level.DASHBOARD) {
      if (this.state.currentTab === Tab.CURRENT_FLOW && this.lanes[this.state.selectedLaneIndex]) {
        return this.getLaneActions(this.lanes[this.state.selectedLaneIndex]!);
      } else if (this.state.currentTab === Tab.ALL_FLOWS && this.allFlows[this.state.selectedFlowIndex]) {
        return this.getFlowActions(this.allFlows[this.state.selectedFlowIndex]!);
      } else if (this.state.currentTab === Tab.UNIFIED_LOG) {
        return this.getLogActions();
      }
    } else if (this.state.level === Level.DETAIL && this.state.selectedLaneName) {
      const lane = this.lanes.find(l => l.name === this.state.selectedLaneName);
      if (lane) return this.getLaneActions(lane);
    }
    return [];
  }
  
  private getLaneActions(lane: LaneInfo): ActionItem[] {
    const status = this.getLaneStatus(lane.path, lane.name);
    const isRunning = status.status === 'running';
    const isCompleted = status.status === 'completed' || status.status === 'success';
    
    return [
      {
        id: 'message',
        label: 'Send Message',
        icon: '💬',
        action: () => this.startMessageInput(lane.name),
        disabled: !isRunning,
        disabledReason: 'Lane not running',
      },
      {
        id: 'timeout',
        label: 'Set Timeout',
        icon: '⏱️',
        action: () => this.startTimeoutInput(lane.name),
        disabled: !isRunning,
        disabledReason: 'Lane not running',
      },
      {
        id: 'resume',
        label: 'Resume Lane',
        icon: '▶️',
        action: () => this.resumeLane(lane),
        disabled: isRunning || isCompleted,
        disabledReason: isRunning ? 'Lane already running' : 'Lane already completed',
      },
      {
        id: 'stop',
        label: 'Stop Lane',
        icon: '🔴',
        action: () => this.killLane(lane),
        disabled: !isRunning,
        disabledReason: 'Lane not running',
      },
      {
        id: 'logs',
        label: 'View Full Logs',
        icon: '📋',
        action: () => {
          this.state.selectedLaneName = lane.name;
          this.state.level = Level.DETAIL;
          this.state.currentPanel = Panel.LEFT;
          this.refreshLogs();
          this.state.actionMenuVisible = false;
          this.render();
        },
      },
    ];
  }
  
  private getFlowActions(flow: FlowInfo): ActionItem[] {
    const isCurrent = flow.runDir === this.runDir;
    const isAlive = flow.isAlive;
    const isCompleted = flow.summary.completed === flow.summary.total && flow.summary.total > 0;
    
    return [
      {
        id: 'switch',
        label: 'Switch to Flow',
        icon: '🔄',
        action: () => this.switchToFlow(flow),
        disabled: isCurrent,
        disabledReason: 'Already viewing this flow',
      },
      {
        id: 'resume',
        label: 'Resume Flow',
        icon: '▶️',
        action: () => this.resumeFlow(flow),
        disabled: isAlive || isCompleted,
        disabledReason: isAlive ? 'Flow is already running' : 'Flow is already completed',
      },
      {
        id: 'delete',
        label: 'Delete Flow',
        icon: '🗑️',
        action: () => this.deleteFlow(flow),
        disabled: flow.isAlive || isCurrent,
        disabledReason: flow.isAlive ? 'Cannot delete running flow' : 'Cannot delete current flow',
      },
    ];
  }
  
  private getLogActions(): ActionItem[] {
    const lanes = this.unifiedLogBuffer?.getLanes() || [];
    return [
      {
        id: 'filter',
        label: this.state.laneFilter ? `Filter: ${this.state.laneFilter}` : 'Filter by Lane',
        icon: '🔍',
        action: () => this.cycleLaneFilter(lanes),
      },
      {
        id: 'follow',
        label: this.state.unifiedLogFollowMode ? 'Pause Follow' : 'Resume Follow',
        icon: this.state.unifiedLogFollowMode ? '⏸️' : '▶️',
        action: () => {
          this.state.unifiedLogFollowMode = !this.state.unifiedLogFollowMode;
          this.state.actionMenuVisible = false;
          this.render();
        },
      },
    ];
  }
  
  private executeAction() {
    const action = this.state.actionItems[this.state.selectedActionIndex];
    if (action && !action.disabled) {
      this.state.actionMenuVisible = false;
      action.action();
    } else if (action?.disabled) {
      this.showNotification(action.disabledReason || 'Action not available', 'error');
    }
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Actions Implementation
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  private startMessageInput(laneName: string) {
    this.state.inputMode = 'message';
    this.state.inputBuffer = '';
    this.state.inputTarget = laneName;
    this.state.actionMenuVisible = false;
    this.render();
  }
  
  private startTimeoutInput(laneName: string) {
    this.state.inputMode = 'timeout';
    this.state.inputBuffer = '';
    this.state.inputTarget = laneName;
    this.state.actionMenuVisible = false;
    this.render();
  }
  
  private submitInput() {
    if (this.state.inputMode === 'message') {
      this.sendMessage(this.state.inputTarget!, this.state.inputBuffer);
    } else if (this.state.inputMode === 'timeout') {
      this.setLaneTimeout(this.state.inputTarget!, this.state.inputBuffer);
    }
    this.state.inputMode = 'none';
    this.state.inputBuffer = '';
    this.state.inputTarget = null;
    this.render();
  }
  
  private sendMessage(laneName: string, message: string) {
    const lane = this.lanes.find(l => l.name === laneName);
    if (!lane || !message.trim()) return;
    
    try {
      // Create pending-intervention.json for the system
      createInterventionRequest(lane.path, {
        type: InterventionType.USER_MESSAGE,
        message: wrapUserIntervention(message),
        source: 'user',
        priority: 10
      });
      
      // Kill the process if it's running - this triggers the restart in orchestrator
      const status = this.laneProcessStatuses.get(lane.name);
      if (status && status.pid && status.actualStatus === 'running') {
        try {
          process.kill(status.pid, 'SIGTERM');
        } catch {
          // Ignore kill errors
        }
      }

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
      
      this.showNotification('Message sent', 'success');
    } catch {
      this.showNotification('Failed to send message', 'error');
    }
  }
  
  private setLaneTimeout(laneName: string, timeoutStr: string) {
    const lane = this.lanes.find(l => l.name === laneName);
    if (!lane) return;
    
    try {
      const timeoutMs = parseInt(timeoutStr);
      if (isNaN(timeoutMs) || timeoutMs <= 0) {
        this.showNotification('Invalid timeout value', 'error');
        return;
      }
      
      const timeoutPath = safeJoin(lane.path, 'timeout.txt');
      fs.writeFileSync(timeoutPath, String(timeoutMs), 'utf8');
      this.showNotification(`Timeout set to ${Math.round(timeoutMs/1000)}s`, 'success');
    } catch {
      this.showNotification('Failed to set timeout', 'error');
    }
  }
  
  private killLane(lane: LaneInfo) {
    const status = this.getLaneStatus(lane.path, lane.name);
    if (status.pid && status.status === 'running') {
      try {
        process.kill(status.pid, 'SIGTERM');
        this.showNotification(`Sent SIGTERM to PID ${status.pid}`, 'success');
      } catch {
        this.showNotification(`Failed to kill PID ${status.pid}`, 'error');
      }
    }
    this.state.actionMenuVisible = false;
    this.render();
  }
  
  private resumeFlow(flow: FlowInfo) {
    this.runResumeCommand(['--all', '--run-dir', flow.runDir]);
  }

  private resumeLane(lane: LaneInfo) {
    this.runResumeCommand([lane.name, '--run-dir', this.runDir]);
  }

  private runResumeCommand(args: string[]) {
    try {
      const { spawn } = require('child_process');
      
      // Determine the script to run
      // In production, it's dist/cli/index.js. In dev, it's src/cli/index.ts.
      let entryPoint = path.resolve(__dirname, 'index.js');
      if (!fs.existsSync(entryPoint)) {
        entryPoint = path.resolve(__dirname, 'index.ts');
      }

      const spawnArgs = [entryPoint, 'resume', ...args, '--skip-doctor'];
      
      // If it's a .ts file, we need ts-node or similar (assuming it's available)
      const nodeArgs = entryPoint.endsWith('.ts') ? ['-r', 'ts-node/register'] : [];

      const child = spawn(process.execPath, [...nodeArgs, ...spawnArgs], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, NODE_OPTIONS: '' }
      });
      
      child.unref();
      
      const target = args[0] === '--all' ? 'flow' : `lane ${args[0]}`;
      this.showNotification(`Resume started for ${target}`, 'success');
    } catch (error: any) {
      this.showNotification(`Failed to spawn resume: ${error.message}`, 'error');
    }
  }
  
  private switchToFlow(flow: FlowInfo) {
    this.runDir = flow.runDir;
    
    if (this.unifiedLogBuffer) {
      this.unifiedLogBuffer.stopStreaming();
    }
    this.unifiedLogBuffer = new LogBufferService(this.runDir);
    this.unifiedLogBuffer.startStreaming();
    
    this.lanes = [];
    this.laneProcessStatuses.clear();
    this.state.currentTab = Tab.CURRENT_FLOW;
    this.state.level = Level.DASHBOARD;
    this.state.selectedLaneIndex = 0;
    this.state.actionMenuVisible = false;
    
    this.showNotification(`Switched to: ${flow.runId}`, 'info');
    this.refresh();
  }
  
  private deleteFlow(flow: FlowInfo) {
    try {
      fs.rmSync(flow.runDir, { recursive: true, force: true });
      this.showNotification(`Deleted: ${flow.runId}`, 'success');
      this.discoverFlows();
      if (this.state.selectedFlowIndex >= this.allFlows.length) {
        this.state.selectedFlowIndex = Math.max(0, this.allFlows.length - 1);
      }
    } catch {
      this.showNotification('Failed to delete flow', 'error');
    }
    this.state.actionMenuVisible = false;
    this.render();
  }
  
  private cycleLaneFilter(lanes: string[]) {
    if (lanes.length === 0) {
      this.state.laneFilter = null;
    } else if (this.state.laneFilter === null) {
      this.state.laneFilter = lanes[0]!;
    } else {
      const idx = lanes.indexOf(this.state.laneFilter);
      if (idx === -1 || idx === lanes.length - 1) {
        this.state.laneFilter = null;
      } else {
        this.state.laneFilter = lanes[idx + 1]!;
      }
    }
    this.state.unifiedLogScrollOffset = 0;
    this.state.actionMenuVisible = false;
    this.render();
  }
  
  private showHelp() {
    this.showNotification('←/→: Navigate | ↑/↓: Select | Enter: Action | Esc: Back | Q: Quit', 'info');
    this.render();
  }
  
  private showNotification(message: string, type: 'info' | 'error' | 'success') {
    this.state.notification = { message, type, time: Date.now() };
    this.render();
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Data Refresh
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  private refresh() {
    this.lanes = this.listLanes();
    this.updateProcessStatuses();
    
    if (this.state.level === Level.DETAIL && this.state.selectedLaneName) {
      this.refreshLogs();
    }
    
    if (this.state.currentTab === Tab.ALL_FLOWS) {
      this.discoverFlows();
    }
    
    this.render();
  }
  
  private refreshLogs() {
    if (!this.state.selectedLaneName) return;
    const lane = this.lanes.find(l => l.name === this.state.selectedLaneName);
    if (!lane) return;
    
    const convoPath = safeJoin(lane.path, 'conversation.jsonl');
    this.currentLogs = readLog<ConversationEntry>(convoPath);
    
    if (this.state.messageScrollOffset >= this.currentLogs.length) {
      this.state.messageScrollOffset = Math.max(0, this.currentLogs.length - 1);
    }
  }
  
  private updateProcessStatuses() {
    for (const lane of this.lanes) {
      const status = getLaneProcessStatus(lane.path, lane.name);
      this.laneProcessStatuses.set(lane.name, status);
    }
  }
  
  private listLanes(): LaneInfo[] {
    const lanesDir = safeJoin(this.runDir, 'lanes');
    if (!fs.existsSync(lanesDir)) return [];
    
    return fs.readdirSync(lanesDir)
      .filter(d => fs.statSync(safeJoin(lanesDir, d)).isDirectory())
      .map(name => ({ name, path: safeJoin(lanesDir, name) }));
  }
  
  private getLaneStatus(lanePath: string, _laneName: string) {
    const statePath = safeJoin(lanePath, 'state.json');
    const state = loadState<LaneState & { chatId?: string }>(statePath);
    
    if (!state) {
      return { status: 'pending', currentTask: 0, totalTasks: '?', progress: '0%', duration: 0, pipelineBranch: '-', chatId: '-' };
    }
    
    const progress = state.totalTasks > 0 ? Math.round((state.currentTaskIndex / state.totalTasks) * 100) : 0;
    const duration = state.startTime ? (state.endTime 
      ? state.endTime - state.startTime 
      : (state.status === 'running' ? Date.now() - state.startTime : 0)) : 0;
    
    return {
      status: state.status || 'unknown',
      currentTask: state.currentTaskIndex || 0,
      totalTasks: state.totalTasks || '?',
      progress: `${progress}%`,
      pipelineBranch: state.pipelineBranch || '-',
      chatId: state.chatId || '-',
      duration,
      error: state.error,
      pid: state.pid,
      waitingFor: state.waitingFor || [],
    };
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Rendering
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
  private render() {
    process.stdout.write('\x1Bc'); // Clear screen
    
    // Clear old notification
    if (this.state.notification && Date.now() - this.state.notification.time > 3000) {
      this.state.notification = null;
    }
    
    if (this.state.level === Level.DASHBOARD) {
      this.renderDashboard();
    } else {
      this.renderDetail();
    }
    
    // Overlay: Action Menu
    if (this.state.actionMenuVisible) {
      this.renderActionMenu();
    }
    
    // Overlay: Input Mode
    if (this.state.inputMode !== 'none') {
      this.renderInputOverlay();
    }
    
    // Overlay: Help
    if (this.state.showHelp) {
      this.renderHelpOverlay();
    }
  }
  
  private renderDashboard() {
    const w = this.screenWidth;
    const h = this.screenHeight;
    const { cyan, reset, bold, dim, gray, green, yellow, red } = UI.COLORS;
    
    // Header
    const flowSummary = getFlowSummary(this.runDir);
    const statusIcon = flowSummary.isAlive ? UI.ICONS.live : UI.ICONS.stopped;
    const timeStr = new Date().toLocaleTimeString('en-US', { hour12: false });
    const runId = path.basename(this.runDir);
    
    const hLine = UI.CHARS.hLine.repeat(w);
    process.stdout.write(`${cyan}${hLine}${reset}\n`);
    process.stdout.write(`${bold}  CursorFlow Monitor${reset}  ${gray}${runId}${reset}  ${statusIcon}  ${dim}${timeStr}${reset}\n`);
    
    // Tabs
    const tabs = [
      { label: '현재 플로우', active: this.state.currentTab === Tab.CURRENT_FLOW },
      { label: '모든 플로우', active: this.state.currentTab === Tab.ALL_FLOWS },
      { label: '통합 로그', active: this.state.currentTab === Tab.UNIFIED_LOG },
    ];
    
    let tabLine = '';
    tabs.forEach((tab, i) => {
      if (tab.active) {
        tabLine += `  ${cyan}[${UI.ICONS.selected} ${tab.label}]${reset}`;
      } else {
        tabLine += `  ${dim}[${UI.ICONS.unselected} ${tab.label}]${reset}`;
      }
    });
    process.stdout.write(`${cyan}${hLine}${reset}\n`);
    process.stdout.write(`${tabLine}\n`);
    process.stdout.write(`${cyan}${hLine}${reset}\n`);
    
    // Content based on tab
    const contentHeight = h - 10;
    
    if (this.state.currentTab === Tab.CURRENT_FLOW) {
      this.renderLaneList(contentHeight);
    } else if (this.state.currentTab === Tab.ALL_FLOWS) {
      this.renderFlowList(contentHeight);
    } else {
      this.renderUnifiedLog(contentHeight);
    }
    
    // Notification
    if (this.state.notification) {
      const nColor = this.state.notification.type === 'error' ? red 
        : this.state.notification.type === 'success' ? green : cyan;
      process.stdout.write(`\n${nColor}  🔔 ${this.state.notification.message}${reset}\n`);
    } else {
      process.stdout.write('\n');
    }
    
    // Footer
    process.stdout.write(`${cyan}${hLine}${reset}\n`);
    const help = this.state.currentTab === Tab.UNIFIED_LOG
      ? `${yellow}[←/→]${reset} Tab  ${yellow}[↑/↓]${reset} Scroll  ${yellow}[Space]${reset} Follow  ${yellow}[R]${reset} Format  ${yellow}[Enter]${reset} Action  ${yellow}[?]${reset} Help`
      : `${yellow}[←/→]${reset} Tab/Enter  ${yellow}[↑/↓]${reset} Select  ${yellow}[Enter]${reset} Action  ${yellow}[?]${reset} Help  ${yellow}[Q]${reset} Quit`;
    process.stdout.write(`  ${help}\n`);
  }
  
  private renderLaneList(maxLines: number) {
    const { cyan, reset, dim, gray, green, yellow, red, bgGray } = UI.COLORS;
    
    // Summary
    const flowSummary = getFlowSummary(this.runDir);
    const summary = `${cyan}${flowSummary.running}${reset} running │ ${green}${flowSummary.completed}${reset} done │ ${yellow}${flowSummary.pending || 0}${reset} waiting │ ${red}${flowSummary.failed}${reset} failed`;
    process.stdout.write(`  ${dim}Summary:${reset} ${summary}\n\n`);
    
    if (this.lanes.length === 0) {
      process.stdout.write(`  ${dim}No lanes found. Run ${cyan}cursorflow run${reset}${dim} to start.${reset}\n`);
      return;
    }
    
    // Header
    const maxNameLen = Math.max(12, ...this.lanes.map(l => l.name.length));
    process.stdout.write(`  ${dim}  # │ ${'Lane'.padEnd(maxNameLen)} │ Status      │ Progress │ Duration │ Next${reset}\n`);
    process.stdout.write(`  ${dim}${'─'.repeat(maxNameLen + 60)}${reset}\n`);
    
    // List
    const visibleLanes = this.lanes.slice(0, maxLines - 4);
    visibleLanes.forEach((lane, i) => {
      const isSelected = i === this.state.selectedLaneIndex;
      const status = this.getLaneStatus(lane.path, lane.name);
      const processStatus = this.laneProcessStatuses.get(lane.name);
      
      // Status display
      let displayStatus = status.status;
      let statusIcon = this.getStatusIcon(status.status);
      let statusColor = gray;
      
      if (processStatus?.isStale) {
        displayStatus = 'STALE';
        statusIcon = UI.ICONS.stale;
        statusColor = yellow;
      } else if (processStatus?.actualStatus === 'running') {
        statusColor = cyan;
      } else if (status.status === 'completed') {
        statusColor = green;
      } else if (status.status === 'failed') {
        statusColor = red;
      }
      
      // Progress
      const progressText = `${status.currentTask}/${status.totalTasks}`;
      
      // Duration
      const duration = this.formatDuration(processStatus?.duration || status.duration);
      
      // Next action
      let nextAction = '-';
      if (status.status === 'completed') nextAction = '✓ Done';
      else if (status.status === 'waiting') nextAction = `⏳ ${status.waitingFor?.join(', ') || 'waiting'}`;
      else if (processStatus?.actualStatus === 'running') nextAction = '🚀 working...';
      else if (processStatus?.isStale) nextAction = '⚠️ died';
      
      if (nextAction.length > 20) nextAction = nextAction.substring(0, 17) + '...';
      
      // Render row
      const prefix = isSelected ? `${cyan}▶${reset}` : ' ';
      const bg = isSelected ? bgGray : '';
      const endBg = isSelected ? reset : '';
      const num = String(i + 1).padStart(2);
      
      process.stdout.write(`${bg}  ${prefix} ${num} │ ${lane.name.padEnd(maxNameLen)} │ ${statusColor}${statusIcon} ${displayStatus.padEnd(9)}${reset} │ ${progressText.padEnd(8)} │ ${duration.padEnd(8)} │ ${nextAction}${endBg}\n`);
    });
    
    if (this.lanes.length > visibleLanes.length) {
      process.stdout.write(`  ${dim}  ... and ${this.lanes.length - visibleLanes.length} more${reset}\n`);
    }
  }
  
  private renderFlowList(maxLines: number) {
    const { cyan, reset, dim, gray, green, yellow, red, bgGray } = UI.COLORS;
    
    process.stdout.write(`  ${dim}Total: ${this.allFlows.length} flows${reset}\n\n`);
    
    if (this.allFlows.length === 0) {
      process.stdout.write(`  ${dim}No flows found.${reset}\n`);
      return;
    }
    
    // Header
    process.stdout.write(`  ${dim}  # │ Status │ Run ID                           │ Lanes       │ Progress${reset}\n`);
    process.stdout.write(`  ${dim}${'─'.repeat(80)}${reset}\n`);
    
    // List
    const visibleFlows = this.allFlows.slice(0, maxLines - 4);
    visibleFlows.forEach((flow, i) => {
      const isSelected = i === this.state.selectedFlowIndex;
      const isCurrent = flow.runDir === this.runDir;
      
      // Status
      let statusIcon = '⚪';
      if (flow.isAlive) statusIcon = '🟢';
      else if (flow.summary.completed === flow.summary.total && flow.summary.total > 0) statusIcon = '✅';
      else if (flow.summary.failed > 0) statusIcon = '🔴';
      
      // Lanes
      const lanesSummary = [
        flow.summary.running > 0 ? `${cyan}${flow.summary.running}R${reset}` : '',
        flow.summary.completed > 0 ? `${green}${flow.summary.completed}C${reset}` : '',
        flow.summary.failed > 0 ? `${red}${flow.summary.failed}F${reset}` : '',
      ].filter(Boolean).join('/') || '-';
      
      // Progress bar
      const total = flow.summary.total || 1;
      const ratio = flow.summary.completed / total;
      const barWidth = 10;
      const filled = Math.round(ratio * barWidth);
      const progressBar = `${green}${'█'.repeat(filled)}${reset}${dim}${'░'.repeat(barWidth - filled)}${reset}`;
      const pct = `${Math.round(ratio * 100)}%`;
      
      // Row
      const prefix = isSelected ? `${cyan}▶${reset}` : ' ';
      const bg = isSelected ? bgGray : '';
      const endBg = isSelected ? reset : '';
      const currentTag = isCurrent ? ` ${cyan}●${reset}` : '';
      const num = String(i + 1).padStart(2);
      const runIdDisplay = flow.runId.padEnd(32).substring(0, 32);
      
      process.stdout.write(`${bg}  ${prefix} ${num} │ ${statusIcon}      │ ${runIdDisplay} │ ${lanesSummary.padEnd(11 + 18)} │ ${progressBar} ${pct}${currentTag}${endBg}\n`);
    });
    
    if (this.allFlows.length > visibleFlows.length) {
      process.stdout.write(`  ${dim}  ... and ${this.allFlows.length - visibleFlows.length} more${reset}\n`);
    }
  }
  
  private renderUnifiedLog(maxLines: number) {
    const { cyan, reset, dim, gray, green, yellow } = UI.COLORS;
    
    // Status bar
    const filterLabel = this.state.laneFilter || 'All';
    const followLabel = this.state.unifiedLogFollowMode ? `${green}Follow ON${reset}` : `${yellow}Follow OFF${reset}`;
    const formatLabel = this.state.readableLogFormat ? `${green}Readable${reset}` : `${dim}Compact${reset}`;
    const totalEntries = this.unifiedLogBuffer?.getState().totalEntries || 0;
    
    process.stdout.write(`  ${dim}Filter:${reset} ${cyan}${filterLabel}${reset}  │  ${followLabel}  │  ${yellow}[R]${reset} ${formatLabel}  │  ${dim}Total: ${totalEntries}${reset}\n\n`);
    
    if (!this.unifiedLogBuffer) {
      process.stdout.write(`  ${dim}No log buffer available${reset}\n`);
      return;
    }
    
    const entries = this.unifiedLogBuffer.getEntries({
      offset: this.state.unifiedLogScrollOffset,
      limit: maxLines - 2,
      filter: this.state.laneFilter ? { lane: this.state.laneFilter } : undefined,
      fromEnd: true,
    });
    
    if (entries.length === 0) {
      process.stdout.write(`  ${dim}No log entries${reset}\n`);
      return;
    }
    
    for (const entry of entries) {
      const ts = entry.timestamp.toLocaleTimeString('en-US', { hour12: false });
      const typeInfo = this.getLogTypeInfo(entry.type || 'info');
      
      if (this.state.readableLogFormat) {
        // Readable format: more context, wider lane name
        const lane = entry.laneName.substring(0, 12).padEnd(12);
        const preview = entry.message.replace(/\n/g, ' ').substring(0, this.screenWidth - 45);
        process.stdout.write(`  ${dim}[${ts}]${reset} ${entry.laneColor}[${lane}]${reset} ${typeInfo.color}[${typeInfo.label}]${reset} ${preview}\n`);
      } else {
        // Compact format: shorter, for quick scanning
        const lane = entry.laneName.substring(0, 8).padEnd(8);
        const typeShort = (entry.type || 'info').substring(0, 4).toUpperCase();
        const preview = entry.message.replace(/\n/g, ' ').substring(0, this.screenWidth - 35);
        process.stdout.write(`  ${dim}${ts}${reset} ${entry.laneColor}${lane}${reset} ${typeInfo.color}${typeShort}${reset} ${preview}\n`);
      }
    }
  }
  
  private renderDetail() {
    const w = this.screenWidth;
    const h = this.screenHeight;
    const { cyan, reset, bold, dim, gray, green, yellow, red } = UI.COLORS;
    
    const lane = this.lanes.find(l => l.name === this.state.selectedLaneName);
    if (!lane) {
      this.state.level = Level.DASHBOARD;
      this.render();
      return;
    }
    
    const status = this.getLaneStatus(lane.path, lane.name);
    const processStatus = this.laneProcessStatuses.get(lane.name);
    
    // Header
    const hLine = UI.CHARS.hLine.repeat(w);
    const statusColor = status.status === 'running' ? cyan : status.status === 'completed' ? green : status.status === 'failed' ? red : gray;
    const statusIcon = this.getStatusIcon(status.status);
    
    process.stdout.write(`${cyan}${hLine}${reset}\n`);
    process.stdout.write(`  ${dim}←${reset} back  │  ${bold}🔧 ${lane.name}${reset}  │  ${statusColor}${statusIcon} ${status.status.toUpperCase()}${reset}  │  ${status.currentTask}/${status.totalTasks} tasks  │  ${this.formatDuration(processStatus?.duration || status.duration)}\n`);
    process.stdout.write(`${cyan}${hLine}${reset}\n`);
    
    // Split panel
    const panelWidth = Math.floor((w - 3) / 2);
    const contentHeight = h - 8;
    
    // Panel headers
    const leftActive = this.state.currentPanel === Panel.LEFT;
    const rightActive = this.state.currentPanel === Panel.RIGHT;
    const leftHeader = leftActive ? `${cyan}${UI.ICONS.arrow} Terminal Log${reset}` : `${dim}  Terminal Log${reset}`;
    const rightHeader = rightActive ? `${cyan}${UI.ICONS.arrow} Conversation${reset}` : `${dim}  Conversation${reset}`;
    
    process.stdout.write(`${leftHeader.padEnd(panelWidth + 10)} │ ${rightHeader}\n`);
    process.stdout.write(`${UI.CHARS.hLineLight.repeat(panelWidth)} ${UI.CHARS.tee.top} ${UI.CHARS.hLineLight.repeat(panelWidth)}\n`);
    
    // Get content
    const terminalLines = this.getTerminalLines(lane.path, contentHeight);
    const messageLines = this.getMessageLines(contentHeight);
    
    // Render side by side
    for (let i = 0; i < contentHeight; i++) {
      const termLine = (terminalLines[i] || '').substring(0, panelWidth - 2);
      const msgLine = (messageLines[i] || '').substring(0, panelWidth - 2);
      
      const termPadded = this.padWithAnsi(termLine, panelWidth - 1);
      const msgPadded = this.padWithAnsi(msgLine, panelWidth - 1);
      
      process.stdout.write(`${termPadded} ${dim}│${reset} ${msgPadded}\n`);
    }
    
    // Notification
    if (this.state.notification) {
      const nColor = this.state.notification.type === 'error' ? red 
        : this.state.notification.type === 'success' ? green : cyan;
      process.stdout.write(`${nColor}  🔔 ${this.state.notification.message}${reset}\n`);
    } else {
      process.stdout.write('\n');
    }
    
    // Footer
    process.stdout.write(`${cyan}${hLine}${reset}\n`);
    const followStatus = this.state.followMode ? `${green}ON${reset}` : `${yellow}OFF${reset}`;
    const formatStatus = this.state.readableFormat ? `${green}Readable${reset}` : `${dim}Raw${reset}`;
    process.stdout.write(`  ${yellow}[←]${reset} Back  ${yellow}[→]${reset} Panel  ${yellow}[↑/↓]${reset} Scroll  ${yellow}[Space]${reset} Follow:${followStatus}  ${yellow}[R]${reset} ${formatStatus}  ${yellow}[Enter]${reset} Action  ${yellow}[?]${reset} Help\n`);
  }
  
  private getTerminalLines(lanePath: string, maxLines: number): string[] {
    const { dim, reset, cyan, green, yellow, red, gray } = UI.COLORS;
    
    // Choose log source based on format setting
    if (this.state.readableFormat) {
      // Try JSONL first for structured readable format
      const jsonlPath = safeJoin(lanePath, 'terminal.jsonl');
      if (fs.existsSync(jsonlPath)) {
        return this.getJsonlLogLines(jsonlPath, maxLines);
      }
    }
    
    // Fallback to raw terminal log
    const logPath = safeJoin(lanePath, 'terminal-readable.log');
    if (!fs.existsSync(logPath)) {
      return [`${dim}(No output yet)${reset}`];
    }
    
    try {
      const content = fs.readFileSync(logPath, 'utf8');
      const allLines = content.split('\n');
      const totalLines = allLines.length;
      
      // Calculate visible range (from end, accounting for scroll offset)
      const end = Math.max(0, totalLines - this.state.terminalScrollOffset);
      const start = Math.max(0, end - maxLines);
      const visibleLines = allLines.slice(start, end);
      
      // Format lines with syntax highlighting
      return visibleLines.map(line => {
        if (line.includes('[HUMAN INTERVENTION]') || line.includes('Injecting intervention:')) {
          return `${yellow}${line}${reset}`;
        }
        if (line.includes('=== Task:') || line.includes('Starting task:')) {
          return `${green}${line}${reset}`;
        }
        if (line.includes('Executing cursor-agent') || line.includes('cursor-agent-v')) {
          return `${cyan}${line}${reset}`;
        }
        if (line.toLowerCase().includes('error') || line.toLowerCase().includes('failed')) {
          return `${red}${line}${reset}`;
        }
        if (line.toLowerCase().includes('success') || line.toLowerCase().includes('completed')) {
          return `${green}${line}${reset}`;
        }
        return line;
      });
    } catch {
      return [`${dim}(Error reading log)${reset}`];
    }
  }
  
  /**
   * Get structured log lines from JSONL file
   */
  private getJsonlLogLines(jsonlPath: string, maxLines: number): string[] {
    const { dim, reset, cyan, green, yellow, red, gray } = UI.COLORS;
    
    try {
      const content = fs.readFileSync(jsonlPath, 'utf8');
      const allLines = content.split('\n').filter(l => l.trim());
      const totalLines = allLines.length;
      
      // Calculate visible range
      const end = Math.max(0, totalLines - this.state.terminalScrollOffset);
      const start = Math.max(0, end - maxLines);
      const visibleLines = allLines.slice(start, end);
      
      return visibleLines.map(line => {
        try {
          const entry = JSON.parse(line);
          const ts = new Date(entry.timestamp || Date.now()).toLocaleTimeString('en-US', { hour12: false });
          const type = (entry.type || 'info').toLowerCase();
          const content = (entry.content || entry.message || '').replace(/\n/g, ' ');
          
          const typeInfo = this.getLogTypeInfo(type);
          return `${gray}[${ts}]${reset} ${typeInfo.color}[${typeInfo.label}]${reset} ${content}`;
        } catch {
          return `${gray}${line}${reset}`;
        }
      });
    } catch {
      return [`${dim}(Error reading log)${reset}`];
    }
  }
  
  private getMessageLines(maxLines: number): string[] {
    const { dim, reset, cyan, green, yellow, gray } = UI.COLORS;
    
    if (this.currentLogs.length === 0) {
      return [`${dim}(No messages yet)${reset}`];
    }
    
    const lines: string[] = [];
    const start = this.state.messageScrollOffset;
    const visibleLogs = this.currentLogs.slice(start, start + Math.floor(maxLines / 3));
    
    for (const log of visibleLogs) {
      const roleColor = log.role === 'user' ? yellow : log.role === 'assistant' ? green : cyan;
      const ts = new Date(log.timestamp).toLocaleTimeString('en-US', { hour12: false });
      
      lines.push(`${roleColor}[${ts}] ${log.role.toUpperCase()}${reset}`);
      
      const preview = log.fullText.replace(/\n/g, ' ').substring(0, 60);
      lines.push(`${dim}${preview}...${reset}`);
      lines.push('');
    }
    
    if (this.currentLogs.length > visibleLogs.length + start) {
      lines.push(`${dim}... ${this.currentLogs.length - visibleLogs.length - start} more${reset}`);
    }
    
    return lines;
  }
  
  private renderActionMenu() {
    const { cyan, reset, bold, dim, gray, bgGray, yellow, red } = UI.COLORS;
    
    const menuWidth = 36;
    const menuHeight = this.state.actionItems.length + 4;
    const startX = Math.floor((this.screenWidth - menuWidth) / 2);
    const startY = Math.floor((this.screenHeight - menuHeight) / 2);
    
    // Move cursor and draw menu
    const targetName = this.state.selectedLaneName || 'Item';
    
    // Top border
    process.stdout.write(`\x1b[${startY};${startX}H`);
    process.stdout.write(`${cyan}┌${'─'.repeat(menuWidth - 2)}┐${reset}`);
    
    // Title
    process.stdout.write(`\x1b[${startY + 1};${startX}H`);
    const title = ` 📋 Actions: ${targetName}`.substring(0, menuWidth - 4);
    process.stdout.write(`${cyan}│${reset}${bold}${title.padEnd(menuWidth - 2)}${reset}${cyan}│${reset}`);
    
    // Separator
    process.stdout.write(`\x1b[${startY + 2};${startX}H`);
    process.stdout.write(`${cyan}├${'─'.repeat(menuWidth - 2)}┤${reset}`);
    
    // Items
    this.state.actionItems.forEach((item, i) => {
      process.stdout.write(`\x1b[${startY + 3 + i};${startX}H`);
      const isSelected = i === this.state.selectedActionIndex;
      const prefix = isSelected ? `${cyan}▶${reset}` : ' ';
      const num = `${i + 1}.`;
      const bg = isSelected ? bgGray : '';
      const endBg = isSelected ? reset : '';
      const itemColor = item.disabled ? dim : reset;
      const label = `${item.icon} ${item.label}`;
      
      process.stdout.write(`${cyan}│${reset}${bg} ${prefix} ${num} ${itemColor}${label.padEnd(menuWidth - 9)}${reset}${endBg}${cyan}│${reset}`);
    });
    
    // Bottom border
    process.stdout.write(`\x1b[${startY + 3 + this.state.actionItems.length};${startX}H`);
    process.stdout.write(`${cyan}├${'─'.repeat(menuWidth - 2)}┤${reset}`);
    
    // Help
    process.stdout.write(`\x1b[${startY + 4 + this.state.actionItems.length};${startX}H`);
    process.stdout.write(`${cyan}│${reset}${dim} [↑/↓] Select  [Enter] OK  [Esc] Cancel${reset.padEnd(menuWidth - 41)}${cyan}│${reset}`);
    
    process.stdout.write(`\x1b[${startY + 5 + this.state.actionItems.length};${startX}H`);
    process.stdout.write(`${cyan}└${'─'.repeat(menuWidth - 2)}┘${reset}`);
  }
  
  private renderInputOverlay() {
    const { cyan, reset, bold, dim, yellow } = UI.COLORS;
    
    const boxWidth = Math.min(70, this.screenWidth - 10);
    const startX = Math.floor((this.screenWidth - boxWidth) / 2);
    const startY = this.screenHeight - 6;
    
    const title = this.state.inputMode === 'message' 
      ? `💬 Message to ${this.state.inputTarget}:` 
      : `⏱️ Timeout (ms) for ${this.state.inputTarget}:`;
    const hint = this.state.inputMode === 'timeout' 
      ? 'Presets: 300000 (5m) | 600000 (10m) | 1800000 (30m)'
      : 'Type your message and press Enter';
    
    // Background box
    process.stdout.write(`\x1b[${startY};${startX}H`);
    process.stdout.write(`${cyan}┌${'─'.repeat(boxWidth - 2)}┐${reset}`);
    
    process.stdout.write(`\x1b[${startY + 1};${startX}H`);
    process.stdout.write(`${cyan}│${reset} ${bold}${title.padEnd(boxWidth - 4)}${reset} ${cyan}│${reset}`);
    
    process.stdout.write(`\x1b[${startY + 2};${startX}H`);
    process.stdout.write(`${cyan}│${reset} ${dim}${hint.padEnd(boxWidth - 4)}${reset} ${cyan}│${reset}`);
    
    process.stdout.write(`\x1b[${startY + 3};${startX}H`);
    const inputDisplay = this.state.inputBuffer.substring(0, boxWidth - 6) + '█';
    process.stdout.write(`${cyan}│${reset} ${yellow}${inputDisplay.padEnd(boxWidth - 4)}${reset} ${cyan}│${reset}`);
    
    process.stdout.write(`\x1b[${startY + 4};${startX}H`);
    process.stdout.write(`${cyan}│${reset}${dim} [Enter] Submit  [Esc] Cancel${reset.padEnd(boxWidth - 32)} ${cyan}│${reset}`);
    
    process.stdout.write(`\x1b[${startY + 5};${startX}H`);
    process.stdout.write(`${cyan}└${'─'.repeat(boxWidth - 2)}┘${reset}`);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Utility Methods
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  
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
    };
    return icons[status] || '❓';
  }
  
  private getLogTypeInfo(type: string): { label: string; color: string } {
    const { cyan, green, yellow, gray, red, white, dim, magenta, reset } = UI.COLORS;
    const typeMap: Record<string, { label: string; color: string }> = {
      user: { label: 'USER  ', color: cyan },
      assistant: { label: 'ASST  ', color: green },
      tool: { label: 'TOOL  ', color: yellow },
      tool_result: { label: 'RESULT', color: gray },
      result: { label: 'DONE  ', color: green },
      system: { label: 'SYSTEM', color: gray },
      thinking: { label: 'THINK ', color: dim },
      error: { label: 'ERROR ', color: red },
      stderr: { label: 'STDERR', color: red },
      stdout: { label: 'STDOUT', color: white },
    };
    return typeMap[type] || { label: type.toUpperCase().padEnd(6).substring(0, 6), color: gray };
  }
  
  private padWithAnsi(str: string, width: number): string {
    const visibleLength = stripAnsi(str).length;
    const padding = Math.max(0, width - visibleLength);
    return str + ' '.repeat(padding);
  }
  
  /**
   * Safe string truncation that handles ANSI codes
   */
  private safeSubstring(str: string, maxLen: number): string {
    const stripped = stripAnsi(str);
    if (stripped.length <= maxLen) return str;
    
    // Simple approach: truncate stripped, find corresponding position in original
    let visibleCount = 0;
    let i = 0;
    while (i < str.length && visibleCount < maxLen - 3) {
      // Skip ANSI sequences
      if (str[i] === '\x1b') {
        const match = str.slice(i).match(/^\x1b\[[0-9;]*m/);
        if (match) {
          i += match[0].length;
          continue;
        }
      }
      visibleCount++;
      i++;
    }
    return str.slice(0, i) + '...';
  }
  
  /**
   * Render help overlay
   */
  private renderHelpOverlay() {
    const { cyan, reset, bold, dim, yellow, gray } = UI.COLORS;
    
    const helpWidth = 60;
    const helpHeight = 20;
    const startX = Math.floor((this.screenWidth - helpWidth) / 2);
    const startY = Math.floor((this.screenHeight - helpHeight) / 2);
    
    const helpContent = [
      `${bold}📖 Keyboard Shortcuts${reset}`,
      '',
      `${yellow}Navigation${reset}`,
      `  ←/→     Tab switch / Enter detail / Panel switch`,
      `  ↑/↓     Select item / Scroll content`,
      `  Tab     Quick tab switch`,
      `  Esc     Go back / Close overlay`,
      '',
      `${yellow}Actions${reset}`,
      `  Enter   Open action menu`,
      `  Space   Toggle follow mode (in logs)`,
      `  R       Toggle readable format`,
      `  ?       Show/hide this help`,
      `  Q       Quit`,
      '',
      `${yellow}Action Menu${reset}`,
      `  1-9     Quick select action`,
      `  ↑/↓     Navigate actions`,
      `  Enter   Execute selected action`,
    ];
    
    // Draw box
    process.stdout.write(`\x1b[${startY};${startX}H`);
    process.stdout.write(`${cyan}┌${'─'.repeat(helpWidth - 2)}┐${reset}`);
    
    for (let i = 0; i < helpContent.length; i++) {
      process.stdout.write(`\x1b[${startY + 1 + i};${startX}H`);
      const line = helpContent[i] || '';
      const paddedLine = this.padWithAnsi(line, helpWidth - 4);
      process.stdout.write(`${cyan}│${reset} ${paddedLine} ${cyan}│${reset}`);
    }
    
    // Fill remaining space
    for (let i = helpContent.length; i < helpHeight - 2; i++) {
      process.stdout.write(`\x1b[${startY + 1 + i};${startX}H`);
      process.stdout.write(`${cyan}│${reset}${' '.repeat(helpWidth - 2)}${cyan}│${reset}`);
    }
    
    process.stdout.write(`\x1b[${startY + helpHeight - 1};${startX}H`);
    process.stdout.write(`${cyan}│${reset}${dim} Press ? or Esc to close${reset}${' '.repeat(helpWidth - 27)}${cyan}│${reset}`);
    
    process.stdout.write(`\x1b[${startY + helpHeight};${startX}H`);
    process.stdout.write(`${cyan}└${'─'.repeat(helpWidth - 2)}┘${reset}`);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main Entry Point
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function findLatestRunDir(logsDir: string): string | null {
  const runsDir = safeJoin(logsDir, 'runs');
  if (!fs.existsSync(runsDir)) return null;
  
  const runs = fs.readdirSync(runsDir)
    .filter(d => d.startsWith('run-'))
    .map(d => ({ name: d, path: safeJoin(runsDir, d), mtime: fs.statSync(safeJoin(runsDir, d)).mtime.getTime() }))
    .sort((a, b) => b.mtime - a.mtime);
  
  return runs.length > 0 ? runs[0]!.path : null;
}

async function monitor(args: string[]): Promise<void> {
  const help = args.includes('--help') || args.includes('-h');
  const list = args.includes('--list') || args.includes('-l');
  
  if (help) {
    printHelp();
    return;
  }

  const intervalIdx = args.indexOf('--interval');
  const interval = intervalIdx >= 0 ? parseInt(args[intervalIdx + 1] || '2') || 2 : 2;
  
  const runDirArg = args.find(arg => !arg.startsWith('--') && args.indexOf(arg) !== intervalIdx + 1);
  const originalCwd = process.cwd();
  const config = loadConfig();
  
  let runDir = runDirArg;
  if (runDir && runDir !== 'latest' && !path.isAbsolute(runDir)) {
    runDir = path.resolve(originalCwd, runDir);
  }

  if (!runDir || runDir === 'latest') {
    runDir = findLatestRunDir(getLogsDir(config)) || undefined;
    if (!runDir && !list) throw new Error('No run directories found');
    if (!runDir && list) {
      runDir = path.join(getLogsDir(config), 'runs', 'empty');
    }
  }
  
  if (runDir && !fs.existsSync(runDir) && !list) {
    throw new Error(`Run directory not found: ${runDir}`);
  }
  
  const initialTab = list ? Tab.ALL_FLOWS : Tab.CURRENT_FLOW;
  const mon = new InteractiveMonitor(runDir!, interval, initialTab);
  await mon.start();
}

export = monitor;

/**
 * Interactive Log Viewer
 * 
 * Provides scrollable, filterable, real-time log viewing with:
 * - Free scrolling (up/down, page up/down, home/end)
 * - Auto-scroll toggle (new logs vs. current position)
 * - Lane filtering (tab to cycle, numbers for direct select)
 * - Importance filtering
 * - Text search
 * - Readable format toggle
 */

import * as readline from 'readline';
import * as path from 'path';
import * as logger from '../utils/logger';
import { LogBufferService, BufferedLogEntry } from '../services/logging/buffer';
import { LogImportance } from '../types/logging';
import { formatReadableEntry } from '../services/logging/formatter';

interface LogViewerState {
  scrollOffset: number;           // 현재 스크롤 위치
  autoScroll: boolean;            // 자동 스크롤 ON/OFF
  laneFilter: string | null;      // 레인 필터 (null = 전체)
  importanceFilter: LogImportance | null;  // 중요도 필터
  searchQuery: string | null;     // 검색어
  searchMode: boolean;            // 검색 입력 모드
  searchInput: string;            // 검색 입력 버퍼
  readableFormat: boolean;        // 리더블 포맷 ON/OFF
}

export class LogViewer {
  private runDir: string;
  private runId: string;
  private logBuffer: LogBufferService;
  private state: LogViewerState;
  private pageSize: number;
  private renderInterval: NodeJS.Timeout | null = null;

  constructor(runDir: string) {
    this.runDir = runDir;
    this.runId = path.basename(runDir);
    this.logBuffer = new LogBufferService(runDir);
    
    this.state = {
      scrollOffset: 0,
      autoScroll: true,
      laneFilter: null,
      importanceFilter: null,
      searchQuery: null,
      searchMode: false,
      searchInput: '',
      readableFormat: false,
    };
    
    // 화면 높이 - 헤더/푸터 (6줄)
    this.pageSize = (process.stdout.rows || 24) - 6;
  }

  /**
   * 뷰어 시작
   */
  start(): void {
    // 화면 초기화
    this.setupTerminal();
    
    // 로그 스트리밍 시작
    this.logBuffer.startStreaming();
    
    // 새 로그 이벤트
    this.logBuffer.on('update', () => {
      if (this.state.autoScroll) {
        this.scrollToBottom();
        this.logBuffer.acknowledgeNewEntries();
      }
      this.render();
    });
    
    // 키 입력 처리
    this.setupKeyHandlers();
    
    // 정기적 렌더링 (100ms) - 화면 크기 변화 대응 및 실시간성 유지
    this.renderInterval = setInterval(() => {
      this.render();
    }, 100);
    
    // 초기 렌더링
    this.render();
  }

  /**
   * 뷰어 종료
   */
  stop(): void {
    if (this.renderInterval) {
      clearInterval(this.renderInterval);
    }
    this.logBuffer.stopStreaming();
    this.cleanupTerminal();
  }

  // ─────────────────────────────────────────────────────────────
  // Key Handlers
  // ─────────────────────────────────────────────────────────────

  private setupKeyHandlers(): void {
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    
    process.stdin.on('keypress', (str, key) => {
      if (this.state.searchMode) {
        this.handleSearchKey(str, key);
      } else {
        this.handleNormalKey(str, key);
      }
    });
  }

  private handleNormalKey(str: string | undefined, key: any): void {
    if (!key && !str) return;
    
    const keyName = key?.name;

    // Quit
    if (keyName === 'q' || (key?.ctrl && keyName === 'c')) {
      this.stop();
      process.exit(0);
    }
    
    // Scroll
    if (keyName === 'up' || str === 'k') {
      this.scrollUp(1);
    } else if (keyName === 'down' || str === 'j') {
      this.scrollDown(1);
    } else if (keyName === 'pageup' || (key?.ctrl && keyName === 'u')) {
      this.scrollUp(this.pageSize);
    } else if (keyName === 'pagedown' || (key?.ctrl && keyName === 'd')) {
      this.scrollDown(this.pageSize);
    } else if (keyName === 'home' || str === 'g') {
      this.scrollToTop();
    } else if (keyName === 'end' || str === 'G') {
      this.scrollToBottom();
      this.state.autoScroll = true;
    }
    
    // Auto-scroll toggle
    else if (str === 'a' || str === 'A') {
      this.state.autoScroll = !this.state.autoScroll;
      if (this.state.autoScroll) {
        this.scrollToBottom();
        this.logBuffer.acknowledgeNewEntries();
      }
    }
    
    // Lane filter
    else if (keyName === 'tab') {
      this.cycleLaneFilter();
    } else if (str && str >= '0' && str <= '9') {
      this.selectLaneByNumber(parseInt(str, 10));
    }
    
    // Importance filter
    else if (str === 'f' || str === 'F') {
      this.cycleImportanceFilter();
    }
    
    // Readable format toggle
    else if (str === 'r' || str === 'R') {
      this.state.readableFormat = !this.state.readableFormat;
    }
    
    // Search
    else if (str === '/') {
      this.state.searchMode = true;
      this.state.searchInput = '';
    }
    
    // Clear filters
    else if (keyName === 'escape') {
      this.clearFilters();
    }
    
    this.render();
  }

  private handleSearchKey(str: string | undefined, key: any): void {
    if (!key) return;
    
    if (key.name === 'return') {
      // 검색 실행
      this.state.searchQuery = this.state.searchInput || null;
      this.state.searchMode = false;
      this.state.scrollOffset = 0;
    } else if (key.name === 'escape') {
      // 검색 취소
      this.state.searchMode = false;
      this.state.searchInput = '';
    } else if (key.name === 'backspace') {
      this.state.searchInput = this.state.searchInput.slice(0, -1);
    } else if (str && str.length === 1 && !key.ctrl && !key.meta) {
      this.state.searchInput += str;
    }
    
    this.render();
  }

  // ─────────────────────────────────────────────────────────────
  // Scroll Methods
  // ─────────────────────────────────────────────────────────────

  private scrollUp(lines: number): void {
    this.state.autoScroll = false;
    this.state.scrollOffset = Math.max(0, this.state.scrollOffset - lines);
  }

  private scrollDown(lines: number): void {
    const totalCount = this.getFilteredCount();
    const maxOffset = Math.max(0, totalCount - this.pageSize);
    this.state.scrollOffset = Math.min(maxOffset, this.state.scrollOffset + lines);
    
    // 맨 아래에 도달하면 자동 스크롤 ON
    if (this.state.scrollOffset >= maxOffset) {
      this.state.autoScroll = true;
      this.logBuffer.acknowledgeNewEntries();
    }
  }

  private scrollToTop(): void {
    this.state.autoScroll = false;
    this.state.scrollOffset = 0;
  }

  private scrollToBottom(): void {
    const totalCount = this.getFilteredCount();
    this.state.scrollOffset = Math.max(0, totalCount - this.pageSize);
    this.logBuffer.acknowledgeNewEntries();
  }

  // ─────────────────────────────────────────────────────────────
  // Filter Methods
  // ─────────────────────────────────────────────────────────────

  private cycleLaneFilter(): void {
    const lanes = this.logBuffer.getLanes();
    
    if (!this.state.laneFilter) {
      // null -> first lane
      this.state.laneFilter = lanes[0] || null;
    } else {
      const currentIndex = lanes.indexOf(this.state.laneFilter);
      if (currentIndex === -1 || currentIndex === lanes.length - 1) {
        // last lane or not found -> null (all)
        this.state.laneFilter = null;
      } else {
        this.state.laneFilter = lanes[currentIndex + 1];
      }
    }
    
    this.state.scrollOffset = 0;
    if (this.state.autoScroll) {
      this.scrollToBottom();
    }
  }

  private selectLaneByNumber(num: number): void {
    const lanes = this.logBuffer.getLanes();
    
    if (num === 0) {
      this.state.laneFilter = null;  // All
    } else if (num <= lanes.length) {
      this.state.laneFilter = lanes[num - 1];
    }
    
    this.state.scrollOffset = 0;
    if (this.state.autoScroll) {
      this.scrollToBottom();
    }
  }

  private cycleImportanceFilter(): void {
    const levels: (LogImportance | null)[] = [
      null, 
      LogImportance.CRITICAL, 
      LogImportance.HIGH, 
      LogImportance.MEDIUM, 
      LogImportance.LOW,
      LogImportance.INFO,
      LogImportance.DEBUG
    ];
    const currentIndex = levels.indexOf(this.state.importanceFilter);
    this.state.importanceFilter = levels[(currentIndex + 1) % levels.length];
    this.state.scrollOffset = 0;
    if (this.state.autoScroll) {
      this.scrollToBottom();
    }
  }

  private clearFilters(): void {
    this.state.laneFilter = null;
    this.state.importanceFilter = null;
    this.state.searchQuery = null;
    this.state.scrollOffset = 0;
    if (this.state.autoScroll) {
      this.scrollToBottom();
    }
  }

  private getFilteredCount(): number {
    return this.logBuffer.getTotalCount({
      lane: this.state.laneFilter || undefined,
      importance: this.state.importanceFilter || undefined,
      search: this.state.searchQuery || undefined,
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Rendering
  // ─────────────────────────────────────────────────────────────

  private setupTerminal(): void {
    process.stdout.write('\x1b[?1049h');  // Alternative screen
    process.stdout.write('\x1b[?25l');    // Hide cursor
    console.clear();
  }

  private cleanupTerminal(): void {
    process.stdout.write('\x1b[?25h');    // Show cursor
    process.stdout.write('\x1b[?1049l');  // Restore screen
  }

  private render(): void {
    const { gray, cyan, yellow, reset } = logger.COLORS;
    const width = process.stdout.columns || 80;
    const height = process.stdout.rows || 24;
    this.pageSize = height - 6;
    
    // 데이터 조회
    const entries = this.logBuffer.getEntries({
      offset: this.state.scrollOffset,
      limit: this.pageSize,
      filter: { lane: this.state.laneFilter || undefined, importance: this.state.importanceFilter || undefined, search: this.state.searchQuery || undefined },
    });
    
    const totalCount = this.getFilteredCount();
    const newCount = this.logBuffer.getNewEntriesCount();
    const bufferState = this.logBuffer.getState();
    
    // 출력 버퍼
    let output = '';
    
    // 커서 위치 초기화
    output += '\x1b[H';
    
    // 헤더
    const line = '━'.repeat(width);
    output += `${cyan}${line}${reset}\n`;
    output += `${cyan}📜 Log Viewer - ${this.runId}${reset}`;
    output += ' '.repeat(Math.max(0, width - 30 - this.runId.length));
    output += `${gray}[F] Filter [/] Search${reset}\n`;
    output += `${cyan}${line}${reset}\n`;
    
    // 상태 바
    const laneLabel = this.state.laneFilter || 'All Lanes';
    const filterLabel = this.state.importanceFilter || 'none';
    const autoLabel = this.state.autoScroll ? 'ON' : 'OFF';
    const liveIndicator = bufferState.isStreaming ? '🔴 LIVE' : '⚫ STOPPED';
    
    const readableLabel = this.state.readableFormat ? 'ON' : 'OFF';
    
    output += `View: [${yellow}${laneLabel}${reset}]  `;
    output += `Entries: ${totalCount}  `;
    output += `Filter: ${filterLabel}  `;
    output += `Readable: ${readableLabel}  `;
    output += `${liveIndicator} (Auto-scroll: ${autoLabel})`;
    
    // 새 로그 카운터 (자동 스크롤 OFF 시)
    if (!this.state.autoScroll && newCount > 0) {
      output += `  ${yellow}▼ +${newCount} new${reset}`;
    }
    
    // 우측 정렬을 위한 공백 채우기
    const statusLineLen = stripAnsi(output.split('\n').pop() || '').length;
    output += ' '.repeat(Math.max(0, width - statusLineLen));
    output += '\n';
    
    output += `${cyan}${line}${reset}\n`;
    
    // 로그 라인
    for (let i = 0; i < this.pageSize; i++) {
      const entry = entries[i];
      if (entry) {
        output += this.formatLogEntry(entry, width) + '\x1b[K\n';
      } else {
        output += '\x1b[K\n';
      }
    }
    
    // 검색 모드
    if (this.state.searchMode) {
      output += `${cyan}Search: ${reset}${this.state.searchInput}█\x1b[K\n`;
    } else {
      output += `${cyan}${line}${reset}\x1b[K\n`;
    }
    
    // 푸터
    const footer = `${gray}[↑/↓/PgUp/PgDn] Scroll  [Tab] Lane  [A] Auto-scroll  [F] Filter  [R] Readable  [/] Search  [Q] Quit${reset}`;
    output += footer;
    output += '\x1b[K'; // 현재 라인 끝까지 지우기
    
    // 화면 출력
    process.stdout.write(output);
  }

  private formatLogEntry(entry: BufferedLogEntry, width: number): string {
    const { gray, reset } = logger.COLORS;
    
    // Use readable format if enabled
    if (this.state.readableFormat) {
      const msgType = (entry.type || entry.level) as any;
      return formatReadableEntry(
        entry.timestamp,
        entry.laneName,
        msgType,
        entry.message,
        { showLane: true, maxWidth: width - 30 }
      );
    }
    
    const ts = entry.timestamp.toLocaleTimeString('en-US', { hour12: false });
    const lanePad = entry.laneName.substring(0, 12).padEnd(12);
    const levelPad = entry.level.toUpperCase().padEnd(6);
    const levelColor = this.getLevelColor(entry.level);
    
    // 메시지 길이 제한 (ANSI 코드 제외한 실제 너비 고려)
    const prefix = `[${ts}] [${lanePad}] [${levelPad}] `;
    const prefixLen = prefix.length;
    const maxMsgLen = Math.max(20, width - prefixLen);
    
    // ANSI 코드 제거 후 길이 계산
    const cleanMsg = stripAnsi(entry.message);
    const msg = cleanMsg.length > maxMsgLen 
      ? cleanMsg.substring(0, maxMsgLen - 3) + '...'
      : entry.message; // 원본 메시지 사용 (색상 유지 위해)
    
    return `${gray}[${ts}]${reset} ${entry.laneColor}[${lanePad}]${reset} ${levelColor}[${levelPad}]${reset} ${msg}`;
  }

  private getLevelColor(level: string): string {
    const colors: Record<string, string> = {
      error: '\x1b[31m',   // red
      stderr: '\x1b[31m',  // red
      warn: '\x1b[33m',    // yellow
      warning: '\x1b[33m', // yellow
      info: '\x1b[36m',    // cyan
      stdout: '\x1b[37m',  // white
      tool: '\x1b[35m',    // magenta
      result: '\x1b[32m',  // green
      debug: '\x1b[90m',   // gray
    };
    return colors[level.toLowerCase()] || '\x1b[37m';
  }
}

/**
 * ANSI 코드 제거 유틸리티
 */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * LogViewer 실행 함수 (CLI 진입점)
 */
export async function startLogViewer(runDir: string): Promise<void> {
  const viewer = new LogViewer(runDir);
  
  // 종료 핸들러
  process.on('SIGINT', () => {
    viewer.stop();
    process.exit(0);
  });
  
  viewer.start();
}

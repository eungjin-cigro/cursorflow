/**
 * CursorFlow UI Components
 * 
 * Reusable terminal UI components for interactive screens.
 */

import * as readline from 'readline';
import * as logger from '../utils/logger';

/**
 * 상태 아이콘 유틸리티
 */
export const StatusIcons = {
  running: '🔄',
  completed: '✅',
  done: '✅',
  failed: '❌',
  partial: '⚠️',
  pending: '⏳',
  valid: '✅',
  errors: '❌',
  warnings: '⚠️',
} as const;

export function getStatusIcon(status: string): string {
  return StatusIcons[status as keyof typeof StatusIcons] || '❓';
}

/**
 * ANSI 코드 제거
 */
export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * 문자열 패딩 (ANSI 코드 고려)
 */
export function pad(str: string, width: number, align: 'left' | 'right' | 'center' = 'left'): string {
  const visibleLength = stripAnsi(str).length;
  const padding = Math.max(0, width - visibleLength);
  
  switch (align) {
    case 'right':
      return ' '.repeat(padding) + str;
    case 'center':
      const left = Math.floor(padding / 2);
      const right = padding - left;
      return ' '.repeat(left) + str + ' '.repeat(right);
    default:
      return str + ' '.repeat(padding);
  }
}

/**
 * 프로그레스 바 렌더링
 */
export function renderProgressBar(current: number, total: number, width: number = 20): string {
  const ratio = total > 0 ? current / total : 0;
  const filled = Math.min(width, Math.round(ratio * width));
  const empty = width - filled;
  
  const bar = `${'█'.repeat(filled)}${'░'.repeat(empty)}`;
  const percent = `${Math.round(ratio * 100)}%`.padStart(4);
  
  return `[${bar}] ${percent}`;
}

/**
 * 확인 다이얼로그
 */
export async function confirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(`${message} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * 알림 표시
 */
export interface Notification {
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
  time: number;
}

export function renderNotification(notification: Notification | null): string {
  if (!notification) return '';
  
  const colors: Record<Notification['type'], string> = {
    info: logger.COLORS.cyan,
    success: logger.COLORS.green,
    error: logger.COLORS.red,
    warning: logger.COLORS.yellow,
  };

  const icons: Record<Notification['type'], string> = {
    info: 'ℹ️',
    success: '✅',
    error: '❌',
    warning: '⚠️',
  };

  return `${colors[notification.type]}${icons[notification.type]} ${notification.message}${logger.COLORS.reset}`;
}

/**
 * 키 도움말 바
 */
export function renderKeyHelp(keys: { key: string; action: string }[]): string {
  const parts = keys.map(k => `[${k.key}] ${k.action}`);
  return `${logger.COLORS.gray}${parts.join('  ')}${logger.COLORS.reset}`;
}

/**
 * 헤더 렌더링
 */
export function renderHeader(title: string, subtitle?: string): string[] {
  const lines: string[] = [
    `${logger.COLORS.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${logger.COLORS.reset}`,
    `${logger.COLORS.cyan}  ${title}${logger.COLORS.reset}`,
  ];
  
  if (subtitle) {
    lines.push(`${logger.COLORS.gray}  ${subtitle}${logger.COLORS.reset}`);
  }
  
  lines.push(`${logger.COLORS.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${logger.COLORS.reset}`);
  
  return lines;
}

/**
 * 기본 인터랙티브 화면 클래스
 */
export abstract class InteractiveScreen {
  protected notification: Notification | null = null;
  protected running: boolean = false;

  start(): void {
    this.running = true;
    this.setupTerminal();
    this.render();
  }

  stop(): void {
    this.running = false;
    this.restoreTerminal();
  }

  abstract render(): void;
  abstract handleKey(key: string, keyInfo?: any): void;

  protected setupTerminal(): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    readline.emitKeypressEvents(process.stdin);
    process.stdin.on('keypress', this.keypressHandler);
    this.hideCursor();
  }

  protected restoreTerminal(): void {
    process.stdin.removeListener('keypress', this.keypressHandler);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    this.showCursor();
  }

  private keypressHandler = (str: string, key: any) => {
    if (key && key.ctrl && key.name === 'c') {
      this.stop();
      process.exit(0);
    }
    this.handleKey(key ? key.name : str, key);
  };

  protected showNotification(message: string, type: Notification['type']): void {
    this.notification = { message, type, time: Date.now() };
  }

  protected clearOldNotification(): void {
    if (this.notification && Date.now() - this.notification.time > 3000) {
      this.notification = null;
    }
  }

  protected clearScreen(): void {
    process.stdout.write('\x1Bc');
  }

  protected hideCursor(): void {
    process.stdout.write('\x1B[?25l');
  }

  protected showCursor(): void {
    process.stdout.write('\x1B[?25h');
  }
}

/**
 * 선택 가능한 리스트 컴포넌트
 */
export class SelectableList<T> {
  items: T[];
  selectedIndex: number = 0;
  private formatter: (item: T, selected: boolean) => string;
  private maxVisible: number;
  private scrollOffset: number = 0;

  constructor(
    items: T[],
    formatter: (item: T, selected: boolean) => string,
    maxVisible: number = 15
  ) {
    this.items = items;
    this.formatter = formatter;
    this.maxVisible = maxVisible;
  }

  moveUp(): void {
    this.selectedIndex = Math.max(0, this.selectedIndex - 1);
    this.adjustScroll();
  }

  moveDown(): void {
    this.selectedIndex = Math.min(this.items.length - 1, this.selectedIndex + 1);
    this.adjustScroll();
  }

  private adjustScroll(): void {
    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollOffset + this.maxVisible) {
      this.scrollOffset = this.selectedIndex - this.maxVisible + 1;
    }
  }

  getSelected(): T | undefined {
    return this.items[this.selectedIndex];
  }

  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  setItems(items: T[]): void {
    this.items = items;
    if (this.selectedIndex >= items.length) {
      this.selectedIndex = Math.max(0, items.length - 1);
    }
    this.adjustScroll();
  }

  render(): string[] {
    const visibleItems = this.items.slice(
      this.scrollOffset,
      this.scrollOffset + this.maxVisible
    );
    
    const lines = visibleItems.map((item, i) => {
      const actualIndex = i + this.scrollOffset;
      const isSelected = actualIndex === this.selectedIndex;
      return this.formatter(item, isSelected);
    });

    // 스크롤 표시
    if (this.scrollOffset > 0) {
      lines.unshift(`  ${logger.COLORS.gray}↑ ${this.scrollOffset} more...${logger.COLORS.reset}`);
    }
    
    const remaining = this.items.length - this.scrollOffset - this.maxVisible;
    if (remaining > 0) {
      lines.push(`  ${logger.COLORS.gray}↓ ${remaining} more...${logger.COLORS.reset}`);
    }

    return lines;
  }
}

/**
 * 체크박스 리스트 컴포넌트
 */
export class CheckboxList<T> {
  items: T[];
  checked: Set<number> = new Set();
  selectedIndex: number = 0;
  private formatter: (item: T, isSelected: boolean, isChecked: boolean) => string;
  private maxVisible: number;
  private scrollOffset: number = 0;

  constructor(
    items: T[],
    formatter: (item: T, isSelected: boolean, isChecked: boolean) => string,
    maxVisible: number = 15
  ) {
    this.items = items;
    this.formatter = formatter;
    this.maxVisible = maxVisible;
  }

  moveUp(): void {
    this.selectedIndex = Math.max(0, this.selectedIndex - 1);
    this.adjustScroll();
  }

  moveDown(): void {
    this.selectedIndex = Math.min(this.items.length - 1, this.selectedIndex + 1);
    this.adjustScroll();
  }

  private adjustScroll(): void {
    if (this.selectedIndex < this.scrollOffset) {
      this.scrollOffset = this.selectedIndex;
    } else if (this.selectedIndex >= this.scrollOffset + this.maxVisible) {
      this.scrollOffset = this.selectedIndex - this.maxVisible + 1;
    }
  }

  toggle(): void {
    if (this.checked.has(this.selectedIndex)) {
      this.checked.delete(this.selectedIndex);
    } else {
      this.checked.add(this.selectedIndex);
    }
  }

  selectAll(): void {
    for (let i = 0; i < this.items.length; i++) {
      this.checked.add(i);
    }
  }

  deselectAll(): void {
    this.checked.clear();
  }

  getChecked(): T[] {
    return this.items.filter((_, i) => this.checked.has(i));
  }

  render(): string[] {
    const visibleItems = this.items.slice(
      this.scrollOffset,
      this.scrollOffset + this.maxVisible
    );
    
    const lines = visibleItems.map((item, i) => {
      const actualIndex = i + this.scrollOffset;
      const isSelected = actualIndex === this.selectedIndex;
      const isChecked = this.checked.has(actualIndex);
      return this.formatter(item, isSelected, isChecked);
    });

    if (this.scrollOffset > 0) {
      lines.unshift(`  ${logger.COLORS.gray}↑ ${this.scrollOffset} more...${logger.COLORS.reset}`);
    }
    
    const remaining = this.items.length - this.scrollOffset - this.maxVisible;
    if (remaining > 0) {
      lines.push(`  ${logger.COLORS.gray}↓ ${remaining} more...${logger.COLORS.reset}`);
    }

    return lines;
  }
}

/**
 * 스크롤 가능 버퍼 컴포넌트
 */
export class ScrollableBuffer<T> {
  private items: T[] = [];
  private scrollOffset: number = 0;
  private pageSize: number;

  constructor(pageSize: number = 20) {
    this.pageSize = pageSize;
  }

  setItems(items: T[]): void {
    this.items = items;
    // Adjust scroll offset if it goes beyond new items
    const maxOffset = Math.max(0, this.items.length - this.pageSize);
    if (this.scrollOffset > maxOffset) {
      this.scrollOffset = maxOffset;
    }
  }

  scrollUp(lines: number = 1): void {
    this.scrollOffset = Math.max(0, this.scrollOffset - lines);
  }

  scrollDown(lines: number = 1): void {
    const maxOffset = Math.max(0, this.items.length - this.pageSize);
    this.scrollOffset = Math.min(maxOffset, this.scrollOffset + lines);
  }

  scrollToTop(): void {
    this.scrollOffset = 0;
  }

  scrollToBottom(): void {
    this.scrollOffset = Math.max(0, this.items.length - this.pageSize);
  }

  getVisibleItems(): T[] {
    return this.items.slice(this.scrollOffset, this.scrollOffset + this.pageSize);
  }

  getTotalCount(): number {
    return this.items.length;
  }

  getScrollInfo(): { offset: number; total: number; pageSize: number } {
    return {
      offset: this.scrollOffset,
      total: this.items.length,
      pageSize: this.pageSize
    };
  }
}

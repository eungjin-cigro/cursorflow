# Phase 8: UI 컴포넌트화

## 목표

터미널 UI 요소를 재사용 가능한 컴포넌트로 분리하여 일관된 사용자 경험을 제공합니다.

## 현재 상태

### 파일 분석

| 파일 | 라인 | 역할 |
|------|------|------|
| `ui/dashboard.ts` | 397 | 대시보드 렌더링 |
| `ui/log-viewer.ts` | 508 | 로그 뷰어 |

### 문제점
1. UI 요소가 파일마다 중복 구현
2. 스타일(색상, 아이콘)이 하드코딩
3. 터미널 사이즈 대응 로직 분산
4. 재사용 불가능한 구조

## 목표 구조

```
src/ui/
├── index.ts              # 공개 API
├── components/           # 재사용 가능한 컴포넌트
│   ├── box.ts            # 테두리 박스
│   ├── spinner.ts        # 로딩 스피너
│   ├── progress.ts       # 진행 바
│   ├── table.ts          # 테이블
│   └── status.ts         # 상태 배지
│
├── layouts/              # 레이아웃 컴포넌트
│   ├── split.ts          # 분할 뷰
│   └── scroll.ts         # 스크롤 영역
│
├── screens/              # 전체 화면 UI
│   ├── dashboard.ts      # 대시보드 화면
│   └── log-viewer.ts     # 로그 뷰어 화면
│
└── utils/                # UI 유틸리티
    ├── terminal.ts       # 터미널 사이즈, 커서
    ├── ansi.ts           # ANSI 코드
    └── theme.ts          # 색상 테마
```

### 예상 파일 크기

| 파일 | 예상 라인 | 책임 |
|------|----------|------|
| `components/box.ts` | ~60 | 테두리 박스 |
| `components/spinner.ts` | ~40 | 로딩 스피너 |
| `components/progress.ts` | ~50 | 진행 바 |
| `components/table.ts` | ~80 | 테이블 |
| `components/status.ts` | ~40 | 상태 배지 |
| `utils/terminal.ts` | ~50 | 터미널 유틸 |
| `utils/ansi.ts` | ~30 | ANSI 유틸 |
| `utils/theme.ts` | ~40 | 테마 |
| `screens/dashboard.ts` | ~200 | 대시보드 |
| `screens/log-viewer.ts` | ~250 | 로그 뷰어 |
| **총계** | **~840** | 기존 905줄 대비 7% 감소 |

## 상세 작업

### 1. `ui/utils/theme.ts`

```typescript
// src/ui/utils/theme.ts

export const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',

  // Background
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
} as const;

export const ICONS = {
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
  running: '🔄',
  pending: '⏳',
  paused: '⏸️',
  debug: '🔍',
  user: '🧑',
  assistant: '🤖',
  tool: '🔧',
} as const;

export interface Theme {
  colors: {
    primary: string;
    secondary: string;
    success: string;
    error: string;
    warning: string;
    info: string;
    muted: string;
  };
  border: {
    topLeft: string;
    topRight: string;
    bottomLeft: string;
    bottomRight: string;
    horizontal: string;
    vertical: string;
  };
}

export const defaultTheme: Theme = {
  colors: {
    primary: COLORS.cyan,
    secondary: COLORS.magenta,
    success: COLORS.green,
    error: COLORS.red,
    warning: COLORS.yellow,
    info: COLORS.blue,
    muted: COLORS.gray,
  },
  border: {
    topLeft: '┌',
    topRight: '┐',
    bottomLeft: '└',
    bottomRight: '┘',
    horizontal: '─',
    vertical: '│',
  },
};

let currentTheme = defaultTheme;

export function setTheme(theme: Partial<Theme>): void {
  currentTheme = { ...defaultTheme, ...theme };
}

export function getTheme(): Theme {
  return currentTheme;
}
```

### 2. `ui/utils/terminal.ts`

```typescript
// src/ui/utils/terminal.ts

import * as readline from 'readline';

export interface TerminalSize {
  rows: number;
  cols: number;
}

/**
 * Get terminal size
 */
export function getTerminalSize(): TerminalSize {
  return {
    rows: process.stdout.rows || 24,
    cols: process.stdout.columns || 80,
  };
}

/**
 * Clear screen
 */
export function clearScreen(): void {
  process.stdout.write('\x1b[2J\x1b[H');
}

/**
 * Move cursor to position
 */
export function moveCursor(row: number, col: number): void {
  process.stdout.write(`\x1b[${row};${col}H`);
}

/**
 * Hide cursor
 */
export function hideCursor(): void {
  process.stdout.write('\x1b[?25l');
}

/**
 * Show cursor
 */
export function showCursor(): void {
  process.stdout.write('\x1b[?25h');
}

/**
 * Clear line from cursor
 */
export function clearLine(): void {
  process.stdout.write('\x1b[K');
}

/**
 * Listen for terminal resize
 */
export function onResize(callback: (size: TerminalSize) => void): () => void {
  const handler = () => callback(getTerminalSize());
  process.stdout.on('resize', handler);
  return () => process.stdout.off('resize', handler);
}

/**
 * Listen for keypresses
 */
export function onKeypress(callback: (key: string, ctrl: boolean) => void): () => void {
  readline.emitKeypressEvents(process.stdin);

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  const handler = (str: string, key: any) => {
    callback(key?.name || str, key?.ctrl || false);
  };

  process.stdin.on('keypress', handler);

  return () => {
    process.stdin.off('keypress', handler);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
  };
}

/**
 * Truncate string to fit width
 */
export function truncate(str: string, maxWidth: number, suffix = '...'): string {
  const stripped = stripAnsi(str);
  if (stripped.length <= maxWidth) return str;
  return stripped.substring(0, maxWidth - suffix.length) + suffix;
}

/**
 * Strip ANSI codes from string
 */
export function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}
```

### 3. `ui/utils/ansi.ts`

```typescript
// src/ui/utils/ansi.ts

import { COLORS } from './theme';

/**
 * Apply color to text
 */
export function color(text: string, colorCode: string): string {
  return `${colorCode}${text}${COLORS.reset}`;
}

/**
 * Make text bold
 */
export function bold(text: string): string {
  return `${COLORS.bold}${text}${COLORS.reset}`;
}

/**
 * Make text dim
 */
export function dim(text: string): string {
  return `${COLORS.dim}${text}${COLORS.reset}`;
}

/**
 * Pad string with ANSI-awareness
 */
export function pad(str: string, width: number, align: 'left' | 'right' | 'center' = 'left'): string {
  const stripped = str.replace(/\x1b\[[0-9;]*m/g, '');
  const padding = Math.max(0, width - stripped.length);

  if (align === 'right') {
    return ' '.repeat(padding) + str;
  } else if (align === 'center') {
    const left = Math.floor(padding / 2);
    const right = padding - left;
    return ' '.repeat(left) + str + ' '.repeat(right);
  }

  return str + ' '.repeat(padding);
}
```

### 4. `ui/components/box.ts`

```typescript
// src/ui/components/box.ts

import { getTheme, COLORS } from '../utils/theme';
import { getTerminalSize, truncate, stripAnsi } from '../utils/terminal';

interface BoxOptions {
  title?: string;
  width?: number | 'auto' | 'full';
  padding?: number;
  borderColor?: string;
}

/**
 * Render content in a bordered box
 */
export function box(content: string | string[], options: BoxOptions = {}): string {
  const theme = getTheme();
  const { title, width = 'auto', padding = 1, borderColor = theme.colors.primary } = options;
  const { border } = theme;

  const lines = Array.isArray(content) ? content : content.split('\n');
  const termWidth = getTerminalSize().cols;

  // Calculate box width
  let boxWidth: number;
  if (width === 'full') {
    boxWidth = termWidth - 2;
  } else if (width === 'auto') {
    boxWidth = Math.min(
      termWidth - 2,
      Math.max(...lines.map(l => stripAnsi(l).length)) + padding * 2 + 2
    );
  } else {
    boxWidth = width;
  }

  const innerWidth = boxWidth - 2 - padding * 2;
  const pad = ' '.repeat(padding);

  // Build output
  const output: string[] = [];

  // Top border with optional title
  let topBorder = border.topLeft + border.horizontal.repeat(boxWidth - 2) + border.topRight;
  if (title) {
    const titleStr = ` ${title} `;
    const titlePos = 2;
    topBorder = border.topLeft +
      border.horizontal.repeat(titlePos) +
      titleStr +
      border.horizontal.repeat(boxWidth - 2 - titlePos - titleStr.length) +
      border.topRight;
  }
  output.push(`${borderColor}${topBorder}${COLORS.reset}`);

  // Content lines
  for (const line of lines) {
    const truncated = truncate(line, innerWidth);
    const stripped = stripAnsi(truncated);
    const rightPad = ' '.repeat(innerWidth - stripped.length);
    output.push(
      `${borderColor}${border.vertical}${COLORS.reset}` +
      `${pad}${truncated}${rightPad}${pad}` +
      `${borderColor}${border.vertical}${COLORS.reset}`
    );
  }

  // Bottom border
  output.push(`${borderColor}${border.bottomLeft}${border.horizontal.repeat(boxWidth - 2)}${border.bottomRight}${COLORS.reset}`);

  return output.join('\n');
}
```

### 5. `ui/components/progress.ts`

```typescript
// src/ui/components/progress.ts

import { COLORS, getTheme } from '../utils/theme';

interface ProgressBarOptions {
  width?: number;
  showPercent?: boolean;
  showCount?: boolean;
  filledChar?: string;
  emptyChar?: string;
  filledColor?: string;
  emptyColor?: string;
}

/**
 * Render a progress bar
 */
export function progressBar(
  current: number,
  total: number,
  options: ProgressBarOptions = {}
): string {
  const theme = getTheme();
  const {
    width = 20,
    showPercent = true,
    showCount = false,
    filledChar = '█',
    emptyChar = '░',
    filledColor = theme.colors.success,
    emptyColor = theme.colors.muted,
  } = options;

  const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;

  let bar = `${filledColor}${filledChar.repeat(filled)}${COLORS.reset}`;
  bar += `${emptyColor}${emptyChar.repeat(empty)}${COLORS.reset}`;

  const parts: string[] = [`[${bar}]`];

  if (showPercent) {
    parts.push(`${percent}%`);
  }

  if (showCount) {
    parts.push(`${current}/${total}`);
  }

  return parts.join(' ');
}

/**
 * Render a spinner frame
 */
export function spinner(frame: number): string {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  return frames[frame % frames.length]!;
}

/**
 * Create an animated spinner
 */
export function createSpinner(message: string): { start: () => void; stop: (success?: boolean) => void } {
  let frame = 0;
  let interval: NodeJS.Timeout | null = null;

  return {
    start: () => {
      interval = setInterval(() => {
        process.stdout.write(`\r${spinner(frame++)} ${message}`);
      }, 80);
    },
    stop: (success = true) => {
      if (interval) clearInterval(interval);
      const icon = success ? '✅' : '❌';
      process.stdout.write(`\r${icon} ${message}\n`);
    },
  };
}
```

### 6. `ui/components/status.ts`

```typescript
// src/ui/components/status.ts

import { COLORS, ICONS, getTheme } from '../utils/theme';

type Status = 'success' | 'error' | 'warning' | 'info' | 'running' | 'pending' | 'paused';

/**
 * Render a status badge
 */
export function statusBadge(status: Status, text?: string): string {
  const theme = getTheme();
  const label = text || status;

  const config: Record<Status, { icon: string; color: string }> = {
    success: { icon: ICONS.success, color: theme.colors.success },
    error: { icon: ICONS.error, color: theme.colors.error },
    warning: { icon: ICONS.warning, color: theme.colors.warning },
    info: { icon: ICONS.info, color: theme.colors.info },
    running: { icon: ICONS.running, color: theme.colors.primary },
    pending: { icon: ICONS.pending, color: theme.colors.muted },
    paused: { icon: ICONS.paused, color: theme.colors.warning },
  };

  const { icon, color } = config[status];
  return `${icon} ${color}${label}${COLORS.reset}`;
}

/**
 * Render lane status indicator
 */
export function laneStatus(
  name: string,
  status: Status,
  progress?: { current: number; total: number }
): string {
  const badge = statusBadge(status);
  const progressStr = progress ? ` [${progress.current}/${progress.total}]` : '';
  return `${name}: ${badge}${progressStr}`;
}
```

### 7. `ui/components/table.ts`

```typescript
// src/ui/components/table.ts

import { COLORS, getTheme } from '../utils/theme';
import { stripAnsi } from '../utils/terminal';
import { pad } from '../utils/ansi';

interface Column<T> {
  header: string;
  key: keyof T;
  width?: number;
  align?: 'left' | 'right' | 'center';
  format?: (value: any, row: T) => string;
}

interface TableOptions {
  border?: boolean;
  headerColor?: string;
  compact?: boolean;
}

/**
 * Render a table
 */
export function table<T>(
  data: T[],
  columns: Column<T>[],
  options: TableOptions = {}
): string {
  const theme = getTheme();
  const { border = false, headerColor = theme.colors.primary, compact = false } = options;

  // Calculate column widths
  const widths = columns.map(col => {
    const headerWidth = col.header.length;
    const maxDataWidth = Math.max(
      0,
      ...data.map(row => {
        const value = row[col.key];
        const formatted = col.format ? col.format(value, row) : String(value ?? '');
        return stripAnsi(formatted).length;
      })
    );
    return col.width || Math.max(headerWidth, maxDataWidth);
  });

  const separator = compact ? '  ' : '   ';
  const lines: string[] = [];

  // Header
  const header = columns.map((col, i) => {
    return `${headerColor}${pad(col.header, widths[i]!, col.align || 'left')}${COLORS.reset}`;
  }).join(separator);
  lines.push(header);

  // Separator line
  if (border) {
    lines.push(widths.map(w => '─'.repeat(w)).join(compact ? '──' : '───'));
  }

  // Data rows
  for (const row of data) {
    const line = columns.map((col, i) => {
      const value = row[col.key];
      const formatted = col.format ? col.format(value, row) : String(value ?? '');
      return pad(formatted, widths[i]!, col.align || 'left');
    }).join(separator);
    lines.push(line);
  }

  return lines.join('\n');
}
```

### 8. `ui/screens/dashboard.ts`

```typescript
// src/ui/screens/dashboard.ts

import { box } from '../components/box';
import { progressBar } from '../components/progress';
import { statusBadge, laneStatus } from '../components/status';
import { table } from '../components/table';
import { clearScreen, hideCursor, showCursor, getTerminalSize, onResize, onKeypress } from '../utils/terminal';
import { COLORS, getTheme } from '../utils/theme';
import type { LaneState } from '../../types';

interface DashboardOptions {
  refreshInterval?: number;
}

export class Dashboard {
  private lanes: LaneState[] = [];
  private interval: NodeJS.Timeout | null = null;
  private cleanupResize: (() => void) | null = null;
  private cleanupKeypress: (() => void) | null = null;

  constructor(private options: DashboardOptions = {}) {}

  start(): void {
    hideCursor();
    this.cleanupResize = onResize(() => this.render());
    this.cleanupKeypress = onKeypress((key, ctrl) => {
      if (key === 'q' || (ctrl && key === 'c')) {
        this.stop();
        process.exit(0);
      }
    });

    this.interval = setInterval(() => this.render(), this.options.refreshInterval || 1000);
    this.render();
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    if (this.cleanupResize) this.cleanupResize();
    if (this.cleanupKeypress) this.cleanupKeypress();
    showCursor();
  }

  update(lanes: LaneState[]): void {
    this.lanes = lanes;
  }

  private render(): void {
    clearScreen();

    const { cols } = getTerminalSize();
    const theme = getTheme();

    // Title
    console.log(box('CursorFlow Dashboard', { width: cols - 2, borderColor: theme.colors.primary }));
    console.log('');

    // Summary
    const completed = this.lanes.filter(l => l.status === 'completed').length;
    const running = this.lanes.filter(l => l.status === 'running').length;
    const failed = this.lanes.filter(l => l.status === 'failed').length;

    console.log(`${statusBadge('success', `${completed} Completed`)}  ${statusBadge('running', `${running} Running`)}  ${statusBadge('error', `${failed} Failed`)}`);
    console.log('');

    // Progress
    const total = this.lanes.length;
    console.log(`Overall: ${progressBar(completed, total, { width: 30, showPercent: true, showCount: true })}`);
    console.log('');

    // Lane table
    const tableData = this.lanes.map(lane => ({
      name: lane.label,
      status: lane.status,
      progress: `${lane.currentTaskIndex}/${lane.totalTasks}`,
      branch: lane.pipelineBranch || '-',
    }));

    console.log(table(tableData, [
      { header: 'Lane', key: 'name', width: 20 },
      { header: 'Status', key: 'status', width: 12, format: (v) => statusBadge(v as any) },
      { header: 'Progress', key: 'progress', width: 10 },
      { header: 'Branch', key: 'branch' },
    ], { border: true }));

    console.log('');
    console.log(`${COLORS.gray}Press 'q' to quit${COLORS.reset}`);
  }
}
```

### 9. `ui/index.ts`

```typescript
// src/ui/index.ts

// Theme
export { COLORS, ICONS, setTheme, getTheme } from './utils/theme';

// Terminal utilities
export { getTerminalSize, clearScreen, hideCursor, showCursor, truncate, stripAnsi } from './utils/terminal';

// Components
export { box } from './components/box';
export { progressBar, spinner, createSpinner } from './components/progress';
export { statusBadge, laneStatus } from './components/status';
export { table } from './components/table';

// Screens
export { Dashboard } from './screens/dashboard';
export { LogViewer } from './screens/log-viewer';
```

## 마이그레이션 가이드

### Before
```typescript
// 각 파일에서 중복 구현
const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
// ...
```

### After
```typescript
import { spinner, progressBar, box, statusBadge } from '../ui';

console.log(box('Title', { width: 50 }));
console.log(progressBar(5, 10, { showPercent: true }));
console.log(statusBadge('running', 'Processing...'));
```

## 테스트 계획

1. **컴포넌트 스냅샷 테스트**
   - 각 컴포넌트 출력 확인

2. **터미널 사이즈 테스트**
   - 다양한 사이즈에서 렌더링

## 체크리스트

- [ ] `ui/utils/` 디렉토리 생성
- [ ] `ui/components/` 디렉토리 생성
- [ ] `ui/screens/` 디렉토리 생성
- [ ] `theme.ts` 작성
- [ ] `terminal.ts` 작성
- [ ] `ansi.ts` 작성
- [ ] `box.ts` 작성
- [ ] `progress.ts` 작성
- [ ] `status.ts` 작성
- [ ] `table.ts` 작성
- [ ] `dashboard.ts` 리팩토링
- [ ] `log-viewer.ts` 리팩토링
- [ ] `index.ts` 업데이트
- [ ] 테스트 실행


import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { safeJoin } from './path';
import { JsonLogEntry } from './enhanced-logger';
import { LogService, MergedLogEntry } from './log-service';
import { LogImportance } from './types';

export interface BufferedLogEntry {
  id: number;                    // 순차 ID (스크롤 위치용)
  timestamp: Date;
  laneName: string;
  level: string;
  message: string;
  importance: LogImportance;
  laneColor: string;
  raw: JsonLogEntry;             // 원본 데이터
}

export interface LogBufferOptions {
  maxEntries?: number;           // 최대 버퍼 크기 (기본: 10000)
  pollInterval?: number;         // 폴링 간격 ms (기본: 100)
}

export interface LogViewport {
  offset: number;                // 시작 위치 (0 = 맨 위)
  limit: number;                 // 가져올 개수 (화면 높이)
  laneFilter?: string;           // 특정 레인만 (null/undefined = 전체)
  importanceFilter?: LogImportance; // 최소 중요도
  searchQuery?: string;          // 텍스트 검색
}

export interface LogBufferState {
  totalEntries: number;          // 전체 버퍼 크기
  filteredCount: number;         // 필터 적용 후 개수
  newCount: number;              // 마지막 acknowledgeNewEntries() 이후 새 로그 수
  isStreaming: boolean;          // 실시간 스트리밍 중 여부
  lanes: string[];               // 발견된 레인 목록
}

export class LogBufferService extends EventEmitter {
  private runDir: string;
  private options: Required<LogBufferOptions>;
  private buffer: BufferedLogEntry[] = [];
  private nextId: number = 0;
  private lastPositions: Map<string, number> = new Map();
  private laneColors: Map<string, string> = new Map();
  private lanes: Set<string> = new Set();
  private streamingInterval: NodeJS.Timeout | null = null;
  private acknowledgedCount: number = 0;

  constructor(runDir: string, options?: LogBufferOptions) {
    super();
    this.runDir = runDir;
    this.options = {
      maxEntries: options?.maxEntries ?? 10000,
      pollInterval: options?.pollInterval ?? 100,
    };
  }

  /**
   * 실시간 스트리밍 시작
   * - 100ms 간격으로 새 로그 폴링
   * - 새 로그 발견 시 'update' 이벤트 발생
   */
  startStreaming(): void {
    if (this.streamingInterval) return;
    
    // 초기 로드
    this.loadInitialLogs();
    
    // 폴링 시작
    this.streamingInterval = setInterval(() => {
      const newEntries = this.pollNewEntries();
      if (newEntries.length > 0) {
        this.emit('update', newEntries);
      }
    }, this.options.pollInterval);
  }

  /**
   * 스트리밍 중지
   */
  stopStreaming(): void {
    if (this.streamingInterval) {
      clearInterval(this.streamingInterval);
      this.streamingInterval = null;
    }
  }

  /**
   * 뷰포트에 해당하는 로그 조회
   * @param viewport 뷰포트 설정 (오프셋, 개수, 필터)
   * @returns 필터링된 로그 엔트리 배열
   */
  getEntries(viewport: LogViewport): BufferedLogEntry[] {
    let filtered = this.getFilteredBuffer(viewport);
    
    // 뷰포트 적용
    return filtered.slice(viewport.offset, viewport.offset + viewport.limit);
  }

  /**
   * 전체 개수 (필터 적용 후)
   */
  getTotalCount(filter?: { lane?: string; importance?: LogImportance; search?: string }): number {
    const viewport: LogViewport = {
      offset: 0,
      limit: Number.MAX_SAFE_INTEGER,
      laneFilter: filter?.lane,
      importanceFilter: filter?.importance,
      searchQuery: filter?.search
    };
    
    return this.getFilteredBuffer(viewport).length;
  }

  /**
   * 마지막 확인 이후 새 로그 개수 (자동 스크롤 OFF 시 표시용)
   */
  getNewEntriesCount(): number {
    return this.buffer.length - this.acknowledgedCount;
  }

  /**
   * 새 로그 확인 완료 - 카운터 리셋
   */
  acknowledgeNewEntries(): void {
    this.acknowledgedCount = this.buffer.length;
  }

  /**
   * 레인 목록 조회
   */
  getLanes(): string[] {
    return Array.from(this.lanes);
  }

  /**
   * 현재 상태 조회
   */
  getState(): LogBufferState {
    return {
      totalEntries: this.buffer.length,
      filteredCount: this.buffer.length,  // 기본값, getEntries 사용 권장
      newCount: this.getNewEntriesCount(),
      isStreaming: this.streamingInterval !== null,
      lanes: this.getLanes(),
    };
  }

  /**
   * 특정 레인 색상 조회
   */
  getLaneColor(laneName: string): string {
    return this.laneColors.get(laneName) || '\x1b[37m';  // 기본 흰색
  }

  // ─────────────────────────────────────────────────────────────
  // Private Methods
  // ─────────────────────────────────────────────────────────────

  private getFilteredBuffer(viewport: LogViewport): BufferedLogEntry[] {
    let filtered = this.buffer;
    
    // 레인 필터
    if (viewport.laneFilter) {
      filtered = filtered.filter(e => e.laneName === viewport.laneFilter);
    }
    
    // 중요도 필터
    if (viewport.importanceFilter) {
      filtered = filtered.filter(e => 
        LogService.meetsImportanceLevel(e.raw, viewport.importanceFilter!)
      );
    }
    
    // 검색 필터
    if (viewport.searchQuery) {
      const query = viewport.searchQuery.toLowerCase();
      filtered = filtered.filter(e => 
        e.message.toLowerCase().includes(query) ||
        e.laneName.toLowerCase().includes(query)
      );
    }
    
    return filtered;
  }

  private loadInitialLogs(): void {
    const lanesDir = safeJoin(this.runDir, 'lanes');
    if (!fs.existsSync(lanesDir)) return;

    const laneDirs = fs.readdirSync(lanesDir)
      .filter(d => fs.statSync(safeJoin(lanesDir, d)).isDirectory());

    const colors = [
      '\x1b[34m', // blue
      '\x1b[33m', // yellow  
      '\x1b[35m', // magenta
      '\x1b[36m', // cyan
      '\x1b[32m', // green
      '\x1b[91m', // bright red
    ];

    laneDirs.forEach((lane, index) => {
      this.lanes.add(lane);
      this.laneColors.set(lane, colors[index % colors.length]!);
      this.lastPositions.set(lane, 0);
      
      // 기존 로그 로드
      const jsonLogPath = safeJoin(lanesDir, lane, 'terminal.jsonl');
      if (fs.existsSync(jsonLogPath)) {
        this.loadLogsFromFile(lane, jsonLogPath);
      }
    });

    // 버퍼 크기 제한
    this.trimBuffer();
  }

  private loadLogsFromFile(laneName: string, jsonLogPath: string): void {
    try {
      const stats = fs.statSync(jsonLogPath);
      const content = fs.readFileSync(jsonLogPath, 'utf8');
      const lines = content.split('\n').filter(l => l.trim());
      
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as JsonLogEntry;
          this.addEntry(laneName, entry);
        } catch {
          // Skip invalid lines
        }
      }
      
      this.lastPositions.set(laneName, stats.size);
    } catch {
      // Ignore errors
    }
  }

  private pollNewEntries(): BufferedLogEntry[] {
    const newEntries: BufferedLogEntry[] = [];
    const lanesDir = safeJoin(this.runDir, 'lanes');
    
    if (!fs.existsSync(lanesDir)) return newEntries;

    // Check for new lanes
    const currentLaneDirs = fs.readdirSync(lanesDir)
      .filter(d => fs.statSync(safeJoin(lanesDir, d)).isDirectory());
    
    for (const lane of currentLaneDirs) {
      if (!this.lanes.has(lane)) {
        this.lanes.add(lane);
        const colors = [
          '\x1b[34m', '\x1b[33m', '\x1b[35m', '\x1b[36m', '\x1b[32m', '\x1b[91m'
        ];
        this.laneColors.set(lane, colors[this.lanes.size % colors.length]!);
        this.lastPositions.set(lane, 0);
      }
    }

    for (const lane of this.lanes) {
      const jsonLogPath = safeJoin(lanesDir, lane, 'terminal.jsonl');
      if (!fs.existsSync(jsonLogPath)) continue;

      const lastPos = this.lastPositions.get(lane) || 0;
      
      try {
        const stats = fs.statSync(jsonLogPath);
        if (stats.size > lastPos) {
          const fd = fs.openSync(jsonLogPath, 'r');
          const bufferSize = stats.size - lastPos;
          const readBuffer = Buffer.alloc(bufferSize);
          fs.readSync(fd, readBuffer, 0, bufferSize, lastPos);
          fs.closeSync(fd);
          
          const content = readBuffer.toString();
          const lines = content.split('\n').filter(l => l.trim());
          
          for (const line of lines) {
            try {
              const entry = JSON.parse(line) as JsonLogEntry;
              const buffered = this.addEntry(lane, entry);
              newEntries.push(buffered);
            } catch {
              // Skip invalid lines
            }
          }
          
          this.lastPositions.set(lane, stats.size);
        }
      } catch {
        // Ignore errors
      }
    }

    // 버퍼 크기 제한
    if (newEntries.length > 0) {
      this.trimBuffer();
    }

    return newEntries;
  }

  private addEntry(laneName: string, raw: JsonLogEntry): BufferedLogEntry {
    const buffered: BufferedLogEntry = {
      id: this.nextId++,
      timestamp: new Date(raw.timestamp),
      laneName,
      level: raw.level,
      message: raw.message,
      importance: LogService.getLogImportance(raw),
      laneColor: this.getLaneColor(laneName),
      raw,
    };
    
    this.buffer.push(buffered);
    return buffered;
  }

  private trimBuffer(): void {
    if (this.buffer.length > this.options.maxEntries) {
      const excess = this.buffer.length - this.options.maxEntries;
      this.buffer.splice(0, excess);
      
      // acknowledgedCount 조정
      this.acknowledgedCount = Math.max(0, this.acknowledgedCount - excess);
    }
  }
}

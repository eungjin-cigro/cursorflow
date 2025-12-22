/**
 * Tests for LogBufferService utility
 */

import * as fs from 'fs';
import * as path from 'path';
import { LogBufferService, LogViewport } from '../../src/utils/log-buffer';
import { LogImportance } from '../../src/utils/types';
import { JsonLogEntry } from '../../src/utils/enhanced-logger';

describe('LogBufferService', () => {
  const testRunDir = path.join(__dirname, 'test-run');
  const lane1Dir = path.join(testRunDir, 'lanes', 'lane-1');
  const lane2Dir = path.join(testRunDir, 'lanes', 'lane-2');

  const createLogEntry = (msg: string, level: any = 'stdout', timestamp?: string): JsonLogEntry => ({
    timestamp: timestamp || new Date().toISOString(),
    level,
    message: msg,
  });

  const writeLogEntry = (laneDir: string, entry: JsonLogEntry) => {
    if (!fs.existsSync(laneDir)) {
      fs.mkdirSync(laneDir, { recursive: true });
    }
    fs.appendFileSync(path.join(laneDir, 'terminal.jsonl'), JSON.stringify(entry) + '\n');
  };

  beforeEach(() => {
    // Clean up test directory
    if (fs.existsSync(testRunDir)) {
      fs.rmSync(testRunDir, { recursive: true });
    }
    fs.mkdirSync(lane1Dir, { recursive: true });
    fs.mkdirSync(lane2Dir, { recursive: true });
  });

  afterEach(() => {
    // Clean up
    if (fs.existsSync(testRunDir)) {
      fs.rmSync(testRunDir, { recursive: true });
    }
  });

  it('should load initial logs from files', () => {
    const entry1 = createLogEntry('Lane 1 initial');
    const entry2 = createLogEntry('Lane 2 initial');
    writeLogEntry(lane1Dir, entry1);
    writeLogEntry(lane2Dir, entry2);

    const service = new LogBufferService(testRunDir);
    // Force initial load by starting streaming or just getting entries if implemented to load on init
    // According to implementation, loadInitialLogs is called in startStreaming
    service.startStreaming();
    
    const entries = service.getEntries({ offset: 0, limit: 10 });
    expect(entries).toHaveLength(2);
    expect(entries.some(e => e.message === 'Lane 1 initial')).toBe(true);
    expect(entries.some(e => e.message === 'Lane 2 initial')).toBe(true);
    
    service.stopStreaming();
  });

  it('should stream new logs', (done) => {
    const service = new LogBufferService(testRunDir, { pollInterval: 50 });
    service.startStreaming();

    service.once('update', (newEntries) => {
      expect(newEntries).toHaveLength(1);
      expect(newEntries[0].message).toBe('New streaming log');
      
      const allEntries = service.getEntries({ offset: 0, limit: 10 });
      expect(allEntries.some(e => e.message === 'New streaming log')).toBe(true);
      
      service.stopStreaming();
      done();
    });

    const entry = createLogEntry('New streaming log');
    writeLogEntry(lane1Dir, entry);
  });

  it('should filter entries by lane', () => {
    writeLogEntry(lane1Dir, createLogEntry('L1 Log'));
    writeLogEntry(lane2Dir, createLogEntry('L2 Log'));

    const service = new LogBufferService(testRunDir);
    service.startStreaming();

    const lane1Entries = service.getEntries({ offset: 0, limit: 10, laneFilter: 'lane-1' });
    expect(lane1Entries).toHaveLength(1);
    expect(lane1Entries[0].laneName).toBe('lane-1');
    expect(lane1Entries[0].message).toBe('L1 Log');

    const lane2Entries = service.getEntries({ offset: 0, limit: 10, laneFilter: 'lane-2' });
    expect(lane2Entries).toHaveLength(1);
    expect(lane2Entries[0].laneName).toBe('lane-2');
    expect(lane2Entries[0].message).toBe('L2 Log');

    service.stopStreaming();
  });

  it('should respect viewport offset and limit', () => {
    for (let i = 0; i < 10; i++) {
      writeLogEntry(lane1Dir, createLogEntry(`Log ${i}`));
    }

    const service = new LogBufferService(testRunDir);
    service.startStreaming();

    const viewport: LogViewport = { offset: 2, limit: 3 };
    const entries = service.getEntries(viewport);

    expect(entries).toHaveLength(3);
    expect(entries[0].message).toBe('Log 2');
    expect(entries[1].message).toBe('Log 3');
    expect(entries[2].message).toBe('Log 4');

    service.stopStreaming();
  });

  it('should track new entries and acknowledge them', (done) => {
    writeLogEntry(lane1Dir, createLogEntry('Old Log'));
    const service = new LogBufferService(testRunDir, { pollInterval: 50 });
    service.startStreaming();
    
    // Initial entries don't count as "new" after acknowledge
    setTimeout(() => {
      service.acknowledgeNewEntries();
      expect(service.getNewEntriesCount()).toBe(0);

      writeLogEntry(lane1Dir, createLogEntry('New Log 1'));
      writeLogEntry(lane1Dir, createLogEntry('New Log 2'));

      // Wait for poll
      setTimeout(() => {
        try {
          expect(service.getNewEntriesCount()).toBe(2);
          service.acknowledgeNewEntries();
          expect(service.getNewEntriesCount()).toBe(0);
          service.stopStreaming();
          done();
        } catch (error) {
          service.stopStreaming();
          done(error);
        }
      }, 150);
    }, 150);
  });

  it('should respect maxEntries limit', () => {
    const maxEntries = 5;
    const service = new LogBufferService(testRunDir, { maxEntries });
    
    for (let i = 0; i < 10; i++) {
      writeLogEntry(lane1Dir, createLogEntry(`Log ${i}`));
    }

    service.startStreaming();
    
    const state = service.getState();
    expect(state.totalEntries).toBe(maxEntries);
    
    const entries = service.getEntries({ offset: 0, limit: 10 });
    expect(entries[0].message).toBe('Log 5');
    expect(entries[4].message).toBe('Log 9');

    service.stopStreaming();
  });

  it('should filter by importance', () => {
    writeLogEntry(lane1Dir, createLogEntry('Info Log', 'stdout'));
    writeLogEntry(lane1Dir, createLogEntry('Error Log', 'error'));

    const service = new LogBufferService(testRunDir);
    service.startStreaming();

    const criticalEntries = service.getEntries({ 
      offset: 0, 
      limit: 10, 
      importanceFilter: LogImportance.CRITICAL 
    });
    
    expect(criticalEntries).toHaveLength(1);
    expect(criticalEntries[0].message).toBe('Error Log');

    const allEntries = service.getEntries({ 
      offset: 0, 
      limit: 10, 
      importanceFilter: LogImportance.DEBUG 
    });
    expect(allEntries).toHaveLength(2);

    service.stopStreaming();
  });

  it('should filter by search query', () => {
    writeLogEntry(lane1Dir, createLogEntry('Needle in a haystack'));
    writeLogEntry(lane1Dir, createLogEntry('Just some grass'));

    const service = new LogBufferService(testRunDir);
    service.startStreaming();

    const searchResults = service.getEntries({ 
      offset: 0, 
      limit: 10, 
      searchQuery: 'needle' 
    });
    
    expect(searchResults).toHaveLength(1);
    expect(searchResults[0].message).toBe('Needle in a haystack');

    service.stopStreaming();
  });
});

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
    if (fs.existsSync(testRunDir)) {
      fs.rmSync(testRunDir, { recursive: true });
    }
    fs.mkdirSync(lane1Dir, { recursive: true });
    fs.mkdirSync(lane2Dir, { recursive: true });
  });

  afterEach(() => {
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

    const lane1Entries = service.getEntries({ offset: 0, limit: 10, filter: { lane: 'lane-1' } });
    expect(lane1Entries).toHaveLength(1);
    expect(lane1Entries[0].laneName).toBe('lane-1');
    expect(lane1Entries[0].message).toBe('L1 Log');

    const lane2Entries = service.getEntries({ offset: 0, limit: 10, filter: { lane: 'lane-2' } });
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

    const entries = service.getEntries({ offset: 2, limit: 3 });
    expect(entries).toHaveLength(3);

    service.stopStreaming();
  });

  it('should track new entries and acknowledge them', (done) => {
    writeLogEntry(lane1Dir, createLogEntry('Old Log'));
    const service = new LogBufferService(testRunDir, { pollInterval: 50 });
    service.startStreaming();
    
    setTimeout(() => {
      service.acknowledgeNewEntries();
      expect(service.getNewEntriesCount()).toBe(0);

      writeLogEntry(lane1Dir, createLogEntry('New Log 1'));
      writeLogEntry(lane1Dir, createLogEntry('New Log 2'));

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

    service.stopStreaming();
  });

  it.skip('should filter by importance', () => {
    writeLogEntry(lane1Dir, createLogEntry('Info Log', 'stdout'));
    writeLogEntry(lane1Dir, createLogEntry('Error Log', 'error'));

    const service = new LogBufferService(testRunDir);
    service.startStreaming();

    const criticalEntries = service.getEntries({ 
      offset: 0, 
      limit: 10, 
      filter: { importance: LogImportance.CRITICAL }
    });
    
    expect(criticalEntries).toHaveLength(1);
    expect(criticalEntries[0].message).toBe('Error Log');

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
      filter: { search: 'needle' }
    });
    
    expect(searchResults).toHaveLength(1);
    expect(searchResults[0].message).toBe('Needle in a haystack');

    service.stopStreaming();
  });
});

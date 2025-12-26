import { events } from '../../src/utils/events';

describe('Events Utility', () => {
  beforeEach(() => {
    // Clear all listeners before each test
    events.removeAllListeners();
  });

  test('should emit specific event and match payload', (done) => {
    const payload = { foo: 'bar' };
    const runId = 'test-run-id';
    
    events.on('test.event', (event) => {
      expect(event.type).toBe('test.event');
      expect(event.payload).toEqual(payload);
      expect(event.runId).toBe(runId);
      expect(event.timestamp).toBeDefined();
      expect(event.id).toBeDefined();
      done();
    });

    events.emit('test.event', payload, runId);
  });

  test('should support category wildcards', (done) => {
    let callCount = 0;
    const runId = 'test-run-id';
    
    events.on('task.*', () => {
      callCount++;
      if (callCount === 2) done();
    });

    events.emit('task.started', { name: 'task1' }, runId);
    events.emit('task.completed', { name: 'task1' }, runId);
  });

  test('should support catch-all wildcard', (done) => {
    const runId = 'test-run-id';
    events.on('*', (event) => {
      expect(event.type).toBe('any.event');
      expect(event.runId).toBe(runId);
      done();
    });

    events.emit('any.event', {}, runId);
  });

  test('should support async handlers', async () => {
    let resolved = false;
    const runId = 'test-run-id';
    
    events.on('async.event', async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      resolved = true;
    });

    events.emit('async.event', {}, runId);
    
    // Give it a moment to run the async handler
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(resolved).toBe(true);
  });
});


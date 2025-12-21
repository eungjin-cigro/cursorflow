import { events } from '../../src/utils/events';

describe('Events Utility', () => {
  beforeEach(() => {
    // Clear all listeners before each test
    events.removeAllListeners();
    events.setRunId('test-run-id');
  });

  test('should emit specific event and match payload', (done) => {
    const payload = { foo: 'bar' };
    
    events.on('test.event', (event) => {
      expect(event.type).toBe('test.event');
      expect(event.payload).toEqual(payload);
      expect(event.runId).toBe('test-run-id');
      expect(event.timestamp).toBeDefined();
      expect(event.id).toBeDefined();
      done();
    });

    events.emit('test.event', payload);
  });

  test('should support category wildcards', (done) => {
    let callCount = 0;
    
    events.on('task.*', () => {
      callCount++;
      if (callCount === 2) done();
    });

    events.emit('task.started', { name: 'task1' });
    events.emit('task.completed', { name: 'task1' });
  });

  test('should support catch-all wildcard', (done) => {
    events.on('*', (event) => {
      expect(event.type).toBe('any.event');
      done();
    });

    events.emit('any.event', {});
  });

  test('should support async handlers', async () => {
    let resolved = false;
    
    events.on('async.event', async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      resolved = true;
    });

    events.emit('async.event', {});
    
    // Give it a moment to run the async handler
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(resolved).toBe(true);
  });
});


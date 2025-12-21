import { events } from '../../src/utils/events';
import { registerWebhooks } from '../../src/utils/webhook';
import * as crypto from 'crypto';

describe('Webhook Utility', () => {
  let mockFetch: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    events.removeAllListeners();
    mockFetch = jest.fn().mockImplementation(() => Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK'
    }));
    global.fetch = mockFetch;
  });

  afterEach(() => {
    events.removeAllListeners();
  });

  test('should register webhooks and send POST requests', async () => {
    const webhooks = [
      {
        enabled: true,
        url: 'https://example.com/webhook',
        events: ['test.event']
      }
    ];

    registerWebhooks(webhooks);
    events.emit('test.event', { data: 'hello' });

    // Wait for async webhook delivery
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/webhook',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json'
        }),
        body: expect.stringContaining('"data":"hello"')
      })
    );
  });

  test('should include HMAC signature when secret is provided', async () => {
    const secret = 'top-secret';
    const webhooks = [
      {
        enabled: true,
        url: 'https://example.com/webhook',
        secret,
        events: ['test.event']
      }
    ];

    registerWebhooks(webhooks);
    events.emit('test.event', { data: 'hello' });

    await new Promise(resolve => setTimeout(resolve, 100));

    const lastCall = mockFetch.mock.calls[0];
    const headers = lastCall[1].headers;
    const body = lastCall[1].body;

    expect(headers['X-CursorFlow-Signature']).toBeDefined();
    
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');
    
    expect(headers['X-CursorFlow-Signature']).toBe(`sha256=${expectedSignature}`);
  });

  test('should respect enabled: false', async () => {
    const webhooks = [
      {
        enabled: false,
        url: 'https://example.com/webhook',
        events: ['*']
      }
    ];

    registerWebhooks(webhooks);
    events.emit('test.event', {});

    await new Promise(resolve => setTimeout(resolve, 100));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('should retry on failure', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const webhooks = [
      {
        enabled: true,
        url: 'https://example.com/webhook-retry',
        retries: 1,
        events: ['retry.event']
      }
    ];

    registerWebhooks(webhooks);
    
    jest.useFakeTimers();
    
    // Trigger event
    events.emit('retry.event', {});
    
    // First attempt happens in a promise microtask
    await Promise.resolve(); 
    await Promise.resolve(); 
    
    // Advance timers for retry (2s delay)
    jest.advanceTimersByTime(3000);
    
    // Second attempt happens after timer
    await Promise.resolve();
    await Promise.resolve();
    
    expect(mockFetch).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });
});


import * as crypto from 'crypto';
import { events } from './events';
import { WebhookConfig, CursorFlowEvent } from './types';
import * as logger from './logger';

/**
 * Register webhooks from configuration
 */
export function registerWebhooks(configs: WebhookConfig[]) {
  if (!configs || !Array.isArray(configs)) return;

  for (const config of configs) {
    if (config.enabled === false) continue;

    const patterns = config.events || ['*'];

    for (const pattern of patterns) {
      events.on(pattern, async (event) => {
        try {
          await sendWebhook(config, event);
        } catch (error: any) {
          logger.error(`Webhook failed for ${config.url}: ${error.message}`);
        }
      });
    }
  }
}

/**
 * Send webhook with retry logic and HMAC signature
 */
async function sendWebhook(config: WebhookConfig, event: CursorFlowEvent) {
  const payload = JSON.stringify(event);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'CursorFlow-Orchestrator',
    ...config.headers,
  };

  // Add HMAC signature if secret is provided
  if (config.secret) {
    const signature = crypto
      .createHmac('sha256', config.secret)
      .update(payload)
      .digest('hex');
    headers['X-CursorFlow-Signature'] = `sha256=${signature}`;
  }

  const retries = config.retries ?? 3;
  const timeoutMs = config.timeoutMs ?? 10000;

  let lastError: any;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      // SECURITY NOTE: Intentionally sending event data to configured webhook URLs.
      // This is the expected behavior - users explicitly configure webhook endpoints
      // to receive CursorFlow events. The data is JSON-serialized event metadata.
      const response = await fetch(config.url, {
        method: 'POST',
        headers,
        body: payload,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return;
      }

      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    } catch (error: any) {
      lastError = error;
      
      if (attempt <= retries) {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}


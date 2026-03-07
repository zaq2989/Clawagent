/**
 * Webhook notification service with exponential backoff retry.
 */

'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500; // 500ms, 1s, 2s

/**
 * Send a single HTTP POST with JSON payload.
 * @returns {Promise<{status: number, body: string}>}
 */
function httpPost(urlStr, payload, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(urlStr); } catch (e) { return reject(new Error(`Invalid webhook URL: ${urlStr}`)); }

    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    const body = JSON.stringify(payload);

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'ClawAgent-Webhook/1.0',
        'X-ClawAgent-Event': payload.event || 'webhook',
      },
      timeout: timeoutMs,
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Webhook request timed out'));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Send a webhook with retry + exponential backoff.
 *
 * @param {string} webhookUrl  - Target URL
 * @param {object} payload     - JSON body to POST
 * @param {number} [maxRetries=3]
 * @returns {Promise<{ok: boolean, status?: number, attempts: number, error?: string}>}
 */
async function sendWebhook(webhookUrl, payload, maxRetries = MAX_RETRIES) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const { status } = await httpPost(webhookUrl, payload);
      if (status >= 200 && status < 300) {
        return { ok: true, status, attempts: attempt };
      }
      lastError = new Error(`Webhook returned HTTP ${status}`);
    } catch (err) {
      lastError = err;
    }

    if (attempt < maxRetries) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.warn(`[Webhook] Attempt ${attempt}/${maxRetries} failed: ${lastError.message}. Retrying in ${delay}ms…`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  console.error(`[Webhook] All ${maxRetries} attempts failed for ${webhookUrl}: ${lastError.message}`);
  return { ok: false, attempts: maxRetries, error: lastError.message };
}

/**
 * Notify a webhook about a task event (fire-and-forget, logs errors).
 *
 * @param {string|null} webhookUrl
 * @param {string}      event       - 'task_assigned' | 'task_completed' | 'task_failed' | 'test'
 * @param {object}      data        - Payload data
 */
function notifyWebhook(webhookUrl, event, data) {
  if (!webhookUrl) return;

  const payload = {
    event,
    timestamp: new Date().toISOString(),
    ...data,
  };

  // Fire-and-forget: don't await, just log result
  sendWebhook(webhookUrl, payload)
    .then(result => {
      if (!result.ok) {
        console.error(`[Webhook] ${event} notification failed after ${result.attempts} attempts: ${result.error}`);
      } else {
        console.log(`[Webhook] ${event} delivered (attempt ${result.attempts})`);
      }
    })
    .catch(err => console.error('[Webhook] Unexpected error:', err));
}

module.exports = { sendWebhook, notifyWebhook };

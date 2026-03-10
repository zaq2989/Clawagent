/**
 * Webhooks router
 * POST /api/webhooks/test — send a test webhook to the authenticated agent's webhook_url
 */

'use strict';

const express = require('express');
const { body, validationResult } = require('express-validator');
const { getDb } = require('../db');
const { sendWebhook } = require('../webhook');
const { apiKeyAuth } = require('../middleware/auth');
const { checkSafeUrl } = require('../utils/ssrf');

const router = express.Router();

// POST /api/webhooks/test  (auth required)
router.post('/test', apiKeyAuth, [
  body('webhook_url').optional().isURL().withMessage('webhook_url must be a valid URL'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ ok: false, errors: errors.array() });

  const db = getDb();
  const agent = db.prepare('SELECT id, name, webhook_url FROM agents WHERE id = ?').get(req.agentId);
  if (!agent) return res.status(404).json({ ok: false, error: 'Agent not found' });

  // Use body-provided URL or fall back to agent's registered webhook_url
  const targetUrl = req.body.webhook_url || agent.webhook_url;
  if (!targetUrl) {
    return res.status(400).json({ ok: false, error: 'No webhook_url configured. Provide one in the request body or register your agent with a webhook_url.' });
  }

  // SSRF guard: validate the target URL before sending
  const ssrfCheck = checkSafeUrl(targetUrl);
  if (!ssrfCheck.safe) {
    return res.status(400).json({ ok: false, error: `webhook_url rejected: ${ssrfCheck.reason}` });
  }

  const payload = {
    event: 'test',
    timestamp: new Date().toISOString(),
    agent_id: agent.id,
    agent_name: agent.name,
    message: 'ClawAgent webhook test — connection successful!',
  };

  try {
    const result = await sendWebhook(targetUrl, payload);
    if (result.ok) {
      return res.json({ ok: true, status: result.status, attempts: result.attempts, webhook_url: targetUrl });
    } else {
      return res.status(502).json({ ok: false, error: result.error, attempts: result.attempts, webhook_url: targetUrl });
    }
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;

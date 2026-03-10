const crypto = require('crypto');
const { getDb } = require('../db');

function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function apiKeyAuth(req, res, next) {
  // x402 payment counts as authentication — skip API key check
  if (req.headers['x-payment']) {
    req.agentId = 'x402-payer';
    req.apiKey = null;
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'Authorization header required (Bearer <api_key>)' });
  }

  const apiKey = authHeader.slice(7);
  const hashedKey = hashKey(apiKey);
  const db = getDb();
  const agent = db.prepare('SELECT id, status FROM agents WHERE api_key = ?').get(hashedKey);

  if (!agent) {
    return res.status(401).json({ ok: false, error: 'Invalid API key' });
  }

  if (agent.status === 'banned') {
    return res.status(403).json({ ok: false, error: 'Agent is banned' });
  }

  req.agentId = agent.id;
  req.apiKey = apiKey;
  next();
}

module.exports = { apiKeyAuth };

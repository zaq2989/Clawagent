const express = require('express');
const crypto = require('crypto');
const uuidv4 = () => require('crypto').randomUUID();
const { body, validationResult } = require('express-validator');
const { getDb } = require('../db');

const router = express.Router();

const registerValidation = [
  body('name').isString().trim().notEmpty().withMessage('Name is required'),
  body('type').optional().isIn(['ai', 'human']).withMessage('type must be ai or human'),
  body('capabilities').optional().isArray().withMessage('capabilities must be an array'),
  body('bond_amount').optional().isFloat({ min: 0 }).withMessage('bond_amount must be a non-negative number'),
  body('webhook_url').optional().isURL().withMessage('webhook_url must be a valid URL'),
  body('pricing').optional().isObject().withMessage('pricing must be an object'),
  body('input_schema').optional().isObject().withMessage('input_schema must be an object'),
  body('output_schema').optional().isObject().withMessage('output_schema must be an object'),
];

// POST /api/agents/register
router.post('/register', registerValidation, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ ok: false, errors: errors.array() });

  const db = getDb();
  const { name, type, capabilities, bond_amount, webhook_url, pricing, input_schema, output_schema } = req.body;

  const id = uuidv4();
  const apiKey = uuidv4();
  const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');
  const now = Date.now();
  db.prepare(`INSERT INTO agents (id, name, type, capabilities, api_key, bond_amount, webhook_url, pricing, input_schema, output_schema, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      id, name, type || 'ai',
      JSON.stringify(capabilities || []),
      hashedKey,
      bond_amount || 0,
      webhook_url || null,
      JSON.stringify(pricing || {}),
      JSON.stringify(input_schema || {}),
      JSON.stringify(output_schema || {}),
      now
    );

  // Return plaintext key only once; it cannot be retrieved again
  res.json({ ok: true, agent: { id, name, api_key: apiKey, status: 'active', created_at: now } });
});

// GET /api/agents — public, no auth required; never exposes api_key or other private fields
// Optional query param: ?capability=<name> to filter by capability
router.get('/', (req, res) => {
  const db = getDb();
  const { capability } = req.query;
  const rows = db.prepare(
    'SELECT id, name, type, capabilities, pricing, input_schema, output_schema, reputation_score, success_rate, latency_ms, call_count, bond_amount, tasks_completed, tasks_failed, status, created_at FROM agents ORDER BY reputation_score DESC'
  ).all();
  const agents = rows
    .filter(a => {
      if (!capability) return true;
      let caps = [];
      try { caps = JSON.parse(a.capabilities || '[]'); } catch (_) {}
      return Array.isArray(caps) && caps.includes(capability);
    })
    .map(a => ({
    id: a.id,
    name: a.name,
    type: a.type,
    capabilities:    JSON.parse(a.capabilities  || '[]'),
    pricing:         JSON.parse(a.pricing        || '{}'),
    input_schema:    JSON.parse(a.input_schema   || '{}'),
    output_schema:   JSON.parse(a.output_schema  || '{}'),
    reputation_score: a.reputation_score,
    success_rate:    a.success_rate,
    latency_ms:      a.latency_ms,
    call_count:      a.call_count,
    bond_amount:     a.bond_amount,
    tasks_completed: a.tasks_completed,
    tasks_failed:    a.tasks_failed,
    status:          a.status,
    created_at:      a.created_at,
  }));
  res.json({ ok: true, agents, ...(capability && { filtered_by: capability }) });
});

// GET /api/agents/:id
router.get('/:id', (req, res) => {
  const db = getDb();
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
  if (!agent) return res.status(404).json({ ok: false, error: 'Agent not found' });

  const totalTasks = agent.tasks_completed + agent.tasks_failed;
  const successRate = totalTasks > 0 ? agent.tasks_completed / totalTasks : (agent.success_rate || 1.0);
  const reputation = {
    score:           agent.reputation_score,
    success_rate:    successRate,
    latency_ms:      agent.latency_ms,
    call_count:      agent.call_count,
    tasks_completed: agent.tasks_completed,
    tasks_failed:    agent.tasks_failed,
  };

  const { api_key, ...safeAgent } = agent;
  res.json({
    ok: true,
    agent: {
      ...safeAgent,
      capabilities:  JSON.parse(agent.capabilities  || '[]'),
      pricing:       JSON.parse(agent.pricing        || '{}'),
      input_schema:  JSON.parse(agent.input_schema   || '{}'),
      output_schema: JSON.parse(agent.output_schema  || '{}'),
      reputation,
    }
  });
});

// POST /api/agents/:id/reputation — Claw Network reputation update
router.post('/:id/reputation', (req, res) => {
  // Simple admin token check
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'clawnet-admin';
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ ok: false, error: 'Unauthorized: valid admin token required' });
  }

  const { success, latency_ms } = req.body;
  if (typeof success !== 'boolean') {
    return res.status(400).json({ ok: false, error: '`success` (boolean) is required' });
  }

  const db = getDb();
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
  if (!agent) return res.status(404).json({ ok: false, error: 'Agent not found' });

  const prevCount   = agent.call_count   || 0;
  const prevSR      = agent.success_rate || 1.0;
  const prevLatency = agent.latency_ms   || 1000;
  const newLatency  = (typeof latency_ms === 'number' && latency_ms > 0) ? latency_ms : prevLatency;

  const newCount = prevCount + 1;
  // Rolling average success_rate
  const newSR = (prevSR * prevCount + (success ? 1 : 0)) / newCount;
  // EMA latency: 0.8 * old + 0.2 * new
  const emaLatency = Math.round(prevLatency * 0.8 + newLatency * 0.2);
  // Reputation score (clamped 0-100)
  const rawScore = newSR * 70 + (1 - Math.min(emaLatency, 5000) / 5000) * 30;
  const newScore = Math.min(100, Math.max(0, Math.round(rawScore * 100) / 100));

  db.prepare(
    'UPDATE agents SET call_count = ?, success_rate = ?, latency_ms = ?, reputation_score = ? WHERE id = ?'
  ).run(newCount, newSR, emaLatency, newScore, req.params.id);

  res.json({
    ok: true,
    agent_id:        req.params.id,
    call_count:      newCount,
    success_rate:    newSR,
    latency_ms:      emaLatency,
    reputation_score: newScore,
  });
});

module.exports = router;

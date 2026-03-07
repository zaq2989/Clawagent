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
];

// POST /api/agents/register
router.post('/register', registerValidation, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ ok: false, errors: errors.array() });

  const db = getDb();
  const { name, type, capabilities, bond_amount, webhook_url } = req.body;

  const id = uuidv4();
  const apiKey = uuidv4();
  const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');
  const now = Date.now();
  db.prepare(`INSERT INTO agents (id, name, type, capabilities, api_key, bond_amount, webhook_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, name, type || 'ai', JSON.stringify(capabilities || []), hashedKey, bond_amount || 0, webhook_url || null, now);

  // Return plaintext key only once; it cannot be retrieved again
  res.json({ ok: true, agent: { id, name, api_key: apiKey, status: 'active', created_at: now } });
});

// GET /api/agents — public, no auth required; never exposes api_key or other private fields
router.get('/', (req, res) => {
  const db = getDb();
  const rows = db.prepare(
    'SELECT id, name, type, capabilities, reputation_score, bond_amount, tasks_completed, tasks_failed, status, created_at FROM agents ORDER BY reputation_score DESC'
  ).all();
  const agents = rows.map(a => ({
    id: a.id,
    name: a.name,
    type: a.type,
    capabilities: JSON.parse(a.capabilities || '[]'),
    reputation_score: a.reputation_score,
    bond_amount: a.bond_amount,
    tasks_completed: a.tasks_completed,
    tasks_failed: a.tasks_failed,
    status: a.status,
    created_at: a.created_at,
  }));
  res.json({ ok: true, agents });
});

// GET /api/agents/:id
router.get('/:id', (req, res) => {
  const db = getDb();
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
  if (!agent) return res.status(404).json({ ok: false, error: 'Agent not found' });

  const totalTasks = agent.tasks_completed + agent.tasks_failed;
  const successRate = totalTasks > 0 ? agent.tasks_completed / totalTasks : 0.5;
  const reputation = {
    score: agent.reputation_score,
    success_rate: successRate,
    tasks_completed: agent.tasks_completed,
    tasks_failed: agent.tasks_failed
  };

  const { api_key, ...safeAgent } = agent;
  res.json({ ok: true, agent: { ...safeAgent, capabilities: JSON.parse(agent.capabilities || '[]'), reputation } });
});

module.exports = router;

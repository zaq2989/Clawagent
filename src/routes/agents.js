const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const { getDb } = require('../db');

const router = express.Router();

const registerValidation = [
  body('name').isString().trim().notEmpty().withMessage('Name is required'),
  body('type').optional().isIn(['ai', 'human']).withMessage('type must be ai or human'),
  body('capabilities').optional().isArray().withMessage('capabilities must be an array'),
  body('bond_amount').optional().isFloat({ min: 0 }).withMessage('bond_amount must be a non-negative number'),
];

// POST /api/agents/register
router.post('/register', registerValidation, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ ok: false, errors: errors.array() });

  const db = getDb();
  const { name, type, capabilities, bond_amount } = req.body;

  const id = uuidv4();
  const apiKey = uuidv4();
  const now = Date.now();
  db.prepare(`INSERT INTO agents (id, name, type, capabilities, api_key, bond_amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, name, type || 'ai', JSON.stringify(capabilities || []), apiKey, bond_amount || 0, now);

  res.json({ ok: true, agent: { id, name, api_key: apiKey, status: 'active', created_at: now } });
});

// GET /api/agents
router.get('/', (req, res) => {
  const db = getDb();
  const agents = db.prepare('SELECT * FROM agents ORDER BY reputation_score DESC').all();
  res.json({ ok: true, agents: agents.map(a => ({ ...a, capabilities: JSON.parse(a.capabilities || '[]') })) });
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

  res.json({ ok: true, agent: { ...agent, capabilities: JSON.parse(agent.capabilities || '[]'), reputation } });
});

module.exports = router;

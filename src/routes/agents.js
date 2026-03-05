const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db');

const router = express.Router();

// POST /api/agents/register
router.post('/register', (req, res) => {
  const db = getDb();
  const { name, type, capabilities, bond_amount } = req.body;
  if (!name) return res.status(400).json({ ok: false, error: 'Name is required' });

  const id = uuidv4();
  const now = Date.now();
  db.prepare(`INSERT INTO agents (id, name, type, capabilities, bond_amount, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, name, type || 'ai', JSON.stringify(capabilities || []), bond_amount || 0, now);

  res.json({ ok: true, agent: { id, name, status: 'active', created_at: now } });
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

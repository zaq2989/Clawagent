const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const { getDb } = require('../db');
const { updateReputation } = require('./reputation');
const { circuitBreaker } = require('../circuit');
const { apiKeyAuth } = require('../middleware/auth');

const router = express.Router();

const VALID_CATEGORIES = ['osint', 'web_scraping', 'analysis', 'data_collection', 'reporting', 'code', 'translation'];

const createTaskValidation = [
  body('category').isIn(VALID_CATEGORIES).withMessage(`category must be one of: ${VALID_CATEGORIES.join(', ')}`),
  body('intent').isString().trim().notEmpty().withMessage('intent is required'),
  body('payment_amount').optional().isFloat({ gt: 0 }).withMessage('payment_amount must be a positive number'),
  body('max_cost').optional().isFloat({ gt: 0 }).withMessage('max_cost must be a positive number'),
  body('deadline_sec').optional().isInt({ gt: 0 }).withMessage('deadline_sec must be a positive integer'),
  body('parent_id').optional().isString(),
  body('issuer_id').optional().isString(),
];

const statusValidation = [
  body('status').isIn(['open', 'assigned', 'in_progress', 'completed', 'failed', 'disputed']).withMessage('Invalid status'),
  body('worker_id').optional().isString(),
];

// POST /api/tasks/create (auth required)
router.post('/create', apiKeyAuth, createTaskValidation, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ ok: false, errors: errors.array() });

  const db = getDb();
  const { parent_id, category, intent, input_schema, input_data, output_contract, success_criteria, deadline_sec, max_cost, payment_amount, issuer_id } = req.body;
  const id = uuidv4();
  const now = Date.now();
  const depth = parent_id ? (db.prepare('SELECT depth FROM tasks WHERE id = ?').get(parent_id)?.depth || 0) + 1 : 0;

  db.prepare(`INSERT INTO tasks (id, parent_id, depth, category, intent, input_schema, input_data, output_contract, success_criteria, deadline_sec, max_cost, payment_amount, issuer_id, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`)
    .run(id, parent_id || null, depth, category, intent,
      JSON.stringify(input_schema || {}), JSON.stringify(input_data || {}),
      JSON.stringify(output_contract || {}), JSON.stringify(success_criteria || {}),
      deadline_sec || null, max_cost || null, payment_amount || null, issuer_id || null, now);

  res.json({ ok: true, task: { id, status: 'open', created_at: now } });
});

// GET /api/tasks (public)
router.get('/', (req, res) => {
  const db = getDb();
  const { status, category } = req.query;
  let sql = 'SELECT * FROM tasks WHERE 1=1';
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (category) { sql += ' AND category = ?'; params.push(category); }
  sql += ' ORDER BY created_at DESC';
  const tasks = db.prepare(sql).all(...params);
  res.json({ ok: true, tasks });
});

// GET /api/tasks/:id (public)
router.get('/:id', (req, res) => {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ ok: false, error: 'Task not found' });
  res.json({ ok: true, task });
});

// PATCH /api/tasks/:id/status (auth required)
router.patch('/:id/status', apiKeyAuth, statusValidation, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ ok: false, errors: errors.array() });

  const db = getDb();
  const { status, worker_id, result } = req.body;

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ ok: false, error: 'Task not found' });

  const updates = { status };
  if (status === 'assigned' && worker_id) { updates.worker_id = worker_id; updates.assigned_at = Date.now(); }
  if (status === 'completed' || status === 'failed') { updates.completed_at = Date.now(); }
  if (result) { updates.result = JSON.stringify(result); }

  const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE tasks SET ${setClauses} WHERE id = ?`).run(...Object.values(updates), req.params.id);

  // Auto-update reputation on task completion/failure
  const effectiveWorkerId = worker_id || task.worker_id;
  if ((status === 'completed' || status === 'failed') && effectiveWorkerId) {
    const repResult = updateReputation(effectiveWorkerId, req.params.id, status);
    if (status === 'failed') circuitBreaker.recordFailure();
    else circuitBreaker.recordSuccess();
    return res.json({ ok: true, task_id: req.params.id, status, reputation: repResult });
  }

  res.json({ ok: true, task_id: req.params.id, status });
});

// GET /api/tasks/:id/match (auth required)
router.get('/:id/match', apiKeyAuth, (req, res) => {
  const db = getDb();
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ ok: false, error: 'Task not found' });

  const agents = db.prepare("SELECT * FROM agents WHERE status = 'active'").all();
  const taskCategory = task.category || '';

  const scored = agents.map(agent => {
    const caps = JSON.parse(agent.capabilities || '[]');
    const capMatch = caps.some(c => taskCategory.includes(c) || c.includes(taskCategory)) ? 1 : 0;
    const bondOk = agent.bond_amount >= (task.payment_amount || 0) * 0.1 ? 1 : 0;
    const repScore = agent.reputation_score / 100;
    return { agent, score: capMatch * 50 + bondOk * 20 + repScore * 30 };
  });

  scored.sort((a, b) => b.score - a.score);
  res.json({ ok: true, matches: scored.slice(0, 5).map(s => ({ agent_id: s.agent.id, name: s.agent.name, score: Math.round(s.score * 100) / 100, capabilities: JSON.parse(s.agent.capabilities || '[]'), reputation_score: s.agent.reputation_score })) });
});

module.exports = router;

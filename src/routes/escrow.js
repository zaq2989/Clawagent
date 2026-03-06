const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const { getDb } = require('../db');
const { apiKeyAuth } = require('../middleware/auth');
const { updateReputation } = require('./reputation');

const router = express.Router();

// All escrow routes require auth
router.use(apiKeyAuth);

const lockValidation = [
  body('task_id').isString().trim().notEmpty().withMessage('task_id is required'),
  body('amount').isFloat({ gt: 0 }).withMessage('amount must be a positive number'),
  body('holder').optional().isString(),
];

const taskIdValidation = [
  body('task_id').isString().trim().notEmpty().withMessage('task_id is required'),
];

// POST /api/escrow/lock
router.post('/lock', lockValidation, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ ok: false, errors: errors.array() });

  const db = getDb();
  const { task_id, amount, holder } = req.body;

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task_id);
  if (!task) return res.status(404).json({ ok: false, error: 'Task not found' });

  const id = uuidv4();
  db.prepare(`INSERT INTO escrow (id, task_id, amount, holder, status, created_at) VALUES (?, ?, ?, ?, 'locked', ?)`)
    .run(id, task_id, amount, holder || 'issuer', Date.now());

  db.prepare('UPDATE tasks SET payment_locked = 1 WHERE id = ?').run(task_id);

  res.json({ ok: true, escrow: { id, task_id, amount, status: 'locked' } });
});

// POST /api/escrow/release
router.post('/release', taskIdValidation, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ ok: false, errors: errors.array() });

  const db = getDb();
  const { task_id } = req.body;

  const escrowRow = db.prepare("SELECT * FROM escrow WHERE task_id = ? AND status = 'locked'").get(task_id);
  if (!escrowRow) return res.status(404).json({ ok: false, error: 'No locked escrow for this task' });

  db.prepare("UPDATE escrow SET status = 'released' WHERE id = ?").run(escrowRow.id);
  db.prepare('UPDATE tasks SET payment_locked = 0 WHERE id = ?').run(task_id);

  // Auto-update worker reputation on escrow release
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task_id);
  let reputation = null;
  if (task && task.worker_id) {
    reputation = updateReputation(task.worker_id, task_id, 'completed', {});
  }

  res.json({ ok: true, escrow: { id: escrowRow.id, task_id, status: 'released', amount: escrowRow.amount }, reputation });
});

// POST /api/escrow/slash
router.post('/slash', taskIdValidation, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ ok: false, errors: errors.array() });

  const db = getDb();
  const { task_id } = req.body;

  const escrowRow = db.prepare("SELECT * FROM escrow WHERE task_id = ? AND status = 'locked'").get(task_id);
  if (!escrowRow) return res.status(404).json({ ok: false, error: 'No locked escrow for this task' });

  db.prepare("UPDATE escrow SET status = 'slashed' WHERE id = ?").run(escrowRow.id);

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task_id);
  if (task && task.worker_id) {
    db.prepare('UPDATE agents SET bond_locked = bond_locked + ? WHERE id = ?').run(escrowRow.amount, task.worker_id);
  }

  res.json({ ok: true, escrow: { id: escrowRow.id, task_id, status: 'slashed', amount: escrowRow.amount } });
});

module.exports = router;

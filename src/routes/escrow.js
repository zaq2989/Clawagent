const express = require('express');
const uuidv4 = () => require('crypto').randomUUID();
const { body, validationResult } = require('express-validator');
const { query, run, get } = require('../db');
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
router.post('/lock', lockValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ ok: false, errors: errors.array() });

  try {
    const { task_id, amount, holder } = req.body;

    const task = await get('SELECT * FROM tasks WHERE id = ?', [task_id]);
    if (!task) return res.status(404).json({ ok: false, error: 'Task not found' });

    const id = uuidv4();
    await run(
      `INSERT INTO escrow (id, task_id, amount, holder, status, created_at) VALUES (?, ?, ?, ?, 'locked', ?)`,
      [id, task_id, amount, holder || 'issuer', Date.now()]
    );

    await run('UPDATE tasks SET payment_locked = 1 WHERE id = ?', [task_id]);

    res.json({ ok: true, escrow: { id, task_id, amount, status: 'locked' } });
  } catch (err) {
    console.error('[escrow/lock] Error:', err);
    res.status(500).json({ ok: false, error: 'Internal server error', detail: err.message });
  }
});

// POST /api/escrow/release
router.post('/release', taskIdValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ ok: false, errors: errors.array() });

  try {
    const { task_id } = req.body;

    const escrowRow = await get("SELECT * FROM escrow WHERE task_id = ? AND status = 'locked'", [task_id]);
    if (!escrowRow) return res.status(404).json({ ok: false, error: 'No locked escrow for this task' });

    await run("UPDATE escrow SET status = 'released' WHERE id = ?", [escrowRow.id]);
    await run('UPDATE tasks SET payment_locked = 0 WHERE id = ?', [task_id]);

    // Auto-update worker reputation on escrow release
    const task = await get('SELECT * FROM tasks WHERE id = ?', [task_id]);
    let reputation = null;
    if (task && task.worker_id) {
      reputation = await updateReputation(task.worker_id, task_id, 'completed', {});
    }

    res.json({ ok: true, escrow: { id: escrowRow.id, task_id, status: 'released', amount: escrowRow.amount }, reputation });
  } catch (err) {
    console.error('[escrow/release] Error:', err);
    res.status(500).json({ ok: false, error: 'Internal server error', detail: err.message });
  }
});

// POST /api/escrow/slash
router.post('/slash', taskIdValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ ok: false, errors: errors.array() });

  try {
    const { task_id } = req.body;

    const escrowRow = await get("SELECT * FROM escrow WHERE task_id = ? AND status = 'locked'", [task_id]);
    if (!escrowRow) return res.status(404).json({ ok: false, error: 'No locked escrow for this task' });

    await run("UPDATE escrow SET status = 'slashed' WHERE id = ?", [escrowRow.id]);

    const task = await get('SELECT * FROM tasks WHERE id = ?', [task_id]);
    if (task && task.worker_id) {
      await run('UPDATE agents SET bond_locked = bond_locked + ? WHERE id = ?', [escrowRow.amount, task.worker_id]);
    }

    res.json({ ok: true, escrow: { id: escrowRow.id, task_id, status: 'slashed', amount: escrowRow.amount } });
  } catch (err) {
    console.error('[escrow/slash] Error:', err);
    res.status(500).json({ ok: false, error: 'Internal server error', detail: err.message });
  }
});

module.exports = router;

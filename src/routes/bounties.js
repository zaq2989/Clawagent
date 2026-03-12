const express = require('express');
const uuidv4 = () => require('crypto').randomUUID();
const { body, validationResult } = require('express-validator');
const { query, run, get } = require('../db');
const { apiKeyAuth } = require('../middleware/auth');

const router = express.Router();

// Strip api_key from agent object before returning
function safeAgent(agent) {
  if (!agent) return null;
  const { api_key, ...safe } = agent;
  return safe;
}

// GET /api/bounties — list open bounties (public)
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const filterStatus = status || 'open';
    const bounties = await query(
      'SELECT id, title, description, required_skill, budget, status, posted_by, claimed_by, expires_at, created_at FROM bounties WHERE status = ? ORDER BY created_at DESC',
      [filterStatus]
    );
    res.json({ ok: true, bounties });
  } catch (err) {
    console.error('[bounties/list] Error:', err);
    res.status(500).json({ ok: false, error: 'Internal server error', detail: err.message });
  }
});

// GET /api/bounties/:id — bounty detail (public)
router.get('/:id', async (req, res) => {
  try {
    const bounty = await get(
      'SELECT id, title, description, required_skill, budget, status, posted_by, claimed_by, result, expires_at, created_at FROM bounties WHERE id = ?',
      [req.params.id]
    );
    if (!bounty) return res.status(404).json({ ok: false, error: 'Bounty not found' });
    res.json({ ok: true, bounty });
  } catch (err) {
    console.error('[bounties/:id] Error:', err);
    res.status(500).json({ ok: false, error: 'Internal server error', detail: err.message });
  }
});

// POST /api/bounties — post a new bounty (auth required)
const postBountyValidation = [
  body('title').isString().trim().notEmpty().withMessage('title is required'),
  body('description').isString().trim().notEmpty().withMessage('description is required'),
  body('required_skill').isString().trim().notEmpty().withMessage('required_skill is required'),
  body('budget').optional().isFloat({ min: 0 }).withMessage('budget must be a non-negative number'),
  body('expires_at').optional().isInt({ min: 1 }).withMessage('expires_at must be a Unix timestamp in ms'),
];

router.post('/', apiKeyAuth, postBountyValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ ok: false, errors: errors.array() });

  try {
    const { title, description, required_skill, budget, expires_at } = req.body;
    const id = uuidv4();
    const now = Date.now();

    await run(
      `INSERT INTO bounties (id, title, description, required_skill, budget, status, posted_by, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
      [id, title, description, required_skill, budget || 0, req.agentId, expires_at || null, now]
    );

    res.status(201).json({
      ok: true,
      bounty: { id, title, description, required_skill, budget: budget || 0, status: 'open', posted_by: req.agentId, expires_at: expires_at || null, created_at: now }
    });
  } catch (err) {
    console.error('[bounties/post] Error:', err);
    res.status(500).json({ ok: false, error: 'Internal server error', detail: err.message });
  }
});

// POST /api/bounties/:id/claim — claim a bounty (auth required)
router.post('/:id/claim', apiKeyAuth, async (req, res) => {
  try {
    const bounty = await get('SELECT * FROM bounties WHERE id = ?', [req.params.id]);

    if (!bounty) return res.status(404).json({ ok: false, error: 'Bounty not found' });
    if (bounty.status !== 'open') return res.status(409).json({ ok: false, error: `Bounty is not open (current status: ${bounty.status})` });

    await run('UPDATE bounties SET status = ?, claimed_by = ? WHERE id = ?', ['claimed', req.agentId, req.params.id]);

    res.json({ ok: true, bounty_id: req.params.id, status: 'claimed', claimed_by: req.agentId });
  } catch (err) {
    console.error('[bounties/:id/claim] Error:', err);
    res.status(500).json({ ok: false, error: 'Internal server error', detail: err.message });
  }
});

// POST /api/bounties/:id/complete — submit result (auth required, only claimer)
const completeValidation = [
  body('result').isString().trim().notEmpty().withMessage('result is required'),
];

router.post('/:id/complete', apiKeyAuth, completeValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ ok: false, errors: errors.array() });

  try {
    const bounty = await get('SELECT * FROM bounties WHERE id = ?', [req.params.id]);

    if (!bounty) return res.status(404).json({ ok: false, error: 'Bounty not found' });
    if (bounty.status !== 'claimed') return res.status(409).json({ ok: false, error: `Bounty is not in claimed status (current: ${bounty.status})` });
    if (bounty.claimed_by !== req.agentId) return res.status(403).json({ ok: false, error: 'Only the agent that claimed this bounty can complete it' });

    const { result } = req.body;
    await run('UPDATE bounties SET status = ?, result = ? WHERE id = ?', ['completed', result, req.params.id]);

    res.json({ ok: true, bounty_id: req.params.id, status: 'completed' });
  } catch (err) {
    console.error('[bounties/:id/complete] Error:', err);
    res.status(500).json({ ok: false, error: 'Internal server error', detail: err.message });
  }
});

module.exports = router;

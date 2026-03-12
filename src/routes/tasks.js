const express = require('express');
const uuidv4 = () => require('crypto').randomUUID();
const { body, validationResult } = require('express-validator');
const { query, run, get } = require('../db');
const { updateReputation } = require('./reputation');
const { circuitBreaker } = require('../circuit');
const { apiKeyAuth } = require('../middleware/auth');
const { notifyWebhook } = require('../webhook');
const { PLATFORM_ADDRESS, PLATFORM_FEE_BPS } = require('../x402');

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
router.post('/create', apiKeyAuth, createTaskValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ ok: false, errors: errors.array() });

  try {
    const { parent_id, category, intent, input_schema, input_data, output_contract, success_criteria, deadline_sec, max_cost, payment_amount, issuer_id } = req.body;
    const id = uuidv4();
    const now = Date.now();

    const depthRow = parent_id ? await get('SELECT depth FROM tasks WHERE id = ?', [parent_id]) : null;
    const depth = depthRow ? (depthRow.depth || 0) + 1 : 0;

    await run(
      `INSERT INTO tasks (id, parent_id, depth, category, intent, input_schema, input_data, output_contract, success_criteria, deadline_sec, max_cost, payment_amount, issuer_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      [id, parent_id || null, depth, category, intent,
        JSON.stringify(input_schema || {}), JSON.stringify(input_data || {}),
        JSON.stringify(output_contract || {}), JSON.stringify(success_criteria || {}),
        deadline_sec || null, max_cost || null, payment_amount || null, issuer_id || null, now]
    );

    res.json({ ok: true, task: { id, status: 'open', created_at: now } });
  } catch (err) {
    console.error('[tasks/create] Error:', err);
    res.status(500).json({ ok: false, error: 'Internal server error', detail: err.message });
  }
});

// GET /api/tasks — auth required; returns only tasks assigned to the calling agent
router.get('/', apiKeyAuth, async (req, res) => {
  try {
    const agentId = req.agentId;
    const { status } = req.query;

    let sql = 'SELECT * FROM tasks WHERE worker_id = ?';
    const params = [agentId];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }

    sql += ' ORDER BY created_at DESC LIMIT 50';

    const tasks = await query(sql, params);
    res.json({ ok: true, tasks });
  } catch (err) {
    console.error('[tasks/list] Error:', err);
    res.status(500).json({ ok: false, error: 'Internal server error', detail: err.message });
  }
});

// GET /api/tasks/:id (public)
router.get('/:id', async (req, res) => {
  try {
    const task = await get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!task) return res.status(404).json({ ok: false, error: 'Task not found' });
    res.json({ ok: true, task });
  } catch (err) {
    console.error('[tasks/:id] Error:', err);
    res.status(500).json({ ok: false, error: 'Internal server error', detail: err.message });
  }
});

// PATCH /api/tasks/:id/status (auth required)
router.patch('/:id/status', apiKeyAuth, statusValidation, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ ok: false, errors: errors.array() });

  try {
    const { status, worker_id, result } = req.body;

    const task = await get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!task) return res.status(404).json({ ok: false, error: 'Task not found' });

    const updates = { status };
    if (status === 'assigned' && worker_id) { updates.worker_id = worker_id; updates.assigned_at = Date.now(); }
    if (status === 'completed' || status === 'failed') { updates.completed_at = Date.now(); }
    if (result) { updates.result = JSON.stringify(result); }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await run(`UPDATE tasks SET ${setClauses} WHERE id = ?`, [...Object.values(updates), req.params.id]);

    const effectiveWorkerId = worker_id || task.worker_id;

    // Notify worker webhook on task assignment
    if (status === 'assigned' && effectiveWorkerId) {
      const workerAgent = await get('SELECT webhook_url FROM agents WHERE id = ?', [effectiveWorkerId]);
      if (workerAgent?.webhook_url) {
        notifyWebhook(workerAgent.webhook_url, 'task_assigned', {
          task_id: req.params.id,
          worker_id: effectiveWorkerId,
          intent: task.intent,
          category: task.category,
          payment_amount: task.payment_amount,
        });
      }
    }

    // Record platform fee ledger entry on task completion
    if (status === 'completed' && effectiveWorkerId) {
      try {
        const grossAmount = BigInt(1000); // 0.001 USDC (6 decimals)
        const platformFee = grossAmount * BigInt(PLATFORM_FEE_BPS) / BigInt(10000);
        const agentPayout = grossAmount - platformFee;
        const agentInfo = await get('SELECT payment_address FROM agents WHERE id = ?', [effectiveWorkerId]);
        await run(
          `INSERT INTO fee_ledger (id, task_id, agent_id, gross_amount, platform_fee, agent_payout, platform_address, agent_address, settled, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
          [
            uuidv4(),
            req.params.id,
            effectiveWorkerId,
            grossAmount.toString(),
            platformFee.toString(),
            agentPayout.toString(),
            PLATFORM_ADDRESS,
            agentInfo?.payment_address || null,
            Date.now(),
          ]
        );
      } catch (feeErr) {
        console.error('[tasks/:id/status] fee_ledger insert error:', feeErr);
      }
    }

    // Auto-update reputation on task completion/failure + notify webhook
    if ((status === 'completed' || status === 'failed') && effectiveWorkerId) {
      const repResult = await updateReputation(effectiveWorkerId, req.params.id, status);
      if (status === 'failed') circuitBreaker.recordFailure(effectiveWorkerId);
      else circuitBreaker.recordSuccess(effectiveWorkerId);

      // Notify worker webhook
      const workerAgent = await get('SELECT webhook_url FROM agents WHERE id = ?', [effectiveWorkerId]);
      if (workerAgent?.webhook_url) {
        notifyWebhook(workerAgent.webhook_url, status === 'completed' ? 'task_completed' : 'task_failed', {
          task_id: req.params.id,
          worker_id: effectiveWorkerId,
          intent: task.intent,
          category: task.category,
          reputation: repResult,
        });
      }

      return res.json({ ok: true, task_id: req.params.id, status, reputation: repResult });
    }

    res.json({ ok: true, task_id: req.params.id, status });
  } catch (err) {
    console.error('[tasks/:id/status] Error:', err);
    res.status(500).json({ ok: false, error: 'Internal server error', detail: err.message });
  }
});

// ── Load Balancing: pick best agent for a capability ─────────────────────────
/**
 * Score an agent: higher is better.
 * Fields reputation_score, success_rate, latency_ms are added by migration.
 */
function scoreAgent(agent) {
  const rep     = typeof agent.reputation_score === 'number' ? agent.reputation_score : 50;
  const success = typeof agent.success_rate     === 'number' ? agent.success_rate     : 1.0;
  const latency = typeof agent.latency_ms       === 'number' ? agent.latency_ms       : 1000;
  return (rep * success) / (latency + 1);
}

/**
 * Given a list of agents that all have the required capability, return the one
 * with the highest score. Falls back to random selection when scores are equal.
 */
function pickBestAgent(agents) {
  if (!agents || agents.length === 0) return null;
  if (agents.length === 1) return agents[0];

  let best = agents[0];
  let bestScore = scoreAgent(agents[0]);
  for (let i = 1; i < agents.length; i++) {
    const s = scoreAgent(agents[i]);
    if (s > bestScore) {
      bestScore = s;
      best = agents[i];
    }
  }
  return best;
}

// POST /api/tasks/run — capability-based task execution with load balancing
// capability=web.search → handled internally (no webhook)
// other capabilities → routed to best matching agent
router.post('/run', apiKeyAuth, async (req, res) => {
  try {
    const { capability, input } = req.body;

    if (!capability) {
      return res.status(400).json({ ok: false, error: '`capability` is required' });
    }

    const taskId  = uuidv4();
    const now     = Date.now();

    // ── Built-in: web.search ────────────────────────────────────────────────
    if (capability === 'web.search') {
      const { webSearch } = require('../capabilities/webSearch');
      const queryStr = (typeof input === 'string') ? input : (input?.query || input?.text || '');
      if (!queryStr) {
        return res.status(400).json({ ok: false, error: '`input.query` or `input.text` is required for web.search' });
      }
      const limitVal = input?.limit || 5;

      let results;
      try {
        results = await webSearch(queryStr, { limit: limitVal });
      } catch (searchErr) {
        return res.status(502).json({ ok: false, error: 'Web search failed', detail: searchErr.message });
      }

      await run(
        `INSERT INTO tasks (id, category, intent, input_data, status, result, created_at, completed_at)
         VALUES (?, ?, ?, ?, 'completed', ?, ?, ?)`,
        [taskId, 'web.search', queryStr, JSON.stringify(input || {}), JSON.stringify(results), now, now]
      );

      return res.json({ taskId, status: 'completed', result: results });
    }

    // ── Built-in: web.scrape ────────────────────────────────────────────────
    if (capability === 'web.scrape') {
      const { webScrape } = require('../capabilities/webSearch');
      const urlStr = (typeof input === 'string') ? input : (input?.url || '');
      if (!urlStr) {
        return res.status(400).json({ ok: false, error: '`input.url` is required for web.scrape' });
      }

      let result;
      try {
        result = await webScrape(urlStr);
      } catch (scrapeErr) {
        return res.status(502).json({ ok: false, error: 'Web scrape failed', detail: scrapeErr.message });
      }

      await run(
        `INSERT INTO tasks (id, category, intent, input_data, status, result, created_at, completed_at)
         VALUES (?, ?, ?, ?, 'completed', ?, ?, ?)`,
        [taskId, 'web.scrape', urlStr, JSON.stringify(input || {}), JSON.stringify(result), now, now]
      );

      return res.json({ taskId, status: 'completed', result });
    }

    // ── External capability: find best matching agent ────────────────────────
    const allActive = await query("SELECT * FROM agents WHERE status = 'active'", []);

    const matching = allActive.filter(agent => {
      const caps = JSON.parse(agent.capabilities || '[]');
      return caps.includes(capability);
    });

    if (matching.length === 0) {
      return res.status(404).json({ ok: false, error: `No active agent found for capability: ${capability}` });
    }

    const best = pickBestAgent(matching);

    // polling mode: webhook_url is empty or 'internal://' — keep status as 'pending'
    // so the worker can poll GET /api/tasks?status=pending
    const isPollingMode = !best.webhook_url || best.webhook_url === '' || best.webhook_url.startsWith('internal://');
    const taskStatus = isPollingMode ? 'pending' : 'assigned';

    await run(
      `INSERT INTO tasks (id, category, intent, input_data, worker_id, status, created_at, assigned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [taskId, capability, capability, JSON.stringify(input || {}), best.id, taskStatus, now, now]
    );

    // Only notify via webhook when not in polling mode
    if (!isPollingMode) {
      notifyWebhook(best.webhook_url, 'task_assigned', {
        task_id:    taskId,
        capability,
        input,
        worker_id:  best.id,
      });
    }

    return res.json({
      taskId,
      status:  taskStatus,
      agentId: best.id,
      agentName: best.name,
      score: Math.round(scoreAgent(best) * 10000) / 10000,
    });
  } catch (err) {
    console.error('[tasks/run] Error:', err);
    return res.status(500).json({ ok: false, error: 'Internal server error', detail: err.message });
  }
});

// GET /api/tasks/:id/match (auth required)
router.get('/:id/match', apiKeyAuth, async (req, res) => {
  try {
    const task = await get('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    if (!task) return res.status(404).json({ ok: false, error: 'Task not found' });

    const agents = await query("SELECT * FROM agents WHERE status = 'active'", []);
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
  } catch (err) {
    console.error('[tasks/:id/match] Error:', err);
    res.status(500).json({ ok: false, error: 'Internal server error', detail: err.message });
  }
});

module.exports = router;

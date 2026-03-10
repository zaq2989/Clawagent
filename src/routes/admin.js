const express = require('express');
const { getDb } = require('../db');
const { circuitBreaker } = require('../circuit');
const { ADMIN_TOKEN } = require('../config/auth');

const router = express.Router();

function authAdmin(req, res, next) {
  // Accept token via Authorization header (Bearer) or X-Admin-Token header only.
  // Query-param auth is intentionally NOT supported to prevent token leakage
  // into server access logs, CDN/proxy logs, and browser history.
  const authHeader = req.headers['authorization'] || '';
  const xAdminHeader = req.headers['x-admin-token'] || '';
  const token = (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null) || xAdminHeader || null;
  if (!token || token !== ADMIN_TOKEN) return res.status(403).json({ ok: false, error: 'Unauthorized' });
  next();
}

router.use(authAdmin);

// GET /api/admin/dashboard
router.get('/dashboard', (req, res) => {
  const db = getDb();
  const totalTasks = db.prepare('SELECT COUNT(*) as c FROM tasks').get().c;
  const openTasks = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'open'").get().c;
  const completedTasks = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'completed'").get().c;
  const failedTasks = db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status = 'failed'").get().c;
  const activeAgents = db.prepare("SELECT COUNT(*) as c FROM agents WHERE status = 'active'").get().c;
  const totalAgents = db.prepare('SELECT COUNT(*) as c FROM agents').get().c;
  const totalEscrow = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM escrow WHERE status = 'locked'").get().total;

  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 10000) / 100 : 0;

  // Tasks created in last 24h
  const dayAgo = Date.now() - 86400000;
  const tasksToday = db.prepare('SELECT COUNT(*) as c FROM tasks WHERE created_at > ?').get(dayAgo).c;

  res.json({
    ok: true,
    dashboard: {
      tasks: { total: totalTasks, open: openTasks, completed: completedTasks, failed: failedTasks, today: tasksToday },
      agents: { total: totalAgents, active: activeAgents },
      escrow: { locked_total: totalEscrow },
      completion_rate: completionRate,
      circuit_breaker: circuitBreaker.getStatus()
    }
  });
});

// POST /api/admin/agent/ban
router.post('/agent/ban', (req, res) => {
  const db = getDb();
  const { agent_id } = req.body;
  if (!agent_id) return res.status(400).json({ ok: false, error: 'agent_id required' });

  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agent_id);
  if (!agent) return res.status(404).json({ ok: false, error: 'Agent not found' });

  db.prepare("UPDATE agents SET status = 'banned' WHERE id = ?").run(agent_id);
  res.json({ ok: true, agent_id, status: 'banned' });
});

// POST /api/admin/circuit/reset
router.post('/circuit/reset', (req, res) => {
  circuitBreaker.reset();
  res.json({ ok: true, message: 'Circuit breaker reset' });
});

module.exports = router;

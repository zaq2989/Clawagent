const express = require('express');
const { query, run, get } = require('../db');
const { circuitBreaker } = require('../circuit');
const { ADMIN_TOKEN } = require('../config/auth');

const router = express.Router();

function authAdmin(req, res, next) {
  // Accept token via Authorization header (Bearer) or X-Admin-Token header only.
  const authHeader = req.headers['authorization'] || '';
  const xAdminHeader = req.headers['x-admin-token'] || '';
  const token = (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null) || xAdminHeader || null;
  if (!token || token !== ADMIN_TOKEN) return res.status(403).json({ ok: false, error: 'Unauthorized' });
  next();
}

router.use(authAdmin);

// GET /api/admin/dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const [
      totalTasksRow,
      openTasksRow,
      completedTasksRow,
      failedTasksRow,
      activeAgentsRow,
      totalAgentsRow,
      totalEscrowRow,
    ] = await Promise.all([
      get('SELECT COUNT(*) as c FROM tasks', []),
      get("SELECT COUNT(*) as c FROM tasks WHERE status = 'open'", []),
      get("SELECT COUNT(*) as c FROM tasks WHERE status = 'completed'", []),
      get("SELECT COUNT(*) as c FROM tasks WHERE status = 'failed'", []),
      get("SELECT COUNT(*) as c FROM agents WHERE status = 'active'", []),
      get('SELECT COUNT(*) as c FROM agents', []),
      get("SELECT COALESCE(SUM(amount), 0) as total FROM escrow WHERE status = 'locked'", []),
    ]);

    const totalTasks     = totalTasksRow.c;
    const openTasks      = openTasksRow.c;
    const completedTasks = completedTasksRow.c;
    const failedTasks    = failedTasksRow.c;
    const activeAgents   = activeAgentsRow.c;
    const totalAgents    = totalAgentsRow.c;
    const totalEscrow    = totalEscrowRow.total;

    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 10000) / 100 : 0;

    const dayAgo = Date.now() - 86400000;
    const tasksTodayRow = await get('SELECT COUNT(*) as c FROM tasks WHERE created_at > ?', [dayAgo]);
    const tasksToday = tasksTodayRow.c;

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
  } catch (err) {
    console.error('[admin/dashboard] Error:', err);
    res.status(500).json({ ok: false, error: 'Internal server error', detail: err.message });
  }
});

// POST /api/admin/agent/ban
router.post('/agent/ban', async (req, res) => {
  try {
    const { agent_id } = req.body;
    if (!agent_id) return res.status(400).json({ ok: false, error: 'agent_id required' });

    const agent = await get('SELECT * FROM agents WHERE id = ?', [agent_id]);
    if (!agent) return res.status(404).json({ ok: false, error: 'Agent not found' });

    await run("UPDATE agents SET status = 'banned' WHERE id = ?", [agent_id]);
    res.json({ ok: true, agent_id, status: 'banned' });
  } catch (err) {
    console.error('[admin/agent/ban] Error:', err);
    res.status(500).json({ ok: false, error: 'Internal server error', detail: err.message });
  }
});

// POST /api/admin/circuit/reset
router.post('/circuit/reset', (req, res) => {
  circuitBreaker.reset();
  res.json({ ok: true, message: 'Circuit breaker reset' });
});

module.exports = router;

// src/routes/stats.js — Monitoring Dashboard: GET /api/stats
const express = require('express');
const { query, run, get } = require('../db');

const router = express.Router();

/**
 * GET /api/stats
 * Returns aggregated metrics for the Claw Network dashboard.
 */
router.get('/', async (req, res) => {
  try {
    // ── Agents summary ────────────────────────────────────────────────────────
    const agentTotals = await get(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'active'   THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status != 'active'  THEN 1 ELSE 0 END) AS inactive
      FROM agents
    `, []);

    // ── Tasks summary ─────────────────────────────────────────────────────────
    const taskTotals = await get(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'failed'    THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN status IN ('open','assigned','in_progress') THEN 1 ELSE 0 END) AS pending
      FROM tasks
    `, []);

    // ── Top 5 capabilities (by task category) ─────────────────────────────────
    const topCapabilities = (await query(`
      SELECT
        category AS capability,
        COUNT(*) AS count,
        ROUND(
          AVG(CASE WHEN status = 'completed' AND assigned_at IS NOT NULL AND completed_at IS NOT NULL
                   THEN (completed_at - assigned_at)
                   ELSE NULL END),
          0
        ) AS avgLatencyMs,
        ROUND(
          CAST(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS REAL)
          / NULLIF(COUNT(*), 0),
          4
        ) AS successRate
      FROM tasks
      WHERE category IS NOT NULL
      GROUP BY category
      ORDER BY count DESC
      LIMIT 5
    `, [])).map(row => ({
      capability:   row.capability,
      count:        row.count,
      avgLatencyMs: row.avgLatencyMs !== null ? Number(row.avgLatencyMs) : null,
      successRate:  row.successRate  !== null ? Number(row.successRate)  : null,
    }));

    // ── Recent 10 task activity ───────────────────────────────────────────────
    const recentActivity = (await query(`
      SELECT
        id        AS taskId,
        category  AS capability,
        status,
        created_at AS createdAt
      FROM tasks
      ORDER BY created_at DESC
      LIMIT 10
    `, [])).map(row => ({
      taskId:     row.taskId,
      capability: row.capability,
      status:     row.status,
      createdAt:  row.createdAt,
    }));

    res.json({
      agents: {
        total:    Number(agentTotals?.total    ?? 0),
        active:   Number(agentTotals?.active   ?? 0),
        inactive: Number(agentTotals?.inactive ?? 0),
      },
      tasks: {
        total:     Number(taskTotals?.total     ?? 0),
        completed: Number(taskTotals?.completed ?? 0),
        failed:    Number(taskTotals?.failed    ?? 0),
        pending:   Number(taskTotals?.pending   ?? 0),
      },
      topCapabilities,
      recentActivity,
    });
  } catch (err) {
    console.error('[stats] Error:', err);
    res.status(500).json({ ok: false, error: 'Failed to retrieve stats', detail: err.message });
  }
});

module.exports = router;

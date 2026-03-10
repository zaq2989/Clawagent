// src/routes/jobs.js — Async Capability Execution
// POST /call/async  → returns job_id immediately
// GET  /jobs/:job_id → poll job status

const express = require('express');
const crypto = require('crypto');
const { resolveAndCall } = require('./dns');

const router = express.Router();

// In-memory job store (MVP — resets on restart)
const jobs = new Map();

// POST /call/async
router.post('/call/async', async (req, res) => {
  const { capability, input, budget, timeout_ms } = req.body;

  if (!capability) {
    return res.status(400).json({ ok: false, error: 'capability is required' });
  }

  const job_id = crypto.randomUUID();
  const created_at = Date.now();

  jobs.set(job_id, { status: 'pending', created_at });

  // Respond immediately
  res.json({
    job_id,
    status: 'pending',
    poll_url: `/jobs/${job_id}`,
    created_at,
  });

  // Run in background
  (async () => {
    jobs.set(job_id, { status: 'running', created_at, started_at: Date.now() });
    try {
      const result = await resolveAndCall({
        capability,
        input,
        budget,
        timeout_ms: timeout_ms || 30000,
      });
      jobs.set(job_id, {
        status: 'done',
        result,
        created_at,
        started_at: jobs.get(job_id)?.started_at,
        completed_at: Date.now(),
      });
    } catch (e) {
      jobs.set(job_id, {
        status: 'failed',
        error: e.message,
        error_body: e.body || null,
        created_at,
        started_at: jobs.get(job_id)?.started_at,
        failed_at: Date.now(),
      });
    }
  })();
});

// GET /jobs/:job_id
router.get('/jobs/:job_id', (req, res) => {
  const job = jobs.get(req.params.job_id);
  if (!job) return res.status(404).json({ ok: false, error: 'Job not found' });
  res.json({ job_id: req.params.job_id, ...job });
});

module.exports = router;

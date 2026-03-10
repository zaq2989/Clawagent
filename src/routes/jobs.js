// src/routes/jobs.js — Async Capability Execution
// POST /call/async  → returns job_id immediately
// GET  /jobs/:job_id → poll job status

const express = require('express');
const crypto = require('crypto');
const { resolveAndCall } = require('./dns');

const router = express.Router();

// In-memory job store (MVP — resets on restart)
const jobs = new Map();

// TTL: keep completed/failed jobs for 30 minutes, pending/running for 1 hour
const JOB_TTL_DONE_MS    = 30 * 60 * 1000;  // 30 min
const JOB_TTL_ACTIVE_MS  = 60 * 60 * 1000;  // 1 hour

// Cleanup expired jobs every 10 minutes to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs) {
    const age = now - (job.completed_at || job.failed_at || job.started_at || job.created_at || 0);
    const ttl = (job.status === 'done' || job.status === 'failed') ? JOB_TTL_DONE_MS : JOB_TTL_ACTIVE_MS;
    if (age > ttl) {
      jobs.delete(id);
    }
  }
}, 10 * 60 * 1000);

// POST /call/async
router.post('/call/async', async (req, res) => {
  const { capability, input, budget, timeout_ms, payment_proof, payment_scheme } = req.body;

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
        payment_proof,
        payment_scheme,
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

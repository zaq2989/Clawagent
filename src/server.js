const express = require('express');
const path = require('path');
const { getDb } = require('./db');
const { updateReputation } = require('./routes/reputation');
const { circuitBreaker } = require('./circuit');

const tasksRouter = require('./routes/tasks');
const agentsRouter = require('./routes/agents');
const escrowRouter = require('./routes/escrow');
const verifyRouter = require('./routes/verify');
const adminRouter = require('./routes/admin');

const app = express();
const PORT = 3750;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// API routes
app.use('/api/tasks', tasksRouter);
app.use('/api/agents', agentsRouter);
app.use('/api/escrow', escrowRouter);
app.use('/api/verify', verifyRouter);
app.use('/api/admin', adminRouter);

// Reputation endpoint (wraps the engine)
app.post('/api/reputation/update', (req, res) => {
  const { agent_id, task_id, event, accuracy, speed_bonus } = req.body;
  if (!agent_id || !task_id || !event) {
    return res.status(400).json({ ok: false, error: 'agent_id, task_id, and event required' });
  }

  if (circuitBreaker.isOpen()) {
    return res.status(503).json({ ok: false, error: 'Circuit breaker is open. System in cooldown.' });
  }

  const result = updateReputation(agent_id, task_id, event, { accuracy, speed_bonus });
  if (!result) return res.status(404).json({ ok: false, error: 'Agent not found' });

  if (event === 'failed') circuitBreaker.recordFailure();
  else if (event === 'completed') circuitBreaker.recordSuccess();

  res.json({ ok: true, ...result });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'ClawAgent', version: '1.0.0', uptime: process.uptime() });
});

// Initialize DB on startup
getDb();

app.listen(PORT, () => {
  console.log(`ClawAgent MVP running on http://localhost:${PORT}`);
});

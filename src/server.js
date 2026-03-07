const express = require('express');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { getDb } = require('./db');
const { updateReputation } = require('./routes/reputation');
const { circuitBreaker } = require('./circuit');
const { apiKeyAuth } = require('./middleware/auth');
const { corsMiddleware } = require('./middleware/cors');

const tasksRouter = require('./routes/tasks');
const agentsRouter = require('./routes/agents');
const escrowRouter = require('./routes/escrow');
const verifyRouter = require('./routes/verify');
const adminRouter = require('./routes/admin');
const webhooksRouter = require('./routes/webhooks');

const app = express();
const PORT = process.env.PORT || 3750;

// CORS
app.use(corsMiddleware);

// Security headers
app.use(helmet());

// Body parsing
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Global rate limit: 100 req / 15 min per IP
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many requests. Please try again later.' },
}));

// Rate limiters for specific endpoints
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Registration rate limit exceeded. Try again later.' },
});

const taskCreateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.apiKey || 'unknown',
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Task creation rate limit exceeded. Try again later.' },
});

// Apply specific rate limiters
app.post('/api/agents/register', registerLimiter);
app.post('/api/tasks/create', taskCreateLimiter);

// Health check (public)
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'ClawAgent', version: '1.0.0', uptime: process.uptime() });
});

// Circuit breaker status (public) — original endpoint
app.get('/api/circuit/status', (req, res) => {
  const db = getDb();
  res.json({ ok: true, agents: circuitBreaker.getAgentStatuses(db), ...circuitBreaker.getStatus() });
});

// Circuit breaker status (public) — canonical endpoint
app.get('/api/circuit-breaker/status', (req, res) => {
  const db = getDb();
  res.json({ ok: true, agents: circuitBreaker.getAgentStatuses(db), ...circuitBreaker.getStatus() });
});

// API routes (auth handled inside each router)
app.use('/api/agents', agentsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/escrow', escrowRouter);
app.use('/api/verify', verifyRouter);
app.use('/api/admin', adminRouter);
app.use('/api/webhooks', webhooksRouter);

// Reputation endpoint (auth required)
const reputationValidation = [
  body('agent_id').isString().trim().notEmpty().withMessage('agent_id is required'),
  body('task_id').isString().trim().notEmpty().withMessage('task_id is required'),
  body('event').isIn(['completed', 'failed', 'disputed']).withMessage('event must be completed, failed, or disputed'),
  body('accuracy').optional().isFloat({ min: 0, max: 1 }).withMessage('accuracy must be 0-1'),
  body('speed_bonus').optional().isFloat({ min: 0, max: 1 }).withMessage('speed_bonus must be 0-1'),
];

app.post('/api/reputation/update', apiKeyAuth, reputationValidation, (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ ok: false, errors: errors.array() });

  const { agent_id, task_id, event, accuracy, speed_bonus } = req.body;

  if (circuitBreaker.isOpen()) {
    return res.status(503).json({ ok: false, error: 'Circuit breaker is open. System in cooldown.' });
  }

  const result = updateReputation(agent_id, task_id, event, { accuracy, speed_bonus });
  if (!result) return res.status(404).json({ ok: false, error: 'Agent not found' });

  if (event === 'failed') circuitBreaker.recordFailure(agent_id);
  else if (event === 'completed') circuitBreaker.recordSuccess(agent_id);

  res.json({ ok: true, ...result });
});

// Initialize DB on startup
getDb();

app.listen(PORT, () => {
  console.log(`ClawAgent MVP running on http://localhost:${PORT}`);
});

// MCPサーバーも一緒に起動（クラッシュしてもメインサーバーは継続）
try {
  require('./mcp-server');
} catch (err) {
  console.error('MCP server failed to start:', err.message);
}

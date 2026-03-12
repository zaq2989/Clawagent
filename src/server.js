const logger = require('./logger');

// Catch unhandled errors so Railway logs the cause before crash
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection', { reason: String(reason) });
  process.exit(1);
});

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { getDb, get: dbGet, USE_POSTGRES } = require('./db');
const { updateReputation } = require('./routes/reputation');
const { circuitBreaker } = require('./circuit');
const { apiKeyAuth } = require('./middleware/auth');
const { corsMiddleware } = require('./middleware/cors');

const tasksRouter = require('./routes/tasks');
const agentsRouter = require('./routes/agents');
const statsRouter = require('./routes/stats');
const escrowRouter = require('./routes/escrow');
const verifyRouter = require('./routes/verify');
const adminRouter = require('./routes/admin');
const webhooksRouter = require('./routes/webhooks');
const bountiesRouter = require('./routes/bounties');
const dnsRouter = require('./routes/dns');
const jobsRouter = require('./routes/jobs');
const federationRouter = require('./routes/federation');
const { checkPeerHealth } = require('./jobs/peerHealthCheck');
const { swaggerUi, swaggerSpec } = require('./swagger');

const app = express();
const PORT = process.env.PORT || 3750;

// Trust Railway's load balancer to get real client IP from X-Forwarded-For
app.set('trust proxy', 1);

// CORS
app.use(corsMiddleware);

// Security headers
app.use(helmet());

// Body parsing — explicit 1MB limit to prevent large payload DoS
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// x402 payment middleware — gating POST /api/tasks/create with 0.001 USDC (Base Sepolia)
try {
  const { createX402Middleware } = require('./x402');
  app.use(createX402Middleware());
  logger.info('[x402] Payment middleware enabled (Base Sepolia, 0.001 USDC per task)');
} catch (e) {
  logger.warn('[x402] Payment middleware disabled', { reason: e.message });
}

// Global rate limit: 200 req / 15 min per IP (real IP via X-Forwarded-For)
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || ipKeyGenerator(req),
  handler: (req, res) => res.status(429).json({
    error: 'Too many requests',
    retryAfter: Math.ceil(req.rateLimit.resetTime / 1000),
  }),
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

// Strict rate limiter for /call (proxy endpoint — expensive + SSRF surface)
const callLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || ipKeyGenerator(req),
  handler: (req, res) => res.status(429).json({
    error: 'Rate limit exceeded for /call endpoint',
    retryAfter: Math.ceil(req.rateLimit.resetTime / 1000),
    limit: 30,
    windowMs: 60000,
  }),
});

// Federation peer registration rate limiter (max 10 per IP per hour)
const federationPeerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || ipKeyGenerator(req),
  message: { ok: false, error: 'Federation peer registration rate limit exceeded. Try again later.' },
});

// Rate limiter for /api/guests (10 req/hour per IP)
const guestKeyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || ipKeyGenerator(req),
  message: { ok: false, error: 'Guest key rate limit exceeded. Try again later.' },
});

// POST /api/guests — issue a temporary guest API key (no auth required, for marketplace use)
app.post('/api/guests', guestKeyLimiter, (req, res) => {
  const crypto = require('crypto');
  const db = getDb();
  const id = crypto.randomUUID();
  const apiKey = crypto.randomUUID();
  const hashedKey = crypto.createHash('sha256').update(apiKey).digest('hex');
  const now = Date.now();
  const expiresAt = now + 24 * 60 * 60 * 1000; // 24 hours
  const name = `Guest-${id.slice(0, 8)}`;

  db.prepare(
    `INSERT INTO agents (id, name, type, capabilities, api_key, bond_amount, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, name, 'guest', JSON.stringify([]), hashedKey, 0, now);

  res.json({ ok: true, api_key: apiKey, expires_at: expiresAt });
});

// Apply specific rate limiters
app.post('/api/agents/register', registerLimiter);
app.post('/api/tasks/create', taskCreateLimiter);
app.post('/call', callLimiter);
// /call/async shares the same rate limit budget as /call to prevent bypass
app.post('/call/async', callLimiter);
app.post('/federation/peers', federationPeerLimiter);

// Swagger UI (public)
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Health check (public) — enhanced
app.get('/api/health', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    db: 'unknown',
    agentCount: 0,
    version: process.env.npm_package_version || '1.0.0',
  };

  try {
    const result = await dbGet('SELECT COUNT(*) as count FROM agents WHERE status = ?', ['active']);
    health.agentCount = Number(result?.count ?? 0);
    health.db = USE_POSTGRES ? 'postgres' : 'sqlite';
  } catch (e) {
    health.status = 'degraded';
    health.db = 'error';
    health.dbError = e.message;
    logger.error('Health check DB error', { error: e.message, code: e.code });
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
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

// Claw Network Agent DNS — GET /resolve?capability=...
app.use('/', dnsRouter);

// Claw Network Phase 5 — Federation
app.use('/federation', federationRouter);

// Async jobs — POST /call/async, GET /jobs/:id
app.use('/', jobsRouter);

// API routes (auth handled inside each router)
app.use('/api/agents', agentsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/stats', statsRouter);
app.use('/api/escrow', escrowRouter);
app.use('/api/verify', verifyRouter);
app.use('/api/admin', adminRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/bounties', bountiesRouter);

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

// Claw Network Phase 5 — peer health check every 5 minutes
setInterval(() => checkPeerHealth(getDb()), 5 * 60 * 1000);

// MCPルートをメインのExpressアプリに統合（listen前に登録）
try {
  const { createMcpRouter } = require('./mcp-server');
  createMcpRouter(app);
} catch (err) {
  logger.error('MCP router failed to mount', { error: err.message });
}

const HOST = process.env.RAILWAY_ENVIRONMENT ? '0.0.0.0' : '127.0.0.1';
app.listen(PORT, HOST, () => {
  logger.info('ClawAgent started', { port: PORT, host: HOST, db: USE_POSTGRES ? 'postgres' : 'sqlite' });
});

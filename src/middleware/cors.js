/**
 * CORS middleware configuration for ClawAgent.
 * Reads ALLOWED_ORIGIN from environment variables.
 * Default: '*' in development, should be set to specific domain in production.
 */

'use strict';

const cors = require('cors');

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

// Parse comma-separated origins if needed
function parseOrigin(raw) {
  if (!raw || raw === '*') return '*';
  const origins = raw.split(',').map(o => o.trim()).filter(Boolean);
  if (origins.length === 1) return origins[0];
  return origins;
}

const corsOptions = {
  origin: parseOrigin(ALLOWED_ORIGIN),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Requested-With'],
  exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  credentials: ALLOWED_ORIGIN !== '*', // credentials only when origin is specific
  maxAge: 86400, // 24h preflight cache
};

const corsMiddleware = cors(corsOptions);

module.exports = { corsMiddleware, corsOptions };

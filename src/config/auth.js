// src/config/auth.js — Shared authentication configuration
// Centralises ADMIN_TOKEN so all modules share the same value.

'use strict';

const crypto = require('crypto');

/**
 * ADMIN_TOKEN — must be set via environment variable in production.
 * If not set, a cryptographically random per-process token is generated,
 * making admin endpoints effectively inaccessible for that session.
 * This prevents accidental use of a predictable default.
 */
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || (() => {
  const t = crypto.randomBytes(32).toString('hex');
  console.warn(
    '[SECURITY WARNING] ADMIN_TOKEN env var is not set. ' +
    'Admin endpoints and reputation updates are locked for this process session.'
  );
  return t;
})();

module.exports = { ADMIN_TOKEN };

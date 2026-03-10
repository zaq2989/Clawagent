#!/usr/bin/env node
/**
 * scripts/register-paid-demo.js
 *
 * Registers ClawAgent's own x402-gated task endpoint as a Paid Provider
 * on the local Claw Network node.
 *
 * Usage:
 *   node scripts/register-paid-demo.js [--url http://localhost:3750]
 *
 * Env vars:
 *   ADMIN_TOKEN  — API key for the Claw Network admin routes (default: clawnet-admin)
 *   CLAW_URL     — Base URL of the Claw Network node   (default: http://localhost:3750)
 */

'use strict';

const BASE_URL   = process.env.CLAW_URL    || 'http://localhost:3750';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'clawnet-admin';

async function main() {
  console.log(`[register-paid-demo] Connecting to ${BASE_URL} …`);

  const payload = {
    name: 'ClawAgent Task Runner (Paid)',
    // The production endpoint that is gated by x402 middleware
    endpoint: 'https://clawagent-production.up.railway.app/api/tasks/create',
    capabilities: [
      'task.run.general',
      'task.run.coding',
      'task.run.research',
    ],
    pricing: {
      mode:          'per_call',
      price_per_call: 0.001,
      currency:      'USDC',
      network:       'base-sepolia',
    },
    description: 'General task execution via ClawAgent. Requires x402 payment (0.001 USDC on Base Sepolia).',
  };

  const res = await fetch(`${BASE_URL}/api/agents`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key':    ADMIN_TOKEN,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();

  if (res.ok) {
    console.log('[register-paid-demo] ✅ Registered successfully:');
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.error('[register-paid-demo] ❌ Registration failed:');
    console.error(JSON.stringify(data, null, 2));
    process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('[register-paid-demo] Fatal error:', err.message);
  process.exitCode = 1;
});

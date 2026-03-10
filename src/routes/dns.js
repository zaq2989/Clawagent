// src/routes/dns.js — Claw Network Agent DNS
// GET /resolve?capability=translate.text.en-ja
// POST /call

const express = require('express');
const { getDb } = require('../db');

const router = express.Router();

// Short name → canonical capability name mapping
const SHORT_NAMES = {
  'translate.en-ja':  'translate.text.en-ja',
  'translate.ja-en':  'translate.text.ja-en',
  'translate.en-zh':  'translate.text.en-zh',
  'summarize':        'summarize.text.longform',
  'summarize.short':  'summarize.text.shortform',
  'scrape':           'scrape.web.product',
  'market.crypto':    'analyze.market.crypto',
  'extract.invoice':  'extract.document.invoice',
  'extract.pdf':      'extract.document.pdf',
  'code.review':      'review.code.general',
  'code.security':    'review.code.security',
  'plan':             'plan.project.roadmap',
};

/**
 * Resolve a capability name, expanding short names to canonical form.
 * Returns { canonical, resolvedFrom } — resolvedFrom is set only if expansion happened.
 */
function resolveCapabilityName(raw) {
  if (SHORT_NAMES[raw]) {
    return { canonical: SHORT_NAMES[raw], resolvedFrom: raw };
  }
  return { canonical: raw, resolvedFrom: null };
}

/**
 * Score an agent provider for ranking.
 * score = reputation_score * 0.4 + success_rate * 100 * 0.4
 *         - price_per_call * 1000 * 0.1 - latency_ms / 100 * 0.1
 */
function calcScore(agent, pricing) {
  const rep   = agent.reputation_score || 50;
  const sr    = agent.success_rate     || 1.0;
  const price = pricing.price_per_call || 0;
  const lat   = agent.latency_ms       || 1000;
  return rep * 0.4 + sr * 100 * 0.4 - price * 1000 * 0.1 - lat / 100 * 0.1;
}

/**
 * Fetch and rank providers for a canonical capability name.
 * Optionally filter by budget (max price_per_call in ETH).
 */
function getProviders(capability, budget) {
  const db = getDb();

  const agents = db.prepare(
    "SELECT id, name, status, capabilities, pricing, reputation_score, success_rate, latency_ms, webhook_url FROM agents WHERE status = 'active'"
  ).all();

  const providers = [];

  for (const agent of agents) {
    let caps = [];
    try { caps = JSON.parse(agent.capabilities || '[]'); } catch (_) {}
    if (!Array.isArray(caps) || !caps.includes(capability)) continue;

    let pricing = {};
    try { pricing = JSON.parse(agent.pricing || '{}'); } catch (_) {}

    const pricePerCall = pricing.price_per_call || 0;

    // Skip if over budget
    if (budget != null && pricePerCall > budget) continue;

    const score = calcScore(agent, pricing);

    providers.push({
      agent_id:         agent.id,
      name:             agent.name,
      endpoint:         agent.webhook_url || null,
      price_per_call:   pricePerCall,
      currency:         pricing.currency || 'ETH',
      latency_ms:       agent.latency_ms        || 1000,
      reputation_score: agent.reputation_score  || 50,
      success_rate:     agent.success_rate      || 1.0,
      status:           agent.status,
      _score:           score,
    });
  }

  providers.sort((a, b) => b._score - a._score);
  return providers.map(({ _score, ...p }) => p);
}

// GET /resolve?capability=<name>
router.get('/resolve', (req, res) => {
  const { capability: raw } = req.query;
  if (!raw) {
    return res.status(400).json({ ok: false, error: 'capability query parameter is required' });
  }

  const { canonical, resolvedFrom } = resolveCapabilityName(raw);
  const providers = getProviders(canonical, null);

  const response = { capability: canonical, providers };
  if (resolvedFrom) response.resolved_from = resolvedFrom;

  res.json(response);
});

// POST /call
router.post('/call', async (req, res) => {
  const { capability: raw, input, budget, timeout_ms } = req.body;

  if (!raw) {
    return res.status(400).json({ ok: false, error: 'capability is required' });
  }

  const { canonical, resolvedFrom } = resolveCapabilityName(raw);
  const providers = getProviders(canonical, budget != null ? budget : null);

  if (providers.length === 0) {
    return res.status(404).json({
      ok: false,
      capability: canonical,
      ...(resolvedFrom && { resolved_from: resolvedFrom }),
      error: 'No providers found for this capability',
    });
  }

  const provider = providers[0];
  const baseResponse = {
    capability: canonical,
    ...(resolvedFrom && { resolved_from: resolvedFrom }),
    provider: {
      agent_id:      provider.agent_id,
      name:          provider.name,
      price_per_call: provider.price_per_call,
    },
  };

  // No endpoint — return resolved info without execution
  if (!provider.endpoint) {
    return res.json({
      ...baseResponse,
      output:   null,
      status:   'no_endpoint',
      message:  'Provider found but has no execution endpoint. Register an endpoint to enable direct execution.',
      resolved: true,
    });
  }

  // Forward to provider endpoint
  const timeoutMs = (typeof timeout_ms === 'number' && timeout_ms > 0) ? timeout_ms : 5000;
  const startMs = Date.now();

  let output, success;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const providerRes = await fetch(provider.endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ capability: canonical, input: input || {} }),
      signal:  controller.signal,
    });
    clearTimeout(timer);

    output = await providerRes.json();
    success = providerRes.ok;
  } catch (err) {
    const latency = Date.now() - startMs;
    // Fire-and-forget reputation update for failure
    _updateReputation(provider.agent_id, false, latency).catch(() => {});
    return res.status(502).json({
      ...baseResponse,
      output:  null,
      status:  err.name === 'AbortError' ? 'timeout' : 'error',
      message: err.name === 'AbortError' ? `Provider timed out after ${timeoutMs}ms` : err.message,
    });
  }

  const latency = Date.now() - startMs;

  // Fire-and-forget reputation update
  _updateReputation(provider.agent_id, success, latency).catch(() => {});

  res.json({
    ...baseResponse,
    output,
    latency_ms: latency,
    status: success ? 'success' : 'provider_error',
  });
});

/**
 * Internal helper: update provider reputation via self-call.
 */
async function _updateReputation(agentId, success, latency_ms) {
  const port = process.env.PORT || 3750;
  const adminToken = process.env.ADMIN_TOKEN || 'clawnet-admin';
  await fetch(`http://localhost:${port}/api/agents/${agentId}/reputation`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`,
    },
    body: JSON.stringify({ success, latency_ms }),
  });
}

module.exports = router;

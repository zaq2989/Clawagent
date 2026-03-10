// src/routes/dns.js — Claw Network Agent DNS
// GET /resolve?capability=translate.text.en-ja
// GET /search?q=translate+japanese
// POST /call

const express = require('express');
const { getDb } = require('../db');
const { BUILTINS } = require('../builtins');
const { checkSafeUrl } = require('../utils/ssrf');
const { ADMIN_TOKEN } = require('../config/auth');

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
  // Built-in short names
  'echo':             'echo.text',
  'detect.lang':      'detect.language',
  'sentiment':        'analyze.sentiment',
  'validate':         'validate.json',
  'format.md':        'format.markdown',
};

/**
 * Parse a raw capability string, splitting off an optional @version suffix.
 * e.g. "translate.text.en-ja@v2" → { name: "translate.text.en-ja", version: "v2" }
 *      "translate.text.en-ja"    → { name: "translate.text.en-ja", version: null }
 */
function parseCapability(raw) {
  const atIdx = raw.lastIndexOf('@');
  if (atIdx !== -1 && atIdx < raw.length - 1) {
    return { name: raw.slice(0, atIdx), version: raw.slice(atIdx + 1) };
  }
  return { name: raw, version: null };
}

/**
 * Resolve a capability name, expanding short names to canonical form.
 * Returns { canonical, resolvedFrom, version } — resolvedFrom is set only if expansion happened.
 */
function resolveCapabilityName(raw) {
  const { name, version } = parseCapability(raw);
  if (SHORT_NAMES[name]) {
    return { canonical: SHORT_NAMES[name], resolvedFrom: name, version };
  }
  return { canonical: name, resolvedFrom: null, version };
}

/**
 * Score an agent provider for ranking.
 * score = reputation_score * 0.35 + success_rate * 100 * 0.35
 *         - price_per_call * 1000 * 0.1 - latency_ms / 100 * 0.1
 *         + verified ? 10 : 0
 */
function calcScore(agent, pricing) {
  const rep      = agent.reputation_score || 50;
  const sr       = agent.success_rate     || 1.0;
  const price    = pricing.price_per_call || 0;
  const lat      = agent.latency_ms       || 1000;
  const verified = agent.verified         === 1 ? 10 : 0;
  return rep * 0.35 + sr * 100 * 0.35 - price * 1000 * 0.1 - lat / 100 * 0.1 + verified;
}

/**
 * Fetch and rank providers for a canonical capability name.
 * Optionally filter by budget (max price_per_call in ETH) and version string.
 * Returns { providers, cheapest } where cheapest is the cheapest overall (ignoring budget).
 */
function getProviders(capability, budget, version = null) {
  const db = getDb();

  const agents = db.prepare(
    "SELECT id, name, status, capabilities, pricing, reputation_score, success_rate, latency_ms, webhook_url, owner_address, verified, capability_version FROM agents WHERE status = 'active'"
  ).all();

  const allMatching = [];

  for (const agent of agents) {
    let caps = [];
    try { caps = JSON.parse(agent.capabilities || '[]'); } catch (_) {}
    if (!Array.isArray(caps) || !caps.includes(capability)) continue;

    // Capability version filtering
    const agentVersion = agent.capability_version || 'v1';
    if (version && agentVersion !== version) continue;

    let pricing = {};
    try { pricing = JSON.parse(agent.pricing || '{}'); } catch (_) {}

    const pricePerCall = pricing.price_per_call || 0;
    const score = calcScore(agent, pricing);

    allMatching.push({
      agent_id:           agent.id,
      name:               agent.name,
      endpoint:           agent.webhook_url || null,
      price_per_call:     pricePerCall,
      currency:           pricing.currency || 'ETH',
      latency_ms:         agent.latency_ms       || 1000,
      reputation_score:   agent.reputation_score || 50,
      success_rate:       agent.success_rate     || 1.0,
      status:             agent.status,
      verified:           agent.verified === 1,
      owner_address:      agent.owner_address || null,
      capability_version: agentVersion,
      _score:             score,
    });
  }

  allMatching.sort((a, b) => b._score - a._score);

  // Find overall cheapest (for budget_exceeded response)
  let cheapest = null;
  if (allMatching.length > 0) {
    cheapest = allMatching.reduce((min, p) => p.price_per_call < min.price_per_call ? p : min, allMatching[0]);
  }

  // Filter by budget
  const providers = budget != null
    ? allMatching.filter(p => p.price_per_call <= budget)
    : allMatching;

  return {
    providers: providers.map(({ _score, ...p }) => p),
    cheapest:  cheapest ? { provider: cheapest.name, price_per_call: cheapest.price_per_call } : null,
  };
}

/**
 * Score a capability name against a set of query keywords.
 * Scores domain/category/action parts + description field.
 */
function scoreCapability(capability, description, keywords) {
  const capLower = capability.toLowerCase();
  const descLower = (description || '').toLowerCase();
  const parts = capLower.split('.');  // [domain, category, action, ...]

  let score = 0;
  let matched = 0;

  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    let kwScore = 0;

    // Exact part match (higher weight)
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === kwLower) {
        kwScore += (i === 0 ? 0.3 : i === 1 ? 0.4 : 0.3);
      } else if (parts[i].includes(kwLower)) {
        kwScore += (i === 0 ? 0.15 : i === 1 ? 0.2 : 0.15);
      }
    }

    // Description match
    if (descLower.includes(kwLower)) {
      kwScore += 0.2;
    }

    if (kwScore > 0) matched++;
    score += kwScore;
  }

  // Normalize: scale by fraction of keywords matched
  if (keywords.length > 0 && matched > 0) {
    score = score * (matched / keywords.length);
  }

  return Math.min(1.0, score);
}

// GET /resolve?capability=<name>[@version]
router.get('/resolve', (req, res) => {
  const { capability: raw } = req.query;
  if (!raw) {
    return res.status(400).json({ ok: false, error: 'capability query parameter is required' });
  }

  const { canonical, resolvedFrom, version } = resolveCapabilityName(raw);
  const { providers } = getProviders(canonical, null, version);

  const response = { capability: canonical, providers };
  if (resolvedFrom) response.resolved_from = resolvedFrom;
  if (version) response.version = version;

  res.json(response);
});

// GET /search?q=<natural language query>
router.get('/search', (req, res) => {
  const { q } = req.query;
  if (!q || !q.trim()) {
    return res.status(400).json({ ok: false, error: 'q query parameter is required' });
  }

  const keywords = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const db = getDb();

  // Gather all unique capabilities from active agents
  const agents = db.prepare(
    "SELECT capabilities, pricing, reputation_score, success_rate, latency_ms, webhook_url, description, name, id FROM agents WHERE status = 'active'"
  ).all();

  const capMap = new Map(); // capability → { providers: [], description: '' }

  for (const agent of agents) {
    let caps = [];
    try { caps = JSON.parse(agent.capabilities || '[]'); } catch (_) {}
    if (!Array.isArray(caps)) continue;

    let pricing = {};
    try { pricing = JSON.parse(agent.pricing || '{}'); } catch (_) {}

    for (const cap of caps) {
      if (!capMap.has(cap)) {
        capMap.set(cap, { providers: [], description: agent.description || '' });
      }
      const entry = capMap.get(cap);
      entry.providers.push({
        agent_id:         agent.id,
        name:             agent.name,
        price_per_call:   pricing.price_per_call || 0,
        currency:         pricing.currency || 'ETH',
        reputation_score: agent.reputation_score || 50,
        success_rate:     agent.success_rate || 1.0,
        latency_ms:       agent.latency_ms || 1000,
      });
    }
  }

  // Also include built-in capabilities
  for (const builtinCap of Object.keys(BUILTINS)) {
    if (!capMap.has(builtinCap)) {
      capMap.set(builtinCap, { providers: [], description: 'Built-in capability' });
    }
  }

  // Score each capability
  const results = [];
  for (const [cap, { providers, description }] of capMap) {
    const score = scoreCapability(cap, description, keywords);
    if (score > 0) {
      results.push({ capability: cap, score: Math.round(score * 100) / 100, providers, description: description || undefined });
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  // Remove description if empty
  const clean = results.map(r => {
    const obj = { capability: r.capability, score: r.score, providers: r.providers };
    if (r.description) obj.description = r.description;
    return obj;
  });

  res.json({ query: q, results: clean });
});

/**
 * Core call logic — shared between POST /call and POST /call/async
 * @param {object} opts  { capability (raw), input, budget, timeout_ms, payerConfig }
 * @returns {Promise<{ status, output, provider, capability, resolved_from? }>}
 */
async function resolveAndCall({ capability: raw, input, budget, timeout_ms, payerConfig = null }) {
  if (!raw) throw Object.assign(new Error('capability is required'), { statusCode: 400 });

  const { canonical, resolvedFrom, version } = resolveCapabilityName(raw);
  const { providers, cheapest } = getProviders(canonical, budget != null ? budget : null, version);

  const baseInfo = {
    capability: canonical,
    ...(resolvedFrom && { resolved_from: resolvedFrom }),
    ...(version && { version }),
  };

  // Budget exceeded — no providers within budget
  if (providers.length === 0 && budget != null && cheapest) {
    const err = Object.assign(
      new Error(`No providers within budget of ${budget} ETH`),
      {
        statusCode: 402,
        body: {
          status: 'budget_exceeded',
          message: `No providers within budget of ${budget} ETH`,
          cheapest_available: cheapest,
          ...baseInfo,
        },
      }
    );
    throw err;
  }

  if (providers.length === 0) {
    // Try built-in before 404
    const builtinFn = BUILTINS[canonical];
    if (builtinFn) {
      const output = await builtinFn(input || {});
      return {
        ...baseInfo,
        provider: { agent_id: 'builtin', name: 'ClawBuiltin', price_per_call: 0 },
        output,
        status: 'builtin',
      };
    }
    const err = Object.assign(new Error('No providers found for this capability'), { statusCode: 404 });
    throw err;
  }

  const timeoutMs = (typeof timeout_ms === 'number' && timeout_ms > 0) ? timeout_ms : 5000;

  // Helper: fetch a provider endpoint with timeout, handling x402 payment if needed
  async function fetchWithTimeout(endpoint, capabilityName, inputData, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    const reqBody = JSON.stringify({ capability: capabilityName, input: inputData || {} });
    try {
      let providerRes = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    reqBody,
        signal:  controller.signal,
      });

      // x402 payment handling
      if (providerRes.status === 402 && payerConfig?.privateKey) {
        try {
          const { INTMAX402Client } = require('@tanakayuto/intmax402-client');
          const client = new INTMAX402Client({
            eth_private_key: payerConfig.privateKey,
            environment: payerConfig.environment || 'mainnet',
          });
          const wwwAuth = providerRes.headers.get('www-authenticate') || '';
          const authHeader = await client.createPaymentHeader(wwwAuth);
          providerRes = await fetch(endpoint, {
            method:  'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': authHeader,
            },
            body: reqBody,
            signal: controller.signal,
          });
        } catch (payErr) {
          console.warn(`[x402] Payment failed for ${endpoint}: ${payErr.message}`);
          // continue with the 402 response (caller will handle)
        }
      }

      clearTimeout(timer);
      return providerRes;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  let lastError = null;
  for (const provider of providers) {
    const providerInfo = {
      agent_id:       provider.agent_id,
      name:           provider.name,
      price_per_call: provider.price_per_call,
    };

    if (!provider.endpoint) {
      const builtinFn = BUILTINS[canonical];
      if (builtinFn) {
        const output = await builtinFn(input || {});
        return { ...baseInfo, provider: providerInfo, output, status: 'builtin' };
      }
      continue;
    }

    const ssrfCheck = checkSafeUrl(provider.endpoint);
    if (!ssrfCheck.safe) {
      console.error(`[SSRF BLOCKED] agent=${provider.agent_id} endpoint=${provider.endpoint} reason=${ssrfCheck.reason}`);
      continue;
    }

    const startMs = Date.now();
    try {
      const providerRes = await fetchWithTimeout(provider.endpoint, canonical, input, timeoutMs);
      const latency = Date.now() - startMs;
      const output = await providerRes.json();

      _updateReputation(provider.agent_id, providerRes.ok, latency).catch(() => {});

      return {
        ...baseInfo,
        provider: providerInfo,
        output,
        latency_ms: latency,
        status: providerRes.ok ? 'success' : 'provider_error',
      };
    } catch (err) {
      const latency = Date.now() - startMs;
      _updateReputation(provider.agent_id, false, latency).catch(() => {});
      lastError = err;
      console.warn(`[FALLBACK] provider=${provider.agent_id} failed (${err.name === 'AbortError' ? 'timeout' : err.message}), trying next...`);
      continue;
    }
  }

  // All providers failed — fall back to built-in
  const builtinFn = BUILTINS[canonical];
  if (builtinFn) {
    const output = await builtinFn(input || {});
    return {
      ...baseInfo,
      provider: { agent_id: 'builtin', name: 'ClawBuiltin', price_per_call: 0 },
      output,
      status: 'builtin_fallback',
      message: 'All registered providers failed; served by built-in.',
    };
  }

  const err = Object.assign(
    new Error(lastError?.name === 'AbortError' ? `All providers timed out after ${timeoutMs}ms` : (lastError?.message || 'All providers failed')),
    { statusCode: 502 }
  );
  throw err;
}

// POST /call
router.post('/call', async (req, res) => {
  const { capability: raw, input, budget, timeout_ms, payer } = req.body;

  if (!raw) {
    return res.status(400).json({ ok: false, error: 'capability is required' });
  }

  // Resolve payer private key from environment variable (never accept raw keys)
  let payerConfig = null;
  if (payer?.private_key_env) {
    const pk = process.env[payer.private_key_env];
    if (pk) {
      payerConfig = {
        privateKey:  pk,
        environment: payer.environment || 'mainnet',
      };
    }
  }

  try {
    const result = await resolveAndCall({ capability: raw, input, budget, timeout_ms, payerConfig });
    return res.json(result);
  } catch (err) {
    if (err.body) {
      return res.status(err.statusCode || 400).json(err.body);
    }
    return res.status(err.statusCode || 500).json({
      ok: false,
      error: err.message,
    });
  }
});

/**
 * Internal helper: update provider reputation via self-call.
 */
async function _updateReputation(agentId, success, latency_ms) {
  const port = process.env.PORT || 3750;
  await fetch(`http://localhost:${port}/api/agents/${agentId}/reputation`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ADMIN_TOKEN}`,
    },
    body: JSON.stringify({ success, latency_ms }),
  });
}

module.exports = router;
module.exports.resolveAndCall = resolveAndCall;

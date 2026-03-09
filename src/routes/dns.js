// src/routes/dns.js — Claw Network Agent DNS
// GET /resolve?capability=translate.text.en-ja

const express = require('express');
const { getDb } = require('../db');

const router = express.Router();

/**
 * Score an agent provider for ranking.
 * score = reputation_score * 0.4 + success_rate * 100 * 0.4
 *         - price_per_call * 1000 * 0.1 - latency_ms / 100 * 0.1
 */
function calcScore(agent, pricing) {
  const rep = agent.reputation_score || 50;
  const sr  = agent.success_rate   || 1.0;
  const price = pricing.price_per_call || 0;
  const lat = agent.latency_ms || 1000;
  return rep * 0.4 + sr * 100 * 0.4 - price * 1000 * 0.1 - lat / 100 * 0.1;
}

// GET /resolve?capability=<name>
router.get('/resolve', (req, res) => {
  const { capability } = req.query;
  if (!capability) {
    return res.status(400).json({ ok: false, error: 'capability query parameter is required' });
  }

  const db = getDb();

  // Fetch active agents and filter those whose capabilities JSON array contains the requested capability
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

    const score = calcScore(agent, pricing);

    providers.push({
      agent_id:         agent.id,
      name:             agent.name,
      endpoint:         agent.webhook_url || null,
      price_per_call:   pricing.price_per_call  || 0,
      currency:         pricing.currency        || 'ETH',
      latency_ms:       agent.latency_ms        || 1000,
      reputation_score: agent.reputation_score  || 50,
      success_rate:     agent.success_rate      || 1.0,
      status:           agent.status,
      _score:           score,
    });
  }

  // Sort descending by score
  providers.sort((a, b) => b._score - a._score);

  // Strip internal _score field
  const clean = providers.map(({ _score, ...p }) => p);

  res.json({ capability, providers: clean });
});

module.exports = router;

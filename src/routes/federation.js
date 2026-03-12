// src/routes/federation.js — Claw Network Phase 5: Federation
// POST /federation/peers  — register a peer node
// GET  /federation/peers  — list peer nodes
// DELETE /federation/peers/:id — ban a peer (admin only)
// GET  /federation/health — this node's health info

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { query, run, get } = require('../db');
const { ADMIN_TOKEN } = require('../config/auth');
const { checkSafeUrl } = require('../utils/ssrf');

const THIS_NODE_URL  = process.env.NODE_URL  || 'https://clawagent-production.up.railway.app';
const THIS_NODE_NAME = process.env.NODE_NAME || 'Claw Network Main';

// ─── Admin auth ────────────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const authHeader  = req.headers['authorization'] || '';
  const xAdminToken = req.headers['x-admin-token']  || '';
  const token = (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null) || xAdminToken || null;
  if (!token || token !== ADMIN_TOKEN) {
    return res.status(403).json({ ok: false, error: 'Unauthorized' });
  }
  next();
}

// ─── URL validation (SSRF guard) ───────────────────────────────────────────────
function validatePeerUrl(url) {
  const check = checkSafeUrl(url);
  if (!check.safe) {
    return { ok: false, error: check.reason || 'Private URLs not allowed' };
  }
  try {
    const parsed = new URL(url);
    return { ok: true, parsed };
  } catch (_) {
    return { ok: false, error: 'Invalid URL' };
  }
}

// ─── POST /federation/peers ─────────────────────────────────────────────────────
router.post('/peers', async (req, res) => {
  const { url, name, public_key } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url required' });

  const validation = validatePeerUrl(url);
  if (!validation.ok) return res.status(400).json({ error: validation.error });

  const cleanUrl = url.replace(/\/$/, '');

  try {
    // Reject duplicate URL registrations — prevents hijacking existing peer records
    const existing = await get('SELECT id FROM peers WHERE url = ?', [cleanUrl]);
    if (existing) {
      return res.status(409).json({ ok: false, error: 'Peer already registered', url: cleanUrl });
    }

    const id = crypto.randomUUID();
    await run(
      `INSERT INTO peers (id, url, name, public_key) VALUES (?, ?, ?, ?)`,
      [id, cleanUrl, name || '', public_key || null]
    );
    res.status(201).json({ ok: true, peer_id: id, url: cleanUrl, name: name || '' });
  } catch (e) {
    res.status(409).json({ ok: false, error: 'Peer already registered', url: cleanUrl });
  }
});

// ─── GET /federation/peers ──────────────────────────────────────────────────────
router.get('/peers', async (req, res) => {
  try {
    const peers = await query(
      "SELECT id, url, name, status, trust_score, last_seen FROM peers WHERE status != ?",
      ['banned']
    );

    res.json({
      ok: true,
      count: peers.length,
      peers,
      this_node: { url: THIS_NODE_URL, name: THIS_NODE_NAME },
    });
  } catch (err) {
    console.error('[federation/peers] Error:', err);
    res.status(500).json({ ok: false, error: 'Internal server error', detail: err.message });
  }
});

// ─── DELETE /federation/peers/:id (admin only) ─────────────────────────────────
router.delete('/peers/:id', requireAdmin, async (req, res) => {
  try {
    await run("UPDATE peers SET status = ? WHERE id = ?", ['banned', req.params.id]);
    // Note: For Postgres compatibility we can't easily check changes; assume success if no error
    res.json({ ok: true });
  } catch (err) {
    console.error('[federation/peers/:id DELETE] Error:', err);
    res.status(500).json({ ok: false, error: 'Internal server error', detail: err.message });
  }
});

// ─── GET /federation/health ─────────────────────────────────────────────────────
router.get('/health', async (req, res) => {
  try {
    const agentCountRow = await get('SELECT COUNT(*) as count FROM agents', []);
    const agentCount = agentCountRow?.count || 0;

    const capabilityCountRow = await get(
      `SELECT COUNT(DISTINCT value) as count FROM agents, json_each(agents.capabilities)`,
      []
    );
    const capabilityCount = capabilityCountRow?.count || 0;

    res.json({
      ok:           true,
      node:         THIS_NODE_URL,
      name:         THIS_NODE_NAME,
      agents:       agentCount,
      capabilities: capabilityCount,
      version:      '1.0.0',
      timestamp:    new Date().toISOString(),
    });
  } catch (err) {
    console.error('[federation/health] Error:', err);
    res.status(500).json({ ok: false, error: 'Internal server error', detail: err.message });
  }
});

module.exports = router;

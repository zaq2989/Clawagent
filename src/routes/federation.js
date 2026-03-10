// src/routes/federation.js — Claw Network Phase 5: Federation
// POST /federation/peers  — register a peer node
// GET  /federation/peers  — list peer nodes
// DELETE /federation/peers/:id — ban a peer (admin only)
// GET  /federation/health — this node's health info

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { getDb } = require('../db');
const { ADMIN_TOKEN } = require('../config/auth');

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
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return { ok: false, error: 'Invalid URL' };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, error: 'Invalid URL protocol' };
  }

  const blocked = ['localhost', '127.', '10.', '192.168.', '172.16.', '169.254.', '::1', '[::1]'];
  if (blocked.some(b => parsed.hostname === 'localhost' || parsed.hostname.startsWith(b))) {
    return { ok: false, error: 'Private URLs not allowed' };
  }

  return { ok: true, parsed };
}

// ─── POST /federation/peers ─────────────────────────────────────────────────────
router.post('/peers', (req, res) => {
  const { url, name, public_key } = req.body || {};
  if (!url) return res.status(400).json({ error: 'url required' });

  const validation = validatePeerUrl(url);
  if (!validation.ok) return res.status(400).json({ error: validation.error });

  const db = getDb();
  const cleanUrl = url.replace(/\/$/, '');

  // Reject duplicate URL registrations — prevents hijacking existing peer records
  const existing = db.prepare('SELECT id FROM peers WHERE url = ?').get(cleanUrl);
  if (existing) {
    return res.status(409).json({ ok: false, error: 'Peer already registered', url: cleanUrl });
  }

  const id = crypto.randomUUID();
  try {
    db.prepare(`INSERT INTO peers (id, url, name, public_key) VALUES (?, ?, ?, ?)`)
      .run(id, cleanUrl, name || '', public_key || null);
    res.status(201).json({ ok: true, peer_id: id, url: cleanUrl, name: name || '' });
  } catch (e) {
    res.status(409).json({ ok: false, error: 'Peer already registered', url: cleanUrl });
  }
});

// ─── GET /federation/peers ──────────────────────────────────────────────────────
router.get('/peers', (req, res) => {
  const db = getDb();
  const peers = db.prepare(
    "SELECT id, url, name, status, trust_score, last_seen FROM peers WHERE status != ?"
  ).all('banned');

  res.json({
    ok: true,
    count: peers.length,
    peers,
    this_node: { url: THIS_NODE_URL, name: THIS_NODE_NAME },
  });
});

// ─── DELETE /federation/peers/:id (admin only) ─────────────────────────────────
router.delete('/peers/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const info = db.prepare("UPDATE peers SET status = ? WHERE id = ?").run('banned', req.params.id);
  if (info.changes === 0) return res.status(404).json({ ok: false, error: 'Peer not found' });
  res.json({ ok: true });
});

// ─── GET /federation/health ─────────────────────────────────────────────────────
router.get('/health', (req, res) => {
  const db = getDb();
  const agentCount      = db.prepare('SELECT COUNT(*) as count FROM agents').get().count;
  const capabilityCount = db.prepare(
    `SELECT COUNT(DISTINCT value) as count FROM agents, json_each(agents.capabilities)`
  ).get()?.count || 0;

  res.json({
    ok:           true,
    node:         THIS_NODE_URL,
    name:         THIS_NODE_NAME,
    agents:       agentCount,
    capabilities: capabilityCount,
    version:      '1.0.0',
    timestamp:    new Date().toISOString(),
  });
});

module.exports = router;

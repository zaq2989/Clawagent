// src/jobs/peerHealthCheck.js — Claw Network Phase 5
// Periodically check peer node health and update their status in the DB.

/**
 * Check health of all non-banned peers and update their status.
 * @param {import('better-sqlite3').Database} db
 */
async function checkPeerHealth(db) {
  const peers = db.prepare(`SELECT id, url FROM peers WHERE status != 'banned'`).all();

  for (const peer of peers) {
    try {
      const r = await fetch(`${peer.url}/federation/health`, {
        signal: AbortSignal.timeout(3000),
      });

      if (r.ok) {
        db.prepare(
          `UPDATE peers SET status = 'active', last_seen = strftime('%s','now'), last_error = NULL WHERE id = ?`
        ).run(peer.id);
      } else {
        db.prepare(
          `UPDATE peers SET status = 'inactive', last_error = ? WHERE id = ?`
        ).run(`HTTP ${r.status}`, peer.id);
      }
    } catch (e) {
      db.prepare(
        `UPDATE peers SET status = 'inactive', last_error = ? WHERE id = ?`
      ).run(e.message.slice(0, 200), peer.id);
    }
  }
}

module.exports = { checkPeerHealth };

/**
 * demo/server.js — Agent B (Seller)
 * Runs an API server on port 3770 protected by intmax402 identity mode.
 * Agent A must authenticate with a signed Ethereum wallet to access /intelligence.
 */

import express from 'express'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

// intmax402-express is CJS, require() works fine
const { intmax402 } = require('@tanakayuto/intmax402-express')

const SECRET = 'clawagent-demo-secret-2026'
const PORT = 3770

const app = express()
app.use(express.json())

// ── Free endpoint (no auth) ──────────────────────────────────────────────────
app.get('/free', (req, res) => {
  res.json({
    message: 'Hello from Agent B! This endpoint is free.',
    agent: 'ClawAgent-B',
  })
})

// ── Protected endpoint (intmax402 identity mode) ─────────────────────────────
app.get(
  '/intelligence',
  intmax402({ mode: 'identity', secret: SECRET }),
  (req, res) => {
    const { address } = req.intmax402
    res.json({
      intelligence:
        '🔐 CLASSIFIED: The next frontier of AI is agent-to-agent commerce. ' +
        'Autonomous agents will negotiate, pay, and authenticate without human intervention.',
      accessedBy: address,
      timestamp: new Date().toISOString(),
      protocol: 'INTMAX402',
    })
  }
)

app.listen(PORT, () => {
  console.log(`Agent B listening on http://localhost:${PORT}`)
})

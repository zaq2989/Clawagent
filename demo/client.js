/**
 * demo/client.js — Agent A (Buyer)
 * Demonstrates an AI agent authenticating to Agent B's API via intmax402.
 * Uses a random Ethereum wallet — no pre-registration required.
 */

import { ethers } from 'ethers'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { INTMAX402Client } = require('@tanakayuto/intmax402-client')

const TARGET = 'http://localhost:3770'

async function main() {
  // ── Create a fresh random wallet (Agent A's identity) ──────────────────────
  const wallet = ethers.Wallet.createRandom()
  console.log(`\n🤖 Agent A initialized`)
  console.log(`   Wallet address : ${wallet.address}`)
  console.log(`   (ephemeral — generated fresh each run)\n`)

  const client = new INTMAX402Client({
    privateKey: wallet.privateKey,
    environment: 'testnet',
  })

  // ── Step 1: Hit free endpoint (should work without auth) ───────────────────
  console.log('📡 Step 0: GET /free (no auth required)')
  const freeRes = await fetch(`${TARGET}/free`)
  const freeData = await freeRes.json()
  console.log(`   → ${freeRes.status} OK`)
  console.log(`   → ${JSON.stringify(freeData)}\n`)

  // ── Step 1: First attempt at protected endpoint ────────────────────────────
  console.log('📡 Step 1: GET /intelligence (no auth)')
  const probe = await fetch(`${TARGET}/intelligence`)
  const probeBody = await probe.json()
  const wwwAuth = probe.headers.get('www-authenticate') || ''
  const noncePart = wwwAuth.match(/nonce="([^"]+)"/)?.[1] ?? '(see WWW-Authenticate header)'
  console.log(`   → ${probe.status} Unauthorized + INTMAX402 challenge`)
  console.log(`   → ${JSON.stringify(probeBody)}`)
  console.log(`   → nonce: ${noncePart.substring(0, 16)}...\n`)

  // ── Step 2: client.fetch() handles the challenge automatically ─────────────
  console.log(`🔐 Step 2: Signing challenge with wallet ${wallet.address.substring(0, 8)}...`)
  const res = await client.fetch(`${TARGET}/intelligence`)
  const data = await res.json()
  console.log(`   → Signed nonce & sent Authorization header\n`)

  // ── Step 3: Result ─────────────────────────────────────────────────────────
  if (res.status === 200) {
    console.log(`✅ Step 3: GET /intelligence + Authorization`)
    console.log(`   → ${res.status} OK`)
    console.log(`   → ${JSON.stringify(data, null, 2)}\n`)
    console.log('🎉 Demo complete! AI Agent authenticated via INTMAX402 protocol.')
  } else {
    console.error(`❌ Authentication failed: ${res.status}`)
    console.error(data)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})

/**
 * demo/client.js — Agent A (Buyer)
 * Cinematic terminal demo: AI agent authenticating via INTMAX402
 */
import { createRequire } from 'module'
import { ethers } from 'ethers'
import chalk from 'chalk'

const require = createRequire(import.meta.url)
const { INTMAX402Client } = require('@tanakayuto/intmax402-client')

const TARGET = 'http://localhost:3770'
const W = 50 // inner content width

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── UI primitives ─────────────────────────────────────────────────────────────

function banner() {
  const lines = [
    '  ClawAgent × intmax402  AI-to-AI Demo  ',
  ]
  const top = '╔' + '═'.repeat(W) + '╗'
  const bot = '╚' + '═'.repeat(W) + '╝'
  console.log(chalk.cyan.bold('\n' + top))
  for (const l of lines) {
    const padded = l.padEnd(W)
    console.log(chalk.cyan.bold('║') + chalk.bold.white(padded) + chalk.cyan.bold('║'))
  }
  console.log(chalk.cyan.bold(bot) + '\n')
}

function divider(step, label) {
  const line = '━'.repeat(W + 2)
  console.log('\n' + chalk.cyan.bold(line))
  console.log(chalk.cyan.bold(`  STEP ${step}  ${label}`))
  console.log(chalk.cyan.bold(line))
}

function ok(msg)   { console.log(chalk.green(`  ◉ ${msg}`)) }
function info(msg) { console.log(chalk.white(`  ${msg}`)) }
function dim(msg)  { console.log(chalk.dim(`  ${msg}`)) }

function trunc(str, n = 16) {
  return str && str.length > n ? str.slice(0, n) + '...' : str
}

/** Word-wrap text into lines of at most maxLen chars */
function wrap(text, maxLen) {
  const words = text.split(' ')
  const lines = []
  let cur = ''
  for (const w of words) {
    const candidate = cur ? cur + ' ' + w : w
    if (candidate.length > maxLen) {
      if (cur) lines.push(cur)
      cur = w
    } else {
      cur = candidate
    }
  }
  if (cur) lines.push(cur)
  return lines
}

function intelBox(data, wallet) {
  // Box inner width = W, outer: ┌ + W + ┐, content: │ + space + text + spaces + │
  const inner = W - 2 // usable text width inside the box
  const top = '  ┌' + '─'.repeat(W) + '┐'
  const bot = '  └' + '─'.repeat(W) + '┘'

  const row = (text, color = chalk.white) => {
    const stripped = text.replace(/\u001b\[[0-9;]*m/g, '')
    const pad = ' '.repeat(Math.max(0, inner - stripped.length))
    console.log(chalk.white('  │') + ' ' + color(text) + pad + chalk.white(' │'))
  }

  const rawText = (data.intelligence || '').replace(/^🔐\s*CLASSIFIED:\s*/i, '')
  const textLines = wrap(rawText, inner - 2) // -2 for leading space

  console.log(chalk.white(top))
  row('🔐 INTELLIGENCE REPORT', chalk.bold.white)
  row('')
  for (const l of textLines) row(`"${l}"`, chalk.white)
  row('')
  row(`Accessed by: ${trunc(data.accessedBy || wallet.address, 14)}`, chalk.dim)
  row(`Protocol:    ${data.protocol || 'INTMAX402'}`, chalk.dim)
  row(`Timestamp:   ${data.timestamp || new Date().toISOString()}`, chalk.dim)
  console.log(chalk.white(bot))
}

function footer(success) {
  const line = '═'.repeat(W + 2)
  console.log('\n' + chalk.cyan.bold(line))
  if (success) {
    console.log(chalk.green.bold('  ✅ DEMO COMPLETE'))
    console.log(chalk.white('  AI Agent autonomously authenticated via'))
    console.log(chalk.white('  INTMAX402 — ') + chalk.bold.yellow('zero human intervention.'))
  } else {
    console.log(chalk.red.bold('  ❌ DEMO FAILED'))
  }
  console.log(chalk.cyan.bold(line) + '\n')
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  banner()

  // Init
  console.log(chalk.bold('🤖 Initializing Agent A...'))
  await sleep(400)
  dim('├─ Generating ephemeral wallet...')
  await sleep(600)
  const wallet = ethers.Wallet.createRandom()
  info(`└─ Address: ${chalk.cyan(wallet.address)}`)
  await sleep(600)

  const client = new INTMAX402Client({
    privateKey: wallet.privateKey,
    environment: 'testnet',
  })

  // ── STEP 0 ──────────────────────────────────────────────────────────────────
  divider(0, 'Free endpoint (no auth)')
  await sleep(600)
  dim(`GET ${TARGET}/free`)
  await sleep(400)
  const r0 = await fetch(`${TARGET}/free`)
  const d0 = await r0.json()
  ok(`${r0.status} OK — "${d0.message}"`)
  await sleep(800)

  // ── STEP 1 ──────────────────────────────────────────────────────────────────
  divider(1, 'Protected endpoint — no credentials')
  await sleep(600)
  dim(`GET ${TARGET}/intelligence`)
  await sleep(400)
  const r1 = await fetch(`${TARGET}/intelligence`)
  await r1.json()
  const wwwAuth = r1.headers.get('www-authenticate') || ''
  const nonce = wwwAuth.match(/nonce="([^"]+)"/)?.[1] ?? '(unknown)'
  const mode  = wwwAuth.match(/mode="([^"]+)"/)?.[1] ?? 'identity'

  console.log(chalk.yellow(`  ◉ ${r1.status} Unauthorized`))
  await sleep(300)
  console.log(chalk.yellow('  ┌─ WWW-Authenticate: INTMAX402'))
  console.log(chalk.yellow(`  │  mode    : ${mode}`))
  console.log(chalk.yellow(`  │  nonce   : ${trunc(nonce, 16)}`))
  console.log(chalk.yellow('  └─ Challenge received ✓'))
  await sleep(800)

  // ── STEP 2 ──────────────────────────────────────────────────────────────────
  divider(2, 'Signing challenge')
  await sleep(600)
  dim('⏳ eth_sign(nonce)...')
  await sleep(700)
  const sig = await wallet.signMessage(nonce)
  ok(`Signature: ${trunc(sig, 16)} ✓`)
  await sleep(800)

  // ── STEP 3 ──────────────────────────────────────────────────────────────────
  divider(3, 'Authenticated request')
  await sleep(600)
  dim(`GET ${TARGET}/intelligence`)
  dim(`Authorization: INTMAX402 address="${trunc(wallet.address, 10)}" ...`)
  await sleep(400)

  const r3 = await client.fetch(`${TARGET}/intelligence`)
  const d3 = await r3.json()

  if (r3.status === 200) {
    ok(`${r3.status} OK`)
    await sleep(400)
    console.log()
    intelBox(d3, wallet)
    await sleep(600)
    footer(true)
  } else {
    console.log(chalk.red(`  ◉ ${r3.status} — Unexpected response`))
    console.error(d3)
    footer(false)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(chalk.red('Fatal error:'), err.message)
  process.exit(1)
})

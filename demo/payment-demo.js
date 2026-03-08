/**
 * payment-demo.js
 * Real INTMAX payment mode E2E test:
 *   Agent A pays Agent B using actual INTMAX L2 tokens
 *   Agent B verifies the payment on-chain before granting access
 */
// ─── Network Config ────────────────────────────────────────
// Default: Ethereum mainnet (INTMAX ZK L2 on Scroll)
//
// To use testnet (Sepolia):
//   Set environment: "testnet" and L1_RPC: "https://ethereum-sepolia-rpc.publicnode.com"
//   Fund Agent A on testnet via: https://sepoliafaucet.com
//   Then deposit to INTMAX testnet: https://intmax.io
// ──────────────────────────────────────────────────────────
//
// Usage:
//   1. Start the server:  node demo/payment-server.js
//   2. Run the demo:      CLIENT_PRIVATE_KEY=<key> node demo/payment-demo.js
import { createRequire } from "module"
import { ethers } from "ethers"
import chalk from "chalk"

const require = createRequire(import.meta.url)

const SERVER_URL = "http://localhost:3771"   // payment-mode server
const SERVER_PRIVATE_KEY = "0x36019839b1f5620dbbebc7225f2dbc6956a69f4a7cc1b0cd973baebc5ef5eec4"
const CLIENT_PRIVATE_KEY = process.env.CLIENT_PRIVATE_KEY  // agent A's key
const L1_RPC = "https://api.rpc.intmax.io?network=ethereum"

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

function divider(label) {
  console.log("\n" + chalk.cyan("━".repeat(52)))
  console.log(chalk.cyan.bold("  " + label))
  console.log(chalk.cyan("━".repeat(52)))
}

async function main() {
  const { INTMAX402Client } = require("@tanakayuto/intmax402-client")
  const { IntMaxNodeClient, TokenType } = require("intmax2-server-sdk/dist/index.js")

  console.clear()
  console.log(chalk.cyan("╔" + "═".repeat(52) + "╗"))
  console.log(chalk.cyan("║") + chalk.bold.white("  ClawAgent × intmax402 — PAYMENT MODE Demo       ") + chalk.cyan("║"))
  console.log(chalk.cyan("║") + chalk.dim("  Real INTMAX L2 ZK payment between AI agents     ") + chalk.cyan("║"))
  console.log(chalk.cyan("╚" + "═".repeat(52) + "╝"))
  await sleep(500)

  // === Agent B のINTMAXアドレス取得（サーバー側） ===
  divider("Setup: Agent B (Server) INTMAX Address")
  console.log("  " + chalk.dim("Logging in to INTMAX mainnet (Ethereum + Scroll L2)..."))
  const serverIntmax = new IntMaxNodeClient({
    environment: "mainnet",
    eth_private_key: SERVER_PRIVATE_KEY,
    l1_rpc_url: L1_RPC,
    loggerLevel: "warn",
  })
  await serverIntmax.login()
  const serverIntmaxAddress = serverIntmax.address
  const serverEthAddress = new ethers.Wallet(SERVER_PRIVATE_KEY).address
  console.log("  " + chalk.green("◉ Agent B ETH:    ") + chalk.yellow(serverEthAddress.slice(0, 18) + "..."))
  console.log("  " + chalk.green("◉ Agent B INTMAX: ") + chalk.yellow(serverIntmaxAddress.slice(0, 20) + "..."))
  await sleep(400)

  // === Agent A のセットアップ ===
  divider("Setup: Agent A (Client)")
  if (!CLIENT_PRIVATE_KEY) {
    console.error(chalk.red("  ❌ CLIENT_PRIVATE_KEY env not set"))
    console.error(chalk.dim("  Run: CLIENT_PRIVATE_KEY=<key> node demo/payment-demo.js"))
    process.exit(1)
  }
  const clientWallet = new ethers.Wallet(CLIENT_PRIVATE_KEY)
  const clientIntmax = new IntMaxNodeClient({
    environment: "mainnet",
    eth_private_key: CLIENT_PRIVATE_KEY,
    l1_rpc_url: L1_RPC,
    loggerLevel: "warn",
  })
  await clientIntmax.login()

  // バランス確認
  const { balances } = await clientIntmax.fetchTokenBalances()
  const ethBalance = balances.find(b => b.token?.symbol === "ETH")
  console.log("  " + chalk.green("◉ Agent A INTMAX: ") + chalk.yellow(clientIntmax.address.slice(0, 20) + "..."))
  console.log("  " + chalk.green("◉ ETH balance:    ") + chalk.white(ethBalance ? ethBalance.amount + " wei" : "0 (empty)"))

  if (!ethBalance || ethBalance.amount === 0n) {
    console.error(chalk.red("\n  ❌ Agent A has no INTMAX L2 balance"))
    console.error(chalk.dim("  Run deposit first to fund Agent A"))
    process.exit(1)
  }
  await sleep(400)

  // === STEP 1: 認証なしでアクセス → 402 Payment Required ===
  divider("STEP 1  Request protected endpoint (no auth)")
  console.log("  " + chalk.dim("GET " + SERVER_URL + "/premium-data"))
  const r1 = await fetch(SERVER_URL + "/premium-data")
  const d1 = await r1.json()
  const wwwAuth = r1.headers.get("www-authenticate") || ""
  const nonceMatch = wwwAuth.match(/nonce="([^"]+)"/)
  const amountMatch = wwwAuth.match(/amount="([^"]+)"/)
  const serverAddrMatch = wwwAuth.match(/serverAddress="([^"]+)"/)
  const nonce = nonceMatch?.[1] ?? "?"
  const amount = amountMatch?.[1] ?? "?"
  const serverAddr = serverAddrMatch?.[1] ?? serverIntmaxAddress

  console.log("  " + chalk.yellow("◉ 402 Payment Required"))
  console.log("  " + chalk.dim("┌─ INTMAX402 payment challenge:"))
  console.log("  " + chalk.dim("│  nonce         : " + nonce.slice(0, 16) + "..."))
  console.log("  " + chalk.dim("│  amount        : " + amount + " ETH"))
  console.log("  " + chalk.dim("│  serverAddress : " + serverAddr.slice(0, 20) + "..."))
  console.log("  " + chalk.dim("└─ Challenge received ✓"))
  await sleep(500)

  // === STEP 2: INTMAX L2で実際に支払い ===
  divider("STEP 2  Send INTMAX L2 payment")
  console.log("  " + chalk.dim("⏳ Broadcasting ZK transfer on INTMAX L2..."))

  const tokens = await clientIntmax.getTokensList()
  const eth = tokens.find(t => t.tokenIndex === 0)
  const payAmount = "0.0001"  // 0.0001 ETH

  const { transferDigest } = await clientIntmax.broadcastTransaction([{
    amount: payAmount,
    address: serverIntmaxAddress,
    token: { ...eth, tokenType: TokenType.NATIVE },
  }])

  console.log("  " + chalk.green("◉ Payment sent!"))
  console.log("  " + chalk.dim("  txHash : " + transferDigest.slice(0, 18) + "..."))
  console.log("  " + chalk.dim("  amount : " + payAmount + " ETH → Agent B"))
  await sleep(400)

  // === STEP 3: 署名 + txHash で認証リクエスト ===
  divider("STEP 3  Authenticated request with payment proof")
  const signature = await clientWallet.signMessage(nonce)
  const authHeader = `INTMAX402 address="${clientWallet.address}",nonce="${nonce}",signature="${signature}",txHash="${transferDigest}"`

  console.log("  " + chalk.dim("GET " + SERVER_URL + "/premium-data"))
  console.log("  " + chalk.dim("Authorization: INTMAX402 ... txHash=\"" + transferDigest.slice(0, 16) + "...\""))

  const r3 = await fetch(SERVER_URL + "/premium-data", {
    headers: { Authorization: authHeader },
  })
  const d3 = await r3.json()
  await sleep(300)

  if (r3.status === 200) {
    console.log("  " + chalk.green("◉ 200 OK — Access Granted!"))
    console.log("\n  " + chalk.white("╔" + "═".repeat(50) + "╗"))
    console.log("  " + chalk.white("║ " + chalk.bold("🔐 PREMIUM DATA") + "                                  ║"))
    console.log("  " + chalk.white("║                                                  ║"))
    console.log("  " + chalk.white('║  "' + (d3.data || "").slice(0, 46) + '  ║'))
    console.log("  " + chalk.white("║                                                  ║"))
    console.log("  " + chalk.dim("║  Paid by    : " + (d3.paidBy || "").slice(0, 14) + "...              ║"))
    console.log("  " + chalk.dim("║  Amount     : " + (d3.amount || "") + "                         ║"))
    console.log("  " + chalk.dim("║  Protocol   : INTMAX402 (ZK L2)                  ║"))
    console.log("  " + chalk.white("╚" + "═".repeat(50) + "╝"))
  } else {
    console.log("  " + chalk.red("◉ " + r3.status + " — " + JSON.stringify(d3)))
  }

  console.log("\n" + chalk.green("═".repeat(54)))
  console.log(chalk.green.bold("  ✅ PAYMENT MODE DEMO COMPLETE"))
  console.log(chalk.white("  AI Agent paid another AI Agent using INTMAX ZK L2"))
  console.log(chalk.white("  Network: INTMAX mainnet (Ethereum + Scroll L2)"))
  console.log(chalk.bold.yellow("  Zero human intervention. Zero gas on L2."))
  console.log(chalk.green("═".repeat(54)) + "\n")
}

main().catch(e => {
  console.error(chalk.red("\n❌ Error: " + e.message))
  process.exit(1)
})

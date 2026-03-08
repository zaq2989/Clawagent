/**
 * payment-server.js — Agent B (Seller)
 * intmax402 payment mode server — verifies real INTMAX L2 payments
 */
// ─── Network Config ────────────────────────────────────────
// Default: Ethereum mainnet (chainId=1, L2: Scroll 534352)
//
// To use testnet (Sepolia):
//   1. Set environment: "testnet"
//   2. Set L1_RPC: "https://ethereum-sepolia-rpc.publicnode.com"
//   3. Set chainId: "11155111"
//   4. Fund wallet on Sepolia: https://sepoliafaucet.com
// ──────────────────────────────────────────────────────────
import { createRequire } from "module"
import chalk from "chalk"

const require = createRequire(import.meta.url)
const express = require("express")

const PORT = 3771
const SECRET = "payment-demo-secret-2026"
const SERVER_PRIVATE_KEY = "0x36019839b1f5620dbbebc7225f2dbc6956a69f4a7cc1b0cd973baebc5ef5eec4"
const L1_RPC = "https://api.rpc.intmax.io?network=ethereum"
const PRICE_ETH = "0.0001"  // 0.0001 ETH per request

async function main() {
  const { intmax402, initPaymentVerifier, getPaymentVerifierAddress } = await import("@tanakayuto/intmax402-express")

  // INTMAX payment verifier を初期化
  console.log(chalk.dim("  Initializing INTMAX payment verifier..."))
  await initPaymentVerifier({
    eth_private_key: SERVER_PRIVATE_KEY,
    environment: "mainnet",
    l1_rpc_url: L1_RPC,
  })
  const intmaxAddress = getPaymentVerifierAddress()

  const app = express()

  // Free endpoint
  app.get("/free", (_req, res) => {
    res.json({ message: "Free access. No payment needed.", agent: "ClawAgent-B" })
  })

  // Payment-protected endpoint
  app.get(
    "/premium-data",
    intmax402({
      mode: "payment",
      secret: SECRET,
      serverAddress: intmaxAddress,
      amount: PRICE_ETH,
      tokenAddress: "0x0000000000000000000000000000000000000000",
      chainId: "1",
    }),
    (req, res) => {
      res.json({
        data: "🔐 CLASSIFIED: AI agents can now autonomously pay each other using INTMAX ZK L2.",
        paidBy: req.intmax402?.address,
        amount: PRICE_ETH + " ETH",
        timestamp: new Date().toISOString(),
        protocol: "INTMAX402",
        network: "INTMAX mainnet (Ethereum + Scroll L2)",
      })
    }
  )

  app.listen(PORT, () => {
    console.log(chalk.cyan("╔" + "═".repeat(52) + "╗"))
    console.log(chalk.cyan("║") + chalk.bold.white("  Agent B — INTMAX402 Payment Mode Server         ") + chalk.cyan("║"))
    console.log(chalk.cyan("╚" + "═".repeat(52) + "╝"))
    console.log(chalk.dim("  Port          : ") + chalk.white(PORT))
    console.log(chalk.dim("  Mode          : ") + chalk.yellow("payment"))
    console.log(chalk.dim("  Price         : ") + chalk.white(PRICE_ETH + " ETH per request"))
    console.log(chalk.dim("  INTMAX addr   : ") + chalk.yellow(intmaxAddress.slice(0, 20) + "..."))
    console.log("")
    console.log(chalk.dim("  Endpoints:"))
    console.log(chalk.dim("  ├─ GET /free          ") + chalk.green("(open)"))
    console.log(chalk.dim("  └─ GET /premium-data  ") + chalk.yellow("(🔐 INTMAX402 payment)"))
    console.log("")
    console.log(chalk.dim("  Waiting for payment requests..."))
  })
}

main().catch(e => {
  console.error(chalk.red("❌ Error: " + e.message))
  process.exit(1)
})

/**
 * demo/server.js — Agent B (Seller)
 * INTMAX402-protected API server
 */
import { createRequire } from "module"
import chalk from "chalk"

const require = createRequire(import.meta.url)
const express = require("express")

const PORT = 3770
const SECRET = "clawagent-demo-secret-2026"

async function main() {
  const { intmax402 } = await import("@tanakayuto/intmax402-express")
  const app = express()

  // Free endpoint
  app.get("/free", (_req, res) => {
    res.json({ message: "Hello from Agent B! This endpoint is free.", agent: "ClawAgent-B" })
  })

  // Protected endpoint
  app.get(
    "/intelligence",
    intmax402({ mode: "identity", secret: SECRET }),
    (req, res) => {
      res.json({
        intelligence: "🔐 CLASSIFIED: The next frontier of AI is agent-to-agent commerce. Autonomous agents will negotiate, pay, and authenticate without human intervention.",
        accessedBy: req.intmax402?.address,
        timestamp: new Date().toISOString(),
        protocol: "INTMAX402",
      })
    }
  )

  app.listen(PORT, () => {
    console.log(chalk.cyan("╔" + "═".repeat(50) + "╗"))
    console.log(chalk.cyan("║") + chalk.bold.white("  Agent B — INTMAX402 Protected API              ") + chalk.cyan("║"))
    console.log(chalk.cyan("╚" + "═".repeat(50) + "╝"))
    console.log(chalk.dim("  Port    : ") + chalk.white(PORT))
    console.log(chalk.dim("  Mode    : ") + chalk.white("identity"))
    console.log(chalk.dim("  Secret  : ") + chalk.white(SECRET))
    console.log("")
    console.log(chalk.dim("  Endpoints:"))
    console.log(chalk.dim("  ├─ GET /free          ") + chalk.green("(open)"))
    console.log(chalk.dim("  └─ GET /intelligence  ") + chalk.yellow("(🔐 INTMAX402 identity)"))
    console.log("")
    console.log(chalk.dim("  Waiting for connections..."))
  })
}

main().catch((err) => {
  console.error(chalk.red("Error: " + err.message))
  process.exit(1)
})

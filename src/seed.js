// src/seed.js - Auto-seed agents on startup
// Uses SELECT-before-INSERT since agents.name has no UNIQUE constraint
const crypto = require('crypto');

const DEFAULT_PRICING = { mode: 'per_call', price_per_call: 0.001, currency: 'ETH' };

const SEED_AGENTS = [
  {
    name: 'Scout',
    type: 'ai',
    capabilities: ['scrape.web.product', 'scrape.web.news', 'detect.language'],
    bond: 100, rep: 65,
  },
  {
    name: 'Analyst',
    type: 'ai',
    capabilities: ['analyze.market.crypto', 'analyze.data.general', 'analyze.sentiment'],
    bond: 120, rep: 72,
  },
  {
    name: 'Researcher',
    type: 'ai',
    capabilities: ['summarize.text.longform', 'extract.document.invoice', 'validate.json'],
    bond: 150, rep: 78,
  },
  {
    name: 'Writer',
    type: 'ai',
    capabilities: ['translate.text.en-ja', 'summarize.text.shortform', 'format.markdown'],
    bond: 100, rep: 71,
  },
  {
    name: 'Coder',
    type: 'ai',
    capabilities: ['review.code.general', 'generate.code.snippet'],
    bond: 200, rep: 85,
  },
  {
    name: 'DataAnalyst',
    type: 'ai',
    capabilities: ['analyze.data.csv', 'analyze.data.timeseries'],
    bond: 180, rep: 82,
  },
  {
    name: 'SecurityAuditor',
    type: 'ai',
    capabilities: ['review.code.security', 'review.legal.contract'],
    bond: 250, rep: 90,
  },
  {
    name: 'Translator',
    type: 'ai',
    capabilities: ['translate.text.en-ja', 'translate.text.ja-en', 'translate.text.en-zh'],
    bond: 80,  rep: 75,
  },
  {
    name: 'Planner',
    type: 'ai',
    capabilities: ['plan.project.roadmap', 'plan.task.breakdown'],
    bond: 120, rep: 80,
  },
  {
    name: 'Scraper',
    type: 'ai',
    capabilities: ['scrape.web.ecommerce', 'extract.document.pdf', 'detect.language', 'scrape.web.product'],
    bond: 80,  rep: 58,
  },
];

function seedAgents(db) {
  const existsStmt  = db.prepare('SELECT id FROM agents WHERE name = ? LIMIT 1');
  const insertStmt  = db.prepare(`
    INSERT INTO agents (id, name, type, capabilities, pricing, input_schema, output_schema, bond_amount, reputation_score, success_rate, latency_ms, call_count, status, created_at, webhook_url)
    VALUES (?, ?, ?, ?, ?, '{}', '{}', ?, ?, 1.0, 1000, 0, 'active', ?, '')
  `);
  const updateStmt  = db.prepare(`
    UPDATE agents SET capabilities = ?, pricing = ? WHERE name = ?
  `);

  let inserted = 0;
  let updated  = 0;

  for (const agent of SEED_AGENTS) {
    const capsJson   = JSON.stringify(agent.capabilities);
    const pricingJson = JSON.stringify(DEFAULT_PRICING);
    const row = existsStmt.get(agent.name);
    if (!row) {
      insertStmt.run(
        crypto.randomUUID(),
        agent.name,
        agent.type,
        capsJson,
        pricingJson,
        agent.bond,
        agent.rep,
        Date.now()
      );
      inserted++;
    } else {
      // Update capabilities & pricing to Claw Network format
      updateStmt.run(capsJson, pricingJson, agent.name);
      updated++;
    }
  }

  if (inserted > 0) console.log(`[seed] ${inserted} agents inserted`);
  if (updated  > 0) console.log(`[seed] ${updated} agents updated with Claw Network capabilities`);
  if (inserted === 0 && updated === 0) console.log('[seed] No changes needed');

  const total = db.prepare('SELECT COUNT(*) as c FROM agents').get().c;
  console.log(`[seed] Total agents in DB: ${total}`);
}

module.exports = { seedAgents };

// src/seed.js - Auto-seed agents on startup
// Uses SELECT-before-INSERT since agents.name has no UNIQUE constraint
const crypto = require('crypto');

const SEED_AGENTS = [
  { name: 'Scout',           type: 'ai', capabilities: ['osint','search','reconnaissance'],                                          bond: 100, rep: 65 },
  { name: 'Scraper',         type: 'ai', capabilities: ['web_scraping','data_extraction','crawling'],                                bond: 80,  rep: 58 },
  { name: 'Analyst',         type: 'ai', capabilities: ['analysis','reporting','data_processing'],                                   bond: 120, rep: 72 },
  { name: 'Coder',           type: 'ai', capabilities: ['code_generation','debugging','code_review','refactoring'],                  bond: 200, rep: 85 },
  { name: 'Researcher',      type: 'ai', capabilities: ['web_research','fact_checking','literature_review','summarization'],         bond: 150, rep: 78 },
  { name: 'Writer',          type: 'ai', capabilities: ['content_writing','copywriting','translation','proofreading'],               bond: 100, rep: 71 },
  { name: 'DataAnalyst',     type: 'ai', capabilities: ['data_analysis','visualization','statistics','reporting'],                   bond: 180, rep: 82 },
  { name: 'SecurityAuditor', type: 'ai', capabilities: ['security_audit','penetration_testing','vulnerability_assessment','compliance'], bond: 250, rep: 90 },
  { name: 'Translator',      type: 'ai', capabilities: ['translation','localization','multilingual','japanese','english'],           bond: 80,  rep: 75 },
  { name: 'Planner',         type: 'ai', capabilities: ['project_planning','task_breakdown','scheduling','coordination'],            bond: 120, rep: 80 },
];

function seedAgents(db) {
  const exists = db.prepare('SELECT id FROM agents WHERE name = ? LIMIT 1');
  const insert = db.prepare(`
    INSERT INTO agents (id, name, type, capabilities, bond_amount, reputation_score, status, created_at, webhook_url)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, '')
  `);

  let count = 0;
  for (const agent of SEED_AGENTS) {
    const row = exists.get(agent.name);
    if (!row) {
      const id = crypto.randomUUID();
      insert.run(
        id,
        agent.name,
        agent.type,
        JSON.stringify(agent.capabilities),
        agent.bond,
        agent.rep,
        Date.now()
      );
      count++;
    }
  }

  if (count > 0) {
    console.log(`[seed] ${count} agents seeded`);
  } else {
    console.log('[seed] All agents already exist');
  }
}

module.exports = { seedAgents };

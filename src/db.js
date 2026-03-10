const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const uuidv4 = () => require('crypto').randomUUID();

function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

const { seedAgents } = require('./seed');

const DB_PATH = path.join(__dirname, '..', 'clawagent.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
    migrate();
    seedAgents(db);
    seedIfEmpty();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT,
      type TEXT,
      capabilities TEXT,
      api_key TEXT UNIQUE,
      bond_amount REAL DEFAULT 0,
      bond_locked REAL DEFAULT 0,
      reputation_score REAL DEFAULT 50,
      tasks_completed INTEGER DEFAULT 0,
      tasks_failed INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      depth INTEGER DEFAULT 0,
      category TEXT,
      intent TEXT,
      input_schema TEXT,
      input_data TEXT,
      output_contract TEXT,
      success_criteria TEXT,
      deadline_sec INTEGER,
      max_cost REAL,
      payment_amount REAL,
      payment_locked INTEGER DEFAULT 0,
      issuer_id TEXT,
      worker_id TEXT,
      status TEXT DEFAULT 'open',
      result TEXT,
      created_at INTEGER,
      assigned_at INTEGER,
      completed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS escrow (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      amount REAL,
      holder TEXT,
      status TEXT,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS reputation_log (
      id TEXT PRIMARY KEY,
      agent_id TEXT,
      task_id TEXT,
      event TEXT,
      score_delta REAL,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS bounties (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      required_skill TEXT NOT NULL,
      budget REAL DEFAULT 0,
      status TEXT DEFAULT 'open',
      posted_by TEXT,
      claimed_by TEXT,
      result TEXT,
      expires_at INTEGER,
      created_at INTEGER
    );
  `);
}

function migrate() {
  const cols = db.prepare("PRAGMA table_info(agents)").all();
  const colNames = cols.map(c => c.name);

  // Add api_key column if missing (for existing databases)
  if (!colNames.includes('api_key')) {
    db.exec('ALTER TABLE agents ADD COLUMN api_key TEXT UNIQUE');
    // Generate api_keys for existing agents that don't have one
    const agents = db.prepare('SELECT id FROM agents WHERE api_key IS NULL').all();
    const update = db.prepare('UPDATE agents SET api_key = ? WHERE id = ?');
    for (const a of agents) {
      update.run(hashKey(uuidv4()), a.id);
    }
  }

  // Add webhook_url column if missing
  if (!colNames.includes('webhook_url')) {
    db.exec('ALTER TABLE agents ADD COLUMN webhook_url TEXT');
  }

  // Claw Network Phase 1 — capability addressing columns
  if (!colNames.includes('pricing')) {
    db.exec("ALTER TABLE agents ADD COLUMN pricing TEXT DEFAULT '{}'");
  }
  if (!colNames.includes('input_schema')) {
    db.exec("ALTER TABLE agents ADD COLUMN input_schema TEXT DEFAULT '{}'");
  }
  if (!colNames.includes('output_schema')) {
    db.exec("ALTER TABLE agents ADD COLUMN output_schema TEXT DEFAULT '{}'");
  }
  if (!colNames.includes('success_rate')) {
    db.exec('ALTER TABLE agents ADD COLUMN success_rate REAL DEFAULT 1.0');
  }
  if (!colNames.includes('latency_ms')) {
    db.exec('ALTER TABLE agents ADD COLUMN latency_ms INTEGER DEFAULT 1000');
  }
  if (!colNames.includes('call_count')) {
    db.exec('ALTER TABLE agents ADD COLUMN call_count INTEGER DEFAULT 0');
  }

  // Claw Network Phase 3 — description for semantic search
  if (!colNames.includes('description')) {
    db.exec("ALTER TABLE agents ADD COLUMN description TEXT DEFAULT ''");
  }
}

function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) as c FROM agents').get().c;
  if (count > 0) return;

  const now = Date.now();

  const agents = [
    { id: uuidv4(), name: 'Scout', type: 'ai', capabilities: JSON.stringify(['osint', 'search', 'reconnaissance']), bond_amount: 100, reputation_score: 65, created_at: now },
    { id: uuidv4(), name: 'Scraper', type: 'ai', capabilities: JSON.stringify(['web_scraping', 'data_collection', 'parsing']), bond_amount: 80, reputation_score: 58, created_at: now },
    { id: uuidv4(), name: 'Analyst', type: 'ai', capabilities: JSON.stringify(['analysis', 'reporting', 'data_processing']), bond_amount: 120, reputation_score: 72, created_at: now },
  ];

  const insertAgent = db.prepare(`INSERT INTO agents (id, name, type, capabilities, bond_amount, reputation_score, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  for (const a of agents) {
    insertAgent.run(a.id, a.name, a.type, a.capabilities, a.bond_amount, a.reputation_score, a.created_at);
  }

  const sampleTasks = [
    { category: 'osint', intent: 'Find public financial data for company X', max_cost: 50, payment_amount: 40, input_schema: '{}', success_criteria: JSON.stringify({ rules: [{ field: 'data', op: 'exists' }] }) },
    { category: 'web_scraping', intent: 'Scrape product listings from marketplace Y', max_cost: 30, payment_amount: 25, input_schema: '{}', success_criteria: JSON.stringify({ rules: [{ field: 'items', op: 'min_length', value: 10 }] }) },
    { category: 'analysis', intent: 'Analyze sentiment of social media posts', max_cost: 60, payment_amount: 50, input_schema: '{}', success_criteria: JSON.stringify({ rules: [{ field: 'sentiment_score', op: 'exists' }] }) },
    { category: 'data_collection', intent: 'Collect weather data for 10 cities', max_cost: 20, payment_amount: 15, input_schema: '{}', success_criteria: JSON.stringify({ rules: [{ field: 'cities', op: 'min_length', value: 10 }] }) },
    { category: 'reporting', intent: 'Generate quarterly sales report', max_cost: 80, payment_amount: 70, input_schema: '{}', success_criteria: JSON.stringify({ rules: [{ field: 'report', op: 'exists' }] }) },
  ];

  const insertTask = db.prepare(`INSERT INTO tasks (id, category, intent, max_cost, payment_amount, input_schema, success_criteria, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`);
  for (const t of sampleTasks) {
    insertTask.run(uuidv4(), t.category, t.intent, t.max_cost, t.payment_amount, t.input_schema, t.success_criteria, now);
  }

  // Seed sample bounties
  const sampleBounties = [
    {
      title: "Summarize today's top AI news",
      description: "Search and summarize the top 5 AI-related news articles published today. Include source URLs.",
      required_skill: "web_research",
      budget: 2.0,
      expires_at: now + 86400000 * 7
    },
    {
      title: "Code review: Node.js REST API",
      description: "Review a Node.js Express API for security issues, performance bottlenecks, and best practices. Provide a detailed report.",
      required_skill: "code_review",
      budget: 10.0,
      expires_at: now + 86400000 * 3
    },
    {
      title: "Translate README to Japanese",
      description: "Translate a GitHub README (English, ~500 words) to natural Japanese. Maintain technical terms in English.",
      required_skill: "translation",
      budget: 3.0,
      expires_at: now + 86400000 * 5
    }
  ];

  const insertBounty = db.prepare(`INSERT INTO bounties (id, title, description, required_skill, budget, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`);
  for (const b of sampleBounties) {
    insertBounty.run(uuidv4(), b.title, b.description, b.required_skill, b.budget, b.expires_at, now);
  }
}

module.exports = { getDb };

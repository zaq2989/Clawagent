const crypto = require('crypto');
const path = require('path');

const uuidv4 = () => crypto.randomUUID();

function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

const { seedAgents } = require('./seed');

// ─── Backend selection ────────────────────────────────────────────────────────
const USE_POSTGRES = !!process.env.DATABASE_URL;

// ─── SQLite setup (default / local dev) ──────────────────────────────────────
let sqliteDb;

function getSqliteDb() {
  if (!sqliteDb) {
    const Database = require('better-sqlite3');
    const DB_PATH = process.env.RAILWAY_ENVIRONMENT
      ? '/app/data/clawagent.db'
      : path.join(__dirname, '..', 'clawagent.db');
    sqliteDb = new Database(DB_PATH);
    sqliteDb.pragma('journal_mode = WAL');
    sqliteDb.pragma('foreign_keys = ON');
  }
  return sqliteDb;
}

// ─── PostgreSQL setup ─────────────────────────────────────────────────────────
let pgClient;

async function getPgClient() {
  if (!pgClient) {
    const { Client } = require('pg');
    pgClient = new Client({ connectionString: process.env.DATABASE_URL });
    await pgClient.connect();
  }
  return pgClient;
}

// ─── Unified async query helpers ──────────────────────────────────────────────

/**
 * Convert SQLite `?` placeholders to PostgreSQL `$1, $2, …`
 */
function toPostgresParams(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/**
 * SELECT multiple rows → Array
 */
async function query(sql, params = []) {
  if (USE_POSTGRES) {
    const client = await getPgClient();
    const result = await client.query(toPostgresParams(sql), params);
    return result.rows;
  }
  return getSqliteDb().prepare(sql).all(...params);
}

/**
 * INSERT / UPDATE / DELETE (no return value)
 */
async function run(sql, params = []) {
  if (USE_POSTGRES) {
    const client = await getPgClient();
    await client.query(toPostgresParams(sql), params);
  } else {
    getSqliteDb().prepare(sql).run(...params);
  }
}

/**
 * SELECT single row → Object | null
 */
async function get(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

// ─── Schema & migration (async-safe) ─────────────────────────────────────────

async function initSchema() {
  const ddl = `
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

    CREATE TABLE IF NOT EXISTS peers (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL UNIQUE,
      name TEXT DEFAULT '',
      status TEXT DEFAULT 'active',
      trust_score REAL DEFAULT 50.0,
      registered_at INTEGER DEFAULT (EXTRACT(EPOCH FROM NOW())::INTEGER),
      last_seen INTEGER DEFAULT NULL,
      last_error TEXT DEFAULT NULL,
      public_key TEXT DEFAULT NULL
    );
  `;

  if (USE_POSTGRES) {
    // PostgreSQL: run each statement individually (no multi-statement exec)
    const client = await getPgClient();
    // Use SQLite-compatible peers DDL for PG by replacing the default expression
    const pgDdl = ddl.replace(
      "DEFAULT (EXTRACT(EPOCH FROM NOW())::INTEGER)",
      "DEFAULT (EXTRACT(EPOCH FROM NOW())::INTEGER)"
    );
    // Split on semicolons and execute each non-empty statement
    const stmts = pgDdl.split(';').map(s => s.trim()).filter(Boolean);
    for (const stmt of stmts) {
      await client.query(stmt);
    }
  } else {
    // SQLite: restore original default for peers
    const sqliteDdl = ddl.replace(
      "DEFAULT (EXTRACT(EPOCH FROM NOW())::INTEGER)",
      "DEFAULT (strftime('%s','now'))"
    );
    getSqliteDb().exec(sqliteDdl);
  }
}

async function migrate() {
  if (USE_POSTGRES) {
    // PostgreSQL: use information_schema to check columns
    const client = await getPgClient();
    const { rows } = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'agents'`
    );
    const colNames = rows.map(r => r.column_name);

    const addIfMissing = async (col, definition) => {
      if (!colNames.includes(col)) {
        await client.query(`ALTER TABLE agents ADD COLUMN ${col} ${definition}`);
      }
    };

    await addIfMissing('api_key',            'TEXT UNIQUE');
    await addIfMissing('webhook_url',        'TEXT');
    await addIfMissing('pricing',            "TEXT DEFAULT '{}'");
    await addIfMissing('input_schema',       "TEXT DEFAULT '{}'");
    await addIfMissing('output_schema',      "TEXT DEFAULT '{}'");
    await addIfMissing('success_rate',       'REAL DEFAULT 1.0');
    await addIfMissing('latency_ms',         'INTEGER DEFAULT 1000');
    await addIfMissing('call_count',         'INTEGER DEFAULT 0');
    await addIfMissing('description',        "TEXT DEFAULT ''");
    await addIfMissing('owner_address',      'TEXT DEFAULT NULL');
    await addIfMissing('verified',           'INTEGER DEFAULT 0');
    await addIfMissing('capability_version', "TEXT DEFAULT 'v1'");
    await addIfMissing('payment_methods',    "TEXT DEFAULT '[\"x402\"]'");

    // Generate api_keys for existing agents that don't have one
    const { rows: noKey } = await client.query('SELECT id FROM agents WHERE api_key IS NULL');
    for (const a of noKey) {
      await client.query('UPDATE agents SET api_key = $1 WHERE id = $2', [hashKey(uuidv4()), a.id]);
    }
  } else {
    const db = getSqliteDb();
    const cols = db.prepare("PRAGMA table_info(agents)").all();
    const colNames = cols.map(c => c.name);

    const addIfMissing = (col, definition) => {
      if (!colNames.includes(col)) {
        db.exec(`ALTER TABLE agents ADD COLUMN ${col} ${definition}`);
      }
    };

    if (!colNames.includes('api_key')) {
      db.exec('ALTER TABLE agents ADD COLUMN api_key TEXT UNIQUE');
      const agents = db.prepare('SELECT id FROM agents WHERE api_key IS NULL').all();
      const update = db.prepare('UPDATE agents SET api_key = ? WHERE id = ?');
      for (const a of agents) {
        update.run(hashKey(uuidv4()), a.id);
      }
    }

    addIfMissing('webhook_url',        'TEXT');
    addIfMissing('pricing',            "TEXT DEFAULT '{}'");
    addIfMissing('input_schema',       "TEXT DEFAULT '{}'");
    addIfMissing('output_schema',      "TEXT DEFAULT '{}'");
    addIfMissing('success_rate',       'REAL DEFAULT 1.0');
    addIfMissing('latency_ms',         'INTEGER DEFAULT 1000');
    addIfMissing('call_count',         'INTEGER DEFAULT 0');
    addIfMissing('description',        "TEXT DEFAULT ''");
    addIfMissing('owner_address',      'TEXT DEFAULT NULL');
    addIfMissing('verified',           'INTEGER DEFAULT 0');
    addIfMissing('capability_version', "TEXT DEFAULT 'v1'");
    addIfMissing('payment_methods',    "TEXT DEFAULT '[\"x402\"]'");
  }
}

async function seedIfEmpty() {
  const countRow = await get('SELECT COUNT(*) as c FROM agents');
  const count = Number(countRow?.c ?? 0);
  if (count > 0) return;

  const now = Date.now();

  const agents = [
    { id: uuidv4(), name: 'Scout',   type: 'ai', capabilities: JSON.stringify(['osint', 'search', 'reconnaissance']),          bond_amount: 100, reputation_score: 65 },
    { id: uuidv4(), name: 'Scraper', type: 'ai', capabilities: JSON.stringify(['web_scraping', 'data_collection', 'parsing']),  bond_amount: 80,  reputation_score: 58 },
    { id: uuidv4(), name: 'Analyst', type: 'ai', capabilities: JSON.stringify(['analysis', 'reporting', 'data_processing']),   bond_amount: 120, reputation_score: 72 },
  ];

  for (const a of agents) {
    await run(
      `INSERT INTO agents (id, name, type, capabilities, bond_amount, reputation_score, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [a.id, a.name, a.type, a.capabilities, a.bond_amount, a.reputation_score, now]
    );
  }

  const sampleTasks = [
    { category: 'osint',         intent: 'Find public financial data for company X',          max_cost: 50, payment_amount: 40, success_criteria: JSON.stringify({ rules: [{ field: 'data',          op: 'exists' }] }) },
    { category: 'web_scraping',  intent: 'Scrape product listings from marketplace Y',        max_cost: 30, payment_amount: 25, success_criteria: JSON.stringify({ rules: [{ field: 'items',         op: 'min_length', value: 10 }] }) },
    { category: 'analysis',      intent: 'Analyze sentiment of social media posts',           max_cost: 60, payment_amount: 50, success_criteria: JSON.stringify({ rules: [{ field: 'sentiment_score', op: 'exists' }] }) },
    { category: 'data_collection', intent: 'Collect weather data for 10 cities',             max_cost: 20, payment_amount: 15, success_criteria: JSON.stringify({ rules: [{ field: 'cities',         op: 'min_length', value: 10 }] }) },
    { category: 'reporting',     intent: 'Generate quarterly sales report',                   max_cost: 80, payment_amount: 70, success_criteria: JSON.stringify({ rules: [{ field: 'report',         op: 'exists' }] }) },
  ];

  for (const t of sampleTasks) {
    await run(
      `INSERT INTO tasks (id, category, intent, max_cost, payment_amount, input_schema, success_criteria, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
      [uuidv4(), t.category, t.intent, t.max_cost, t.payment_amount, '{}', t.success_criteria, now]
    );
  }

  const sampleBounties = [
    { title: "Summarize today's top AI news",    description: "Search and summarize the top 5 AI-related news articles published today. Include source URLs.",                                                          required_skill: 'web_research', budget: 2.0,  expires_at: now + 86400000 * 7 },
    { title: 'Code review: Node.js REST API',    description: 'Review a Node.js Express API for security issues, performance bottlenecks, and best practices. Provide a detailed report.',                             required_skill: 'code_review',  budget: 10.0, expires_at: now + 86400000 * 3 },
    { title: 'Translate README to Japanese',     description: 'Translate a GitHub README (English, ~500 words) to natural Japanese. Maintain technical terms in English.',                                             required_skill: 'translation',  budget: 3.0,  expires_at: now + 86400000 * 5 },
  ];

  for (const b of sampleBounties) {
    await run(
      `INSERT INTO bounties (id, title, description, required_skill, budget, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`,
      [uuidv4(), b.title, b.description, b.required_skill, b.budget, b.expires_at, now]
    );
  }
}

// ─── Initialisation ───────────────────────────────────────────────────────────

let _initialized = false;
let _initPromise = null;

async function initDb() {
  if (_initialized) return;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    await initSchema();
    await migrate();
    if (!USE_POSTGRES) {
      // seedAgents still uses the synchronous SQLite db directly
      seedAgents(getSqliteDb());
    }
    await seedIfEmpty();
    _initialized = true;
  })();

  return _initPromise;
}

// ─── Legacy synchronous accessor (used by existing route files) ───────────────
// Routes that still call  getDb().prepare(…).run/get/all  continue to work
// as long as DATABASE_URL is not set (SQLite path).
function getDb() {
  if (USE_POSTGRES) {
    // Legacy routes still use getDb(). When Postgres is active, fall back to
    // SQLite so routes don't crash. Full async migration is deferred.
    // TODO: migrate all routes to use query/run/get then remove this fallback.
  }
  const db = getSqliteDb();
  if (!_initialized) {
    // Synchronous init for SQLite (called before server starts)
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    // initSchema synchronously
    const sqliteDdl = `
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY, name TEXT, type TEXT, capabilities TEXT,
        api_key TEXT UNIQUE, bond_amount REAL DEFAULT 0, bond_locked REAL DEFAULT 0,
        reputation_score REAL DEFAULT 50, tasks_completed INTEGER DEFAULT 0,
        tasks_failed INTEGER DEFAULT 0, status TEXT DEFAULT 'active', created_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, parent_id TEXT, depth INTEGER DEFAULT 0, category TEXT,
        intent TEXT, input_schema TEXT, input_data TEXT, output_contract TEXT,
        success_criteria TEXT, deadline_sec INTEGER, max_cost REAL, payment_amount REAL,
        payment_locked INTEGER DEFAULT 0, issuer_id TEXT, worker_id TEXT,
        status TEXT DEFAULT 'open', result TEXT, created_at INTEGER,
        assigned_at INTEGER, completed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS escrow (
        id TEXT PRIMARY KEY, task_id TEXT, amount REAL, holder TEXT, status TEXT, created_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS reputation_log (
        id TEXT PRIMARY KEY, agent_id TEXT, task_id TEXT, event TEXT, score_delta REAL, created_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS bounties (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
        required_skill TEXT NOT NULL, budget REAL DEFAULT 0, status TEXT DEFAULT 'open',
        posted_by TEXT, claimed_by TEXT, result TEXT, expires_at INTEGER, created_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS peers (
        id TEXT PRIMARY KEY, url TEXT NOT NULL UNIQUE, name TEXT DEFAULT '',
        status TEXT DEFAULT 'active', trust_score REAL DEFAULT 50.0,
        registered_at INTEGER DEFAULT (strftime('%s','now')),
        last_seen INTEGER DEFAULT NULL, last_error TEXT DEFAULT NULL,
        public_key TEXT DEFAULT NULL
      );
    `;
    db.exec(sqliteDdl);

    // migrate synchronously
    const cols = db.prepare("PRAGMA table_info(agents)").all();
    const colNames = cols.map(c => c.name);
    const addIfMissing = (col, def) => { if (!colNames.includes(col)) db.exec(`ALTER TABLE agents ADD COLUMN ${col} ${def}`); };
    if (!colNames.includes('api_key')) {
      db.exec('ALTER TABLE agents ADD COLUMN api_key TEXT UNIQUE');
      const agents = db.prepare('SELECT id FROM agents WHERE api_key IS NULL').all();
      const upd = db.prepare('UPDATE agents SET api_key = ? WHERE id = ?');
      for (const a of agents) upd.run(hashKey(uuidv4()), a.id);
    }
    addIfMissing('webhook_url',        'TEXT');
    addIfMissing('pricing',            "TEXT DEFAULT '{}'");
    addIfMissing('input_schema',       "TEXT DEFAULT '{}'");
    addIfMissing('output_schema',      "TEXT DEFAULT '{}'");
    addIfMissing('success_rate',       'REAL DEFAULT 1.0');
    addIfMissing('latency_ms',         'INTEGER DEFAULT 1000');
    addIfMissing('call_count',         'INTEGER DEFAULT 0');
    addIfMissing('description',        "TEXT DEFAULT ''");
    addIfMissing('owner_address',      'TEXT DEFAULT NULL');
    addIfMissing('verified',           'INTEGER DEFAULT 0');
    addIfMissing('capability_version', "TEXT DEFAULT 'v1'");
    addIfMissing('payment_methods',    "TEXT DEFAULT '[\"x402\"]'");

    seedAgents(db);

    // seed if empty
    const count = db.prepare('SELECT COUNT(*) as c FROM agents').get().c;
    if (count === 0) {
      const now = Date.now();
      const agents2 = [
        { id: uuidv4(), name: 'Scout',   type: 'ai', capabilities: JSON.stringify(['osint', 'search', 'reconnaissance']),         bond_amount: 100, reputation_score: 65 },
        { id: uuidv4(), name: 'Scraper', type: 'ai', capabilities: JSON.stringify(['web_scraping', 'data_collection', 'parsing']), bond_amount: 80,  reputation_score: 58 },
        { id: uuidv4(), name: 'Analyst', type: 'ai', capabilities: JSON.stringify(['analysis', 'reporting', 'data_processing']),  bond_amount: 120, reputation_score: 72 },
      ];
      const insertAgent = db.prepare(`INSERT INTO agents (id, name, type, capabilities, bond_amount, reputation_score, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      for (const a of agents2) insertAgent.run(a.id, a.name, a.type, a.capabilities, a.bond_amount, a.reputation_score, now);

      const sampleTasks = [
        { category: 'osint',           intent: 'Find public financial data for company X',    max_cost: 50, payment_amount: 40, sc: JSON.stringify({ rules: [{ field: 'data',           op: 'exists' }] }) },
        { category: 'web_scraping',    intent: 'Scrape product listings from marketplace Y',  max_cost: 30, payment_amount: 25, sc: JSON.stringify({ rules: [{ field: 'items',          op: 'min_length', value: 10 }] }) },
        { category: 'analysis',        intent: 'Analyze sentiment of social media posts',     max_cost: 60, payment_amount: 50, sc: JSON.stringify({ rules: [{ field: 'sentiment_score', op: 'exists' }] }) },
        { category: 'data_collection', intent: 'Collect weather data for 10 cities',          max_cost: 20, payment_amount: 15, sc: JSON.stringify({ rules: [{ field: 'cities',          op: 'min_length', value: 10 }] }) },
        { category: 'reporting',       intent: 'Generate quarterly sales report',             max_cost: 80, payment_amount: 70, sc: JSON.stringify({ rules: [{ field: 'report',          op: 'exists' }] }) },
      ];
      const insertTask = db.prepare(`INSERT INTO tasks (id, category, intent, max_cost, payment_amount, input_schema, success_criteria, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`);
      for (const t of sampleTasks) insertTask.run(uuidv4(), t.category, t.intent, t.max_cost, t.payment_amount, '{}', t.sc, now);

      const sampleBounties = [
        { title: "Summarize today's top AI news",  description: "Search and summarize the top 5 AI-related news articles today.",  required_skill: 'web_research', budget: 2.0,  expires_at: now + 86400000 * 7 },
        { title: 'Code review: Node.js REST API',  description: 'Review a Node.js Express API for security and best practices.',    required_skill: 'code_review',  budget: 10.0, expires_at: now + 86400000 * 3 },
        { title: 'Translate README to Japanese',   description: 'Translate a GitHub README (~500 words) to natural Japanese.',      required_skill: 'translation',  budget: 3.0,  expires_at: now + 86400000 * 5 },
      ];
      const insertBounty = db.prepare(`INSERT INTO bounties (id, title, description, required_skill, budget, status, expires_at, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`);
      for (const b of sampleBounties) insertBounty.run(uuidv4(), b.title, b.description, b.required_skill, b.budget, b.expires_at, now);
    }

    _initialized = true;
  }
  return db;
}

module.exports = { getDb, initDb, query, run, get, USE_POSTGRES };

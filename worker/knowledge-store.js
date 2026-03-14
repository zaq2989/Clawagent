'use strict';
// knowledge-store.js — BM25-based SQLite knowledge store for self-improvement loop

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'knowledge.db');

let db;

function initKnowledgeStore() {
  db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_category TEXT,
      task_summary  TEXT,
      outcome       TEXT,    -- 'success' | 'failure' | 'partial'
      learning      TEXT,    -- 自然言語での学習内容
      keywords      TEXT,    -- BM25用キーワード（スペース区切り）
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge(task_category);
  `);
  console.log('[KnowledgeStore] initialized');
}

function addKnowledge({ task_category, task_summary, outcome, learning }) {
  if (!db) { console.warn('[KnowledgeStore] Not initialized'); return; }
  const keywords = extractKeywords(`${task_category} ${task_summary} ${learning}`);
  db.prepare(`
    INSERT INTO knowledge (task_category, task_summary, outcome, learning, keywords)
    VALUES (?, ?, ?, ?, ?)
  `).run(task_category, task_summary, outcome, learning, keywords);
}

function searchKnowledge(query, limit = 3) {
  if (!db) return [];
  const allEntries = db.prepare('SELECT * FROM knowledge ORDER BY created_at DESC LIMIT 100').all();
  if (!allEntries.length) return [];

  const queryTokens = tokenize(query);
  const N = allEntries.length;

  const scored = allEntries.map(entry => {
    const docTokens = tokenize((entry.keywords || '') + ' ' + (entry.task_summary || ''));
    const score = bm25Score(queryTokens, docTokens, N);
    return { ...entry, score };
  });

  return scored
    .filter(e => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

function extractKeywords(text) {
  return [...new Set(tokenize(text))].join(' ');
}

function bm25Score(queryTokens, docTokens, N, k1 = 1.5, b = 0.75) {
  const AVG_DOC_LEN = 20;
  const docLen = docTokens.length;
  if (docLen === 0) return 0;
  let score = 0;
  for (const term of queryTokens) {
    const tf = docTokens.filter(t => t === term).length;
    if (tf === 0) continue;
    const idf = Math.log((N + 1) / 1);  // simplified (df=1 assumption)
    score += idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / AVG_DOC_LEN)));
  }
  return score;
}

module.exports = { initKnowledgeStore, addKnowledge, searchKnowledge };

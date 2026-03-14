#!/usr/bin/env node
// ClawAgent Ollama Worker
// Polls ClawAgent task queue for pending tasks, executes via Ollama, submits results.
//
// Usage:
//   CLAWAGENT_API_KEY=<key> node worker/ollama-worker.js
//   or use ./worker/start-worker.sh <api_key>

'use strict';

const { initKnowledgeStore, searchKnowledge } = require('./knowledge-store.js');
const { runStudySession } = require('./study-session.js');

const CLAWAGENT_URL = process.env.CLAWAGENT_URL || 'https://clawagent-production.up.railway.app';
const OLLAMA_URL    = process.env.OLLAMA_URL    || 'http://localhost:11434';
const OLLAMA_MODEL  = process.env.OLLAMA_MODEL  || 'qwen2.5:7b';
const WORKER_NAME   = process.env.WORKER_NAME   || 'OllamaWorker-Local';
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '15000', 10);

let workerApiKey = process.env.CLAWAGENT_API_KEY || null;
let myAgentId    = null;  // cached after first /api/agents/me call

// ---------------------------------------------------------------------------
// SSRF guard: only allow requests to the pre-configured CLAWAGENT_URL and
// OLLAMA_URL – the worker never opens arbitrary remote URLs from task input.
// ---------------------------------------------------------------------------
const ALLOWED_URL_PREFIXES = [
  CLAWAGENT_URL.replace(/\/$/, ''),
  OLLAMA_URL.replace(/\/$/, ''),
];

function assertSafeUrl(url) {
  const ok = ALLOWED_URL_PREFIXES.some(prefix => url.startsWith(prefix));
  if (!ok) {
    throw new Error(`[SSRF guard] Blocked request to disallowed URL: ${url}`);
  }
}

// ---------------------------------------------------------------------------
// Capability → Ollama prompt mapping
// ---------------------------------------------------------------------------
const CAPABILITY_HANDLERS = {
  'summarize.text.longform':  (input) =>
    `Summarize the following text in 3-5 sentences:\n\n${input.text || JSON.stringify(input)}`,

  'summarize.text.shortform': (input) =>
    `Summarize in 1-2 sentences:\n\n${input.text || JSON.stringify(input)}`,

  'review.code.general':      (input) =>
    `Review this code and provide feedback on quality, bugs, and improvements:\n\n\`\`\`\n${
      input.code || input.text || JSON.stringify(input)
    }\n\`\`\``,

  'analyze.sentiment':        (input) =>
    `Analyze the sentiment of this text (positive/negative/neutral) and explain why:\n\n${
      input.text || JSON.stringify(input)
    }`,

  'translate.text.en-ja':     (input) =>
    `Translate the following text to Japanese:\n\n${input.text || JSON.stringify(input)}`,

  'translate.text.ja-en':     (input) =>
    `Translate the following text to English:\n\n${input.text || JSON.stringify(input)}`,
};

// Capabilities this worker advertises
const SUPPORTED_CAPABILITIES = Object.keys(CAPABILITY_HANDLERS);

// ---------------------------------------------------------------------------
// API helpers — use Authorization: Bearer (required by apiKeyAuth middleware)
// ---------------------------------------------------------------------------
function apiHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (workerApiKey) h['Authorization'] = `Bearer ${workerApiKey}`;
  return h;
}

async function apiFetch(path, init = {}) {
  const url = `${CLAWAGENT_URL}${path}`;
  assertSafeUrl(url);
  const res = await fetch(url, { ...init, headers: { ...apiHeaders(), ...(init.headers || {}) } });
  return res.json();
}

// ---------------------------------------------------------------------------
// 1. Register as an agent (if no API key provided)
// ---------------------------------------------------------------------------
async function register() {
  console.log(`[${WORKER_NAME}] Registering with ClawAgent...`);
  const data = await apiFetch('/api/agents/register', {
    method: 'POST',
    body: JSON.stringify({
      name: WORKER_NAME,
      capabilities: SUPPORTED_CAPABILITIES,
      webhook_url: '',          // polling mode – no webhook needed
      pricing: { mode: 'free' },
    }),
  });
  if (!data.ok) {
    throw new Error(`Registration failed: ${JSON.stringify(data)}`);
  }
  workerApiKey = data.agent?.api_key || data.api_key;
  myAgentId    = data.agent?.id || null;
  console.log(`[${WORKER_NAME}] Registered. agent_id=${myAgentId}`);
}

// ---------------------------------------------------------------------------
// 2. Retrieve and cache this worker's own agent ID
// ---------------------------------------------------------------------------
async function getMyAgentId() {
  if (myAgentId) return myAgentId;
  const me = await apiFetch('/api/agents/me');
  myAgentId = me.agent?.id || null;
  if (!myAgentId) throw new Error('Could not determine own agent ID from /api/agents/me');
  console.log(`[${WORKER_NAME}] My agent ID: ${myAgentId}`);
  return myAgentId;
}

// ---------------------------------------------------------------------------
// 3. Execute a prompt via Ollama
// ---------------------------------------------------------------------------
async function callOllama(prompt, systemPrompt = '', knowledgeSection = '') {
  const url = `${OLLAMA_URL}/api/generate`;
  assertSafeUrl(url);

  const effectiveSystem = [
    systemPrompt || 'あなたはタスクを実行するAIエージェントです。',
    knowledgeSection,
  ].filter(Boolean).join('');

  const body = {
    model: OLLAMA_MODEL,
    prompt,
    stream: false,
    options: { num_predict: 1024 },
  };
  if (effectiveSystem) body.system = effectiveSystem;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return data.response || 'No response generated';
}

// ---------------------------------------------------------------------------
// 4. Poll /api/tasks for pending tasks assigned to this worker
// ---------------------------------------------------------------------------
async function pollAndProcess() {
  let agentId;
  try {
    agentId = await getMyAgentId();
  } catch (err) {
    console.error(`[${WORKER_NAME}] Could not get agent ID:`, err.message);
    return;
  }

  let data;
  try {
    // GET /api/tasks?status=pending — auth required; server returns only *our* tasks
    data = await apiFetch('/api/tasks?status=pending');
  } catch (err) {
    console.error(`[${WORKER_NAME}] Failed to fetch tasks:`, err.message);
    return;
  }

  const tasks = data.tasks || [];
  // Extra client-side guard: only handle tasks explicitly assigned to us
  const pending = tasks.filter(t =>
    (t.status === 'pending' || t.status === 'open') &&
    (!t.worker_id || t.worker_id === agentId)
  );

  if (pending.length === 0) {
    console.log(`[${WORKER_NAME}] No pending tasks.`);
    return;
  }

  // The task's capability is stored in the `category` (and `intent`) column
  const task = pending.find(t => CAPABILITY_HANDLERS[t.category]) || pending[0];
  const capability = task.category || task.intent || '';
  const handler = CAPABILITY_HANDLERS[capability];

  if (!handler) {
    console.log(`[${WORKER_NAME}] No handler for capability: ${capability} – skipping.`);
    return;
  }

  console.log(`[${WORKER_NAME}] Processing task ${task.id} | capability: ${capability}`);

  try {
    // Parse input_data (stored as JSON string)
    let inputData = {};
    try {
      inputData = typeof task.input_data === 'string' ? JSON.parse(task.input_data) : (task.input_data || {});
    } catch (_) {
      inputData = { text: task.input_data || task.description || '' };
    }

    const prompt = handler(inputData);

    // --- BM25 knowledge injection ---
    const queryText = inputData.text || inputData.code || task.description || capability;
    const relevantKnowledge = searchKnowledge(queryText, 3);
    const knowledgeSection = relevantKnowledge.length > 0
      ? `\n\n## 過去の学習（参考）\n${relevantKnowledge.map(k =>
          `- [${k.outcome}] ${k.learning}`
        ).join('\n')}`
      : '';
    if (knowledgeSection) {
      console.log(`[${WORKER_NAME}] Injecting ${relevantKnowledge.length} knowledge entry(ies).`);
    }

    // Run Ollama (with knowledge injected into system prompt)
    const output = await callOllama(prompt, '', knowledgeSection);
    console.log(`[${WORKER_NAME}] Ollama done. output[:80]: ${output.substring(0, 80)}...`);

    // Submit result via PATCH /api/tasks/:id/status
    const completeData = await apiFetch(`/api/tasks/${task.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'completed', result: { output } }),
    });
    console.log(`[${WORKER_NAME}] Task ${task.id} completed:`, JSON.stringify(completeData).substring(0, 120));

    // --- Post-task self-improvement (non-blocking) ---
    runStudySession({ task, result: output, success: true }).catch(console.warn);

  } catch (err) {
    console.error(`[${WORKER_NAME}] Error processing task ${task.id}:`, err.message);
    // Attempt to mark task as failed
    try {
      await apiFetch(`/api/tasks/${task.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'failed', result: { error: err.message } }),
      });
    } catch (_) {}
    // --- Post-task self-improvement for failures too (non-blocking) ---
    runStudySession({ task, result: err.message, success: false }).catch(console.warn);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`[${WORKER_NAME}] Starting Ollama Worker`);
  initKnowledgeStore();
  console.log(`  ClawAgent : ${CLAWAGENT_URL}`);
  console.log(`  Ollama    : ${OLLAMA_URL}`);
  console.log(`  Model     : ${OLLAMA_MODEL}`);
  console.log(`  Capabilities: ${SUPPORTED_CAPABILITIES.join(', ')}`);

  if (!workerApiKey) {
    await register();
  } else {
    console.log(`[${WORKER_NAME}] Using provided API key.`);
    // Pre-fetch our agent ID so polling can start cleanly
    try { await getMyAgentId(); } catch (e) {
      console.warn(`[${WORKER_NAME}] Could not pre-fetch agent ID: ${e.message}`);
    }
  }

  // Initial poll
  await pollAndProcess();

  // Polling loop
  setInterval(pollAndProcess, POLL_INTERVAL_MS);
  console.log(`[${WORKER_NAME}] Polling every ${POLL_INTERVAL_MS / 1000}s…`);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});

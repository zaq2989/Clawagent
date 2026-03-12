#!/usr/bin/env node
// ClawAgent Ollama Worker
// Polls ClawAgent task queue for pending tasks, executes via Ollama, submits results.
//
// Usage:
//   CLAWAGENT_API_KEY=<key> node worker/ollama-worker.js
//   or use ./worker/start-worker.sh <api_key>

'use strict';

const CLAWAGENT_URL = process.env.CLAWAGENT_URL || 'https://clawagent-production.up.railway.app';
const OLLAMA_URL    = process.env.OLLAMA_URL    || 'http://localhost:11434';
const OLLAMA_MODEL  = process.env.OLLAMA_MODEL  || 'qwen2.5:7b';
const WORKER_NAME   = process.env.WORKER_NAME   || 'OllamaWorker-Local';
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '15000', 10);

let workerApiKey = process.env.CLAWAGENT_API_KEY || null;

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
// API helpers
// ---------------------------------------------------------------------------
function apiHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (workerApiKey) h['X-API-Key'] = workerApiKey;
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
  console.log(`[${WORKER_NAME}] Registered. agent_id=${data.agent?.id}`);
}

// ---------------------------------------------------------------------------
// 2. Execute a prompt via Ollama
// ---------------------------------------------------------------------------
async function callOllama(prompt, systemPrompt = '') {
  const url = `${OLLAMA_URL}/api/generate`;
  assertSafeUrl(url);

  const body = {
    model: OLLAMA_MODEL,
    prompt,
    stream: false,
    options: { num_predict: 1024 },
  };
  if (systemPrompt) body.system = systemPrompt;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return data.response || 'No response generated';
}

// ---------------------------------------------------------------------------
// 3. Poll /api/tasks for pending tasks and process them
// ---------------------------------------------------------------------------
async function pollAndProcess() {
  let data;
  try {
    data = await apiFetch('/api/tasks?status=pending');
  } catch (err) {
    console.error(`[${WORKER_NAME}] Failed to fetch tasks:`, err.message);
    return;
  }

  const tasks = data.tasks || data || [];
  const pending = Array.isArray(tasks)
    ? tasks.filter(t => t.status === 'pending' || t.status === 'open')
    : [];

  if (pending.length === 0) {
    console.log(`[${WORKER_NAME}] No pending tasks.`);
    return;
  }

  // Find first task whose capability we handle
  const task = pending.find(t => CAPABILITY_HANDLERS[t.capability]) || pending[0];
  const handler = CAPABILITY_HANDLERS[task.capability];

  if (!handler) {
    console.log(`[${WORKER_NAME}] No handler for capability: ${task.capability} – skipping.`);
    return;
  }

  console.log(`[${WORKER_NAME}] Processing task ${task.id} | capability: ${task.capability}`);

  try {
    // Build prompt from capability handler
    const inputData = task.input || task.description || '';
    const prompt = handler(typeof inputData === 'string' ? { text: inputData } : inputData);

    // Run Ollama
    const output = await callOllama(prompt);
    console.log(`[${WORKER_NAME}] Ollama done. output[:80]: ${output.substring(0, 80)}...`);

    // Submit result
    const completeData = await apiFetch(`/api/tasks/${task.id}/complete`, {
      method: 'POST',
      body: JSON.stringify({ output, result: output }),
    });
    console.log(`[${WORKER_NAME}] Task ${task.id} completed:`, JSON.stringify(completeData).substring(0, 120));
  } catch (err) {
    console.error(`[${WORKER_NAME}] Error processing task ${task.id}:`, err.message);
    // Attempt to mark task as failed
    try {
      await apiFetch(`/api/tasks/${task.id}/fail`, {
        method: 'POST',
        body: JSON.stringify({ error: err.message }),
      });
    } catch (_) {}
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`[${WORKER_NAME}] Starting Ollama Worker`);
  console.log(`  ClawAgent : ${CLAWAGENT_URL}`);
  console.log(`  Ollama    : ${OLLAMA_URL}`);
  console.log(`  Model     : ${OLLAMA_MODEL}`);
  console.log(`  Capabilities: ${SUPPORTED_CAPABILITIES.join(', ')}`);

  if (!workerApiKey) {
    await register();
  } else {
    console.log(`[${WORKER_NAME}] Using provided API key.`);
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

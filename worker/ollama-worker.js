#!/usr/bin/env node
// ClawAgent Ollama Worker
// Polls ClawAgent for open bounties, executes them via Ollama, submits results

const CLAWAGENT_URL = 'http://localhost:3750';
const OLLAMA_URL = 'http://localhost:11434';
const WORKER_NAME = process.env.WORKER_NAME || 'OllamaWorker';
const WORKER_SKILLS = (process.env.WORKER_SKILLS || 'analysis,research,writing,summarization').split(',');
const POLL_INTERVAL_MS = 30000; // 30秒ごとにチェック

let workerApiKey = process.env.CLAWAGENT_API_KEY || null;
let workerId = null;

// 1. 起動時にClawAgentに登録（未登録の場合）
async function register() {
  const res = await fetch(`${CLAWAGENT_URL}/api/agents/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: WORKER_NAME,
      type: 'ai',
      capabilities: WORKER_SKILLS,
      bond_amount: 50,
      webhook_url: ''
    })
  });
  const data = await res.json();
  workerApiKey = data.api_key;
  workerId = data.agent?.id || data.id;
  console.log(`[${WORKER_NAME}] Registered. id=${workerId}`);
  return data;
}

// 2. Ollamaでタスクを実行
async function executeWithOllama(taskDescription, skill) {
  const systemPrompt = `You are a specialized AI agent with expertise in ${skill}. Complete the given task concisely and accurately.`;
  
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'qwen2.5:7b',
      prompt: taskDescription,
      system: systemPrompt,
      stream: false,
      options: { num_predict: 500 }
    })
  });
  const data = await res.json();
  return data.response || 'No response generated';
}

// 3. open bountyをポーリングして実行
async function pollAndExecute() {
  try {
    // bounty一覧取得
    const res = await fetch(`${CLAWAGENT_URL}/api/bounties`);
    const data = await res.json();
    const bounties = (data.bounties || []).filter(b => b.status === 'open');
    
    if (bounties.length === 0) {
      console.log(`[${WORKER_NAME}] No open bounties`);
      return;
    }
    
    // スキルマッチするbountyを1つ選ぶ
    const matched = bounties.find(b => 
      WORKER_SKILLS.some(s => b.required_skill?.includes(s) || s.includes(b.required_skill))
    ) || bounties[0];
    
    console.log(`[${WORKER_NAME}] Found bounty: ${matched.title}`);
    
    // claim
    const claimRes = await fetch(`${CLAWAGENT_URL}/api/bounties/${matched.id}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': workerApiKey }
    });
    const claimData = await claimRes.json();
    if (!claimData.ok) {
      console.log(`[${WORKER_NAME}] Claim failed: ${JSON.stringify(claimData)}`);
      return;
    }
    
    console.log(`[${WORKER_NAME}] Claimed! Executing with Ollama...`);
    
    // Ollama で実行
    const result = await executeWithOllama(matched.description, matched.required_skill);
    console.log(`[${WORKER_NAME}] Result (first 100 chars): ${result.substring(0, 100)}...`);
    
    // 完了報告
    const completeRes = await fetch(`${CLAWAGENT_URL}/api/bounties/${matched.id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': workerApiKey },
      body: JSON.stringify({ result })
    });
    const completeData = await completeRes.json();
    console.log(`[${WORKER_NAME}] Completed:`, JSON.stringify(completeData));
    
  } catch (err) {
    console.error(`[${WORKER_NAME}] Error:`, err.message);
  }
}

// メインループ
async function main() {
  console.log(`[${WORKER_NAME}] Starting Ollama worker...`);
  console.log(`  Skills: ${WORKER_SKILLS.join(', ')}`);
  
  // 登録
  if (!workerApiKey) {
    await register();
  }
  
  // 初回即実行
  await pollAndExecute();
  
  // ポーリングループ
  setInterval(pollAndExecute, POLL_INTERVAL_MS);
  console.log(`[${WORKER_NAME}] Polling every ${POLL_INTERVAL_MS/1000}s...`);
}

main().catch(console.error);

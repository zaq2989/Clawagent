#!/usr/bin/env node
// claw-network CLI
const BASE_URL = process.env.CLAW_URL || 'https://clawagent-production.up.railway.app';

const [,, command, ...args] = process.argv;

async function resolve(capability) {
  const res = await fetch(`${BASE_URL}/resolve?capability=${encodeURIComponent(capability)}`);
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

async function call(capability, inputJson) {
  const input = inputJson ? JSON.parse(inputJson) : {};
  const res = await fetch(`${BASE_URL}/call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ capability, input }),
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

async function register(filePath) {
  const fs = require('fs');
  const capability = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const apiKey = process.env.CLAW_API_KEY;
  if (!apiKey) {
    console.error('Error: CLAW_API_KEY env var required');
    process.exit(1);
  }

  const res = await fetch(`${BASE_URL}/api/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
    body: JSON.stringify(capability),
  });
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

async function list(capability) {
  const url = capability
    ? `${BASE_URL}/api/agents?capability=${encodeURIComponent(capability)}`
    : `${BASE_URL}/api/agents`;
  const res = await fetch(url);
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

const help = `
claw-network CLI

Commands:
  resolve <capability>           Resolve a capability to providers
  call <capability> [input-json] Call a capability with optional input
  register <capability.json>     Register your agent (requires CLAW_API_KEY)
  list [capability]              List agents, optionally filtered by capability

Examples:
  claw resolve translate.en-ja
  claw call sentiment '{"text":"This is amazing!"}'
  claw call echo '{"text":"hello world"}'
  claw register ./my-agent.json

Environment:
  CLAW_URL      Base URL (default: https://clawagent-production.up.railway.app)
  CLAW_API_KEY  API key for registration
`;

switch (command) {
  case 'resolve': resolve(args[0]); break;
  case 'call': call(args[0], args[1]); break;
  case 'register': register(args[0]); break;
  case 'list': list(args[0]); break;
  default: console.log(help);
}

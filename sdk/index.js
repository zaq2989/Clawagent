const DEFAULT_BASE_URL = 'https://clawagent-production.up.railway.app';

class ClawNetwork {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || DEFAULT_BASE_URL;
    this.apiKey = options.apiKey || null;
  }

  async resolve(capability) {
    const res = await fetch(`${this.baseUrl}/resolve?capability=${encodeURIComponent(capability)}`);
    return res.json();
  }

  async call(capability, input = {}, options = {}) {
    const body = { capability, input };
    if (options.budget)     body.budget     = options.budget;
    if (options.timeout_ms) body.timeout_ms = options.timeout_ms;
    // payer: { key_env: "MY_PRIVATE_KEY_ENV_VAR" }
    // The Claw Network node will read the private key from that env var server-side.
    if (options.payer)      body.payer      = options.payer;

    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;

    const res = await fetch(`${this.baseUrl}/call`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    return res.json();
  }

  async listAgents(capability) {
    const url = capability
      ? `${this.baseUrl}/api/agents?capability=${encodeURIComponent(capability)}`
      : `${this.baseUrl}/api/agents`;
    const res = await fetch(url);
    return res.json();
  }
}

module.exports = { ClawNetwork };
module.exports.default = ClawNetwork;

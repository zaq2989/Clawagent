const DEFAULT_BASE_URL = 'https://clawagent-production.up.railway.app';

class ClawNetwork {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || DEFAULT_BASE_URL;
    this.apiKey = options.apiKey || null;
    this.privateKey = options.privateKey || null; // client-side payer key
  }

  async resolve(capability) {
    const res = await fetch(`${this.baseUrl}/resolve?capability=${encodeURIComponent(capability)}`);
    return res.json();
  }

  async call(capability, input = {}, options = {}) {
    const body = { capability, input };
    if (options.budget)     body.budget     = options.budget;
    if (options.timeout_ms) body.timeout_ms = options.timeout_ms;

    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;

    // 1st request
    let res = await fetch(`${this.baseUrl}/call`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    let result = await res.json();

    // If payment_required and we have a privateKey, sign and retry
    if (result.status === 'payment_required' && result.www_authenticate && this.privateKey) {
      const paymentProof = await this._createPaymentProof(result.www_authenticate);

      res = await fetch(`${this.baseUrl}/call`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...body, payment_proof: paymentProof }),
      });
      result = await res.json();
    }

    return result;
  }

  async _createPaymentProof(wwwAuthenticate) {
    try {
      const { privateKeyToAccount } = await import('viem/accounts');

      const account = privateKeyToAccount(this.privateKey);

      // Parse WWW-Authenticate params
      const params = {};
      const matches = wwwAuthenticate.matchAll(/(\w+)="([^"]*)"/g);
      for (const [, key, value] of matches) params[key] = value;

      // x402 simplified: encode address + signature as base64
      const payload = JSON.stringify({
        from: account.address,
        www_authenticate: wwwAuthenticate,
        timestamp: Date.now(),
      });

      const signature = await account.signMessage({ message: payload });

      return Buffer.from(JSON.stringify({ payload, signature })).toString('base64');
    } catch (e) {
      throw new Error(`Payment signing failed: ${e.message}`);
    }
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

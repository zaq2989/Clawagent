// claw-network SDK v0.6.0
// AI capability routing with built-in payments.

'use strict';

const DEFAULT_BASE_URL = 'https://clawagent-production.up.railway.app';

class ClawNetwork {
  /**
   * @param {import('./index').ClawNetworkOptions} options
   */
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || DEFAULT_BASE_URL;
    this.apiKey = options.apiKey || null;

    // Multi-payment config
    this.payment = options.payment || null;

    // Backward compatibility: privateKey → x402
    if (options.privateKey && !this.payment) {
      this.payment = { x402: { privateKey: options.privateKey } };
    }
    this.privateKey = options.privateKey || null;
  }

  /**
   * Register an agent on the Claw Network.
   * Returns agentId and apiKey for use in subsequent calls.
   *
   * @param {import('./index').RegisterOptions} opts
   * @returns {Promise<import('./index').RegisterResult>}
   */
  async register(opts) {
    const { name, capabilities, webhookUrl, pricing, description } = opts;

    // Map RegisterOptions → API payload
    const payload = {
      name,
      capabilities: capabilities || [],
      webhook_url: webhookUrl,
      description: description || undefined,
    };

    // Map pricing to API format
    if (pricing) {
      if (pricing.type === 'free') {
        payload.pricing = { mode: 'free' };
      } else if (pricing.type === 'paid') {
        payload.pricing = {
          mode: 'per_call',
          price_per_call: pricing.amount,
          currency: pricing.currency || 'USDC',
        };
      }
    }

    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;

    const res = await fetch(`${this.baseUrl}/api/agents/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!data.ok) {
      const msg = data.error || (data.errors && data.errors[0] && data.errors[0].msg) || 'Registration failed';
      throw new Error(`[claw-network] Register failed: ${msg}`);
    }

    return {
      agentId: data.agent.id,
      apiKey: data.agent.api_key,
      name: data.agent.name,
      status: data.agent.status,
      verified: data.agent.verified,
      createdAt: data.agent.created_at,
    };
  }

  /**
   * Call a capability by name.
   *
   * @param {string} capability
   * @param {Record<string, any>} input
   * @param {import('./index').CallOptions} [options]
   * @returns {Promise<import('./index').CallResult>}
   */
  async call(capability, input = {}, options = {}) {
    const body = { capability, input };

    if (options.budget)         body.budget = options.budget;
    if (options.timeout)        body.timeout_ms = options.timeout;
    if (options.preferAgentId)  body.agent_id = options.preferAgentId;

    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;

    const startMs = Date.now();

    // 1st request
    let res = await fetch(`${this.baseUrl}/call`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    let result = await res.json();

    // Auto-payment: handle payment_required
    if (result.status === 'payment_required' && result.www_authenticate && this.payment) {
      const proof = await this._createPaymentProof(
        result.www_authenticate,
        result.payment_scheme,
      );

      if (proof.error) {
        return { ...result, payment_error: proof.error };
      }

      // Retry with payment_proof and payment_scheme
      res = await fetch(`${this.baseUrl}/call`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...body,
          payment_proof: proof.header_value,
          payment_scheme: proof.scheme,
        }),
      });
      result = await res.json();
    }

    // Normalize result to include latencyMs
    const latencyMs = Date.now() - startMs;
    return {
      ...result,
      latencyMs,
    };
  }

  /**
   * Resolve a capability to a list of providers.
   *
   * @param {string} capability
   * @returns {Promise<any>}
   */
  async resolve(capability) {
    const res = await fetch(`${this.baseUrl}/resolve?capability=${encodeURIComponent(capability)}`);
    return res.json();
  }

  /**
   * List registered agents, optionally filtered by capability.
   *
   * @param {string} [capability]
   * @returns {Promise<any>}
   */
  async listAgents(capability) {
    const url = capability
      ? `${this.baseUrl}/api/agents?capability=${encodeURIComponent(capability)}`
      : `${this.baseUrl}/api/agents`;
    const res = await fetch(url);
    return res.json();
  }

  /**
   * Search for agents/capabilities by keyword using the web.search capability.
   *
   * @param {string} query - Search query
   * @param {{ limit?: number }} [options]
   * @returns {Promise<import('./index').CallResult>}
   */
  async webSearch(query, options = {}) {
    return this.call('web.search', { query, limit: options.limit || 5 });
  }

  /**
   * Scrape a web page via the web.scrape capability.
   *
   * @param {string} url - Target URL to scrape
   * @returns {Promise<import('./index').CallResult>}
   */
  async webScrape(url) {
    return this.call('web.scrape', { url });
  }

  /**
   * Convenience helper: register a worker agent.
   *
   * @param {string} name - Worker display name
   * @param {string[]} capabilities - Capability list
   * @param {string} webhookUrl - Webhook URL (can be empty for polling workers)
   * @param {object} [options] - Extra RegisterOptions fields
   * @returns {Promise<import('./index').RegisterResult>}
   */
  async registerWorker(name, capabilities, webhookUrl, options = {}) {
    return this.register({
      name,
      capabilities,
      webhookUrl,
      pricing: options.pricing || { type: 'free' },
      ...options,
    });
  }

  /**
   * Get the status and result of a specific task by ID.
   *
   * @param {string} taskId
   * @returns {Promise<any>}
   */
  async getTask(taskId) {
    const res = await fetch(`${this.baseUrl}/api/tasks/${taskId}`, {
      headers: this._headers(),
    });
    return res.json();
  }

  /** @private */
  _headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.apiKey) h['X-API-Key'] = this.apiKey;
    return h;
  }

  /** @private */
  async _createPaymentProof(wwwAuthenticate, scheme) {
    let routePayment;
    try {
      ({ routePayment } = require('./paymentRouter'));
    } catch (_) {
      try {
        ({ routePayment } = require('../src/payment/router'));
      } catch (e) {
        throw new Error(`Payment router not available: ${e.message}`);
      }
    }
    return routePayment(wwwAuthenticate, this.payment);
  }
}

module.exports = { ClawNetwork };
module.exports.default = ClawNetwork;

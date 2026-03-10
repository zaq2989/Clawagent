const DEFAULT_BASE_URL = 'https://clawagent-production.up.railway.app';

class ClawNetwork {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || DEFAULT_BASE_URL;
    this.apiKey = options.apiKey || null;

    // Multi-payment config
    this.payment = options.payment || null;

    // Backward compatibility: privateKey → x402
    if (options.privateKey && !this.payment) {
      this.payment = { x402: { privateKey: options.privateKey } };
    }
    // Also keep legacy privateKey reference
    this.privateKey = options.privateKey || null;
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

    // Auto-payment: handle payment_required
    if (result.status === 'payment_required' && result.www_authenticate && this.payment) {
      const proof = await this._createPaymentProof(
        result.www_authenticate,
        result.payment_scheme
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

    return result;
  }

  async _createPaymentProof(wwwAuthenticate, scheme) {
    // Try to use bundled paymentRouter first, then server-side router
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

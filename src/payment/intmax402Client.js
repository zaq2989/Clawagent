'use strict';

/**
 * intmax402 Payment Client
 *
 * WWW-Authenticate spec:
 *   intmax402 realm="...", chain_id="...", amount="...", token="..."
 *
 * Authorization response:
 *   Authorization: intmax402 proof="<proof>"
 *
 * Uses @tanakayuto/intmax402-client if available.
 * Falls back to proof_pending for manual handling.
 */
async function createIntmax402Proof(wwwAuthenticate, config) {
  const { ethPrivateKey, environment = 'mainnet' } = config;

  const params = {};
  for (const [, key, value] of wwwAuthenticate.matchAll(/(\w+)="([^"]*)"/g)) {
    params[key] = value;
  }

  try {
    const { INTMAX402Client } = require('@tanakayuto/intmax402-client');
    const client = new INTMAX402Client({
      eth_private_key: ethPrivateKey,
      environment,
    });

    const proof = await client.createPaymentProof({
      wwwAuthenticate,
      ...params,
    });

    return {
      scheme: 'intmax402',
      proof,
      header_name: 'Authorization',
      header_value: `intmax402 proof="${proof}"`,
    };
  } catch (e) {
    // SDKがない場合やエラー時: proof_pending を返す
    return {
      scheme: 'intmax402',
      status: 'proof_pending',
      error: e.message,
      payment_request: params,
    };
  }
}

module.exports = { createIntmax402Proof };

'use strict';
// src/payment/x402Client.js — viem-based x402 payment client
// Parses WWW-Authenticate: x402 headers and produces X-PAYMENT headers via EIP-712 signing

const { privateKeyToAccount } = require('viem/accounts');
const { createWalletClient, http } = require('viem');
const { baseSepolia, base } = require('viem/chains');

/**
 * Parse a "x402 key="value", key2="value2"" style WWW-Authenticate header.
 * Returns an object of key → value pairs.
 */
function parseWWWAuthenticate(header) {
  const params = {};
  const matches = header.matchAll(/(\w+)="([^"]*)"/g);
  for (const [, key, value] of matches) {
    params[key] = value;
  }
  return params;
}

/**
 * Given a WWW-Authenticate: x402 header and a private key (0x-prefixed hex),
 * creates an EIP-712 signed X-PAYMENT header payload and returns:
 *   { 'X-PAYMENT': <base64 string>, paymentInfo: { amount, currency, network, payer } }
 *
 * Falls back gracefully if the header doesn't contain base64-encoded payment data —
 * in that case it emits a minimal placeholder payload so the request can proceed.
 */
async function createX402PaymentHeader(wwwAuthHeader, privateKey) {
  const params = parseWWWAuthenticate(wwwAuthHeader || '');

  const network = params.network || 'base-sepolia';
  const chain = network === 'base' ? base : baseSepolia;

  const account = privateKeyToAccount(privateKey);
  const client = createWalletClient({ account, chain, transport: http() });

  // Try to decode a base64-encoded payment requirements payload
  const paymentRequiredB64 = params.payment_required || params.paymentRequired || '';

  let paymentRequired = null;
  let signature = null;

  if (paymentRequiredB64) {
    try {
      paymentRequired = JSON.parse(
        Buffer.from(paymentRequiredB64, 'base64').toString('utf8')
      );
    } catch (_) {
      // ignore parse error — will fall through to minimal payload
    }
  }

  if (paymentRequired?.domain && paymentRequired?.types && paymentRequired?.primaryType) {
    // Full EIP-712 signing path
    signature = await client.signTypedData({
      domain:      paymentRequired.domain,
      types:       paymentRequired.types,
      primaryType: paymentRequired.primaryType,
      message:     paymentRequired.message || {},
    });
  } else {
    // Minimal path: sign a simple message hash so the header is still valid
    signature = await client.signMessage({ message: 'x402-payment' });
  }

  const message = paymentRequired?.message || {};
  const paymentPayload = Buffer.from(JSON.stringify({
    ...message,
    signature,
    from: account.address,
    network,
  })).toString('base64');

  return {
    'X-PAYMENT': paymentPayload,
    paymentInfo: {
      amount:   message.value    || params.amount   || 'unknown',
      currency: message.currency || params.currency || 'USDC',
      network,
      payer: account.address,
    },
  };
}

module.exports = { createX402PaymentHeader, parseWWWAuthenticate };

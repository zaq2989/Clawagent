'use strict';
// src/payment/x402Client.js — viem-based x402 payment client
// Supports both the legacy createX402PaymentHeader API and the new createX402Proof API

const { privateKeyToAccount } = require('viem/accounts');
const { createWalletClient, http } = require('viem');
const { baseSepolia, base } = require('viem/chains');

/**
 * Parse a "x402 key="value", key2="value2"" style WWW-Authenticate header.
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
 * New API: createX402Proof
 * Returns { proof, scheme, payer, header_value }
 * header_value is the base64 string for the X-PAYMENT header.
 */
async function createX402Proof(wwwAuthenticate, privateKey) {
  const account = privateKeyToAccount(privateKey);

  const params = parseWWWAuthenticate(wwwAuthenticate || '');

  const message = {
    from: account.address,
    scheme: 'x402',
    params,
    timestamp: Date.now(),
  };

  const signature = await account.signMessage({ message: JSON.stringify(message) });

  const proof = Buffer.from(JSON.stringify({ message, signature })).toString('base64');

  return {
    proof,
    scheme: 'x402',
    payer: account.address,
    header_value: proof,
  };
}

/**
 * Legacy API: createX402PaymentHeader
 * Kept for backward compatibility with existing code.
 */
async function createX402PaymentHeader(wwwAuthHeader, privateKey) {
  const params = parseWWWAuthenticate(wwwAuthHeader || '');

  const network = params.network || 'base-sepolia';
  const chain = network === 'base' ? base : baseSepolia;

  const account = privateKeyToAccount(privateKey);
  const client = createWalletClient({ account, chain, transport: http() });

  const paymentRequiredB64 = params.payment_required || params.paymentRequired || '';

  let paymentRequired = null;
  let signature = null;

  if (paymentRequiredB64) {
    try {
      paymentRequired = JSON.parse(
        Buffer.from(paymentRequiredB64, 'base64').toString('utf8')
      );
    } catch (_) {
      // ignore parse error
    }
  }

  if (paymentRequired?.domain && paymentRequired?.types && paymentRequired?.primaryType) {
    signature = await client.signTypedData({
      domain:      paymentRequired.domain,
      types:       paymentRequired.types,
      primaryType: paymentRequired.primaryType,
      message:     paymentRequired.message || {},
    });
  } else {
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

module.exports = { createX402Proof, createX402PaymentHeader, parseWWWAuthenticate };

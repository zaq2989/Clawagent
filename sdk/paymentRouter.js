'use strict';

/**
 * SDK Payment Router
 * Bundled copy of src/payment/router.js for use in the npm package.
 * Routes WWW-Authenticate headers to the appropriate payment client.
 */

function detectScheme(wwwAuthenticate) {
  const header = (wwwAuthenticate || '').toLowerCase().trim();
  if (header.startsWith('xmr402')) return 'xmr402';
  if (header.startsWith('intmax402')) return 'intmax402';
  if (header.startsWith('x402')) return 'x402';
  return 'unknown';
}

async function routePayment(wwwAuthenticate, paymentConfig) {
  const scheme = detectScheme(wwwAuthenticate);

  switch (scheme) {
    case 'x402': {
      if (!paymentConfig?.x402?.privateKey) {
        return { error: 'x402 payment requires x402.privateKey in SDK config' };
      }
      return createX402Proof(wwwAuthenticate, paymentConfig.x402.privateKey);
    }

    case 'xmr402': {
      if (!paymentConfig?.xmr402) {
        return { error: 'xmr402 payment requires xmr402 config in SDK config' };
      }
      return createXMR402Proof(wwwAuthenticate, paymentConfig.xmr402);
    }

    case 'intmax402': {
      if (!paymentConfig?.intmax402?.ethPrivateKey) {
        return { error: 'intmax402 payment requires intmax402.ethPrivateKey in SDK config' };
      }
      return createIntmax402Proof(wwwAuthenticate, paymentConfig.intmax402);
    }

    default:
      return { error: `Unknown payment scheme: ${scheme}` };
  }
}

// ── x402 ─────────────────────────────────────────────────────────────────────

async function createX402Proof(wwwAuthenticate, privateKey) {
  try {
    const { privateKeyToAccount } = require('viem/accounts');
    const account = privateKeyToAccount(privateKey);

    const params = {};
    for (const [, key, value] of (wwwAuthenticate || '').matchAll(/(\w+)="([^"]*)"/g)) {
      params[key] = value;
    }

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
  } catch (e) {
    return { error: `x402 signing failed: ${e.message}` };
  }
}

// ── xmr402 ───────────────────────────────────────────────────────────────────

async function createXMR402Proof(wwwAuthenticate, config) {
  const params = {};
  for (const [, key, value] of (wwwAuthenticate || '').matchAll(/(\w+)="([^"]*)"/g)) {
    params[key] = value;
  }

  const { address, amount, message, timestamp } = params;

  if (!address || !amount) {
    return { error: 'Invalid XMR402 challenge: missing address or amount' };
  }

  if (config.walletRpcUrl) {
    try {
      const txRes = await fetch(`${config.walletRpcUrl}/json_rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: '0',
          method: 'transfer',
          params: {
            destinations: [{ amount: parseInt(amount), address }],
            payment_id: message || undefined,
            get_tx_proof: true,
          },
        }),
      });
      const txData = await txRes.json();
      if (txData.error) return { error: `XMR wallet error: ${txData.error.message}` };
      const { tx_hash, tx_proof } = txData.result;
      return {
        proof: tx_proof,
        scheme: 'xmr402',
        txid: tx_hash,
        header_name: 'Authorization',
        header_value: `XMR402 txid="${tx_hash}", proof="${tx_proof}"`,
      };
    } catch (e) {
      return { error: `XMR402 wallet RPC error: ${e.message}` };
    }
  }

  return {
    scheme: 'xmr402',
    status: 'proof_pending',
    payment_request: {
      address,
      amount_piconero: parseInt(amount),
      amount_xmr: parseInt(amount) / 1e12,
      message,
      timestamp,
    },
    instructions: `Send ${parseInt(amount) / 1e12} XMR to ${address} with payment_id: ${message}`,
  };
}

// ── intmax402 ─────────────────────────────────────────────────────────────────

async function createIntmax402Proof(wwwAuthenticate, config) {
  const { ethPrivateKey, environment = 'mainnet' } = config;

  const params = {};
  for (const [, key, value] of (wwwAuthenticate || '').matchAll(/(\w+)="([^"]*)"/g)) {
    params[key] = value;
  }

  try {
    const { INTMAX402Client } = require('@tanakayuto/intmax402-client');
    const client = new INTMAX402Client({ eth_private_key: ethPrivateKey, environment });
    const proof = await client.createPaymentProof({ wwwAuthenticate, ...params });
    return {
      scheme: 'intmax402',
      proof,
      header_name: 'Authorization',
      header_value: `intmax402 proof="${proof}"`,
    };
  } catch (e) {
    return {
      scheme: 'intmax402',
      status: 'proof_pending',
      error: e.message,
      payment_request: params,
    };
  }
}

module.exports = { routePayment, detectScheme };

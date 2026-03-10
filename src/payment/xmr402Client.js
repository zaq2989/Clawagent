'use strict';

/**
 * XMR402 Payment Client
 *
 * WWW-Authenticate spec:
 *   XMR402 address="<subaddress>", amount="<piconero>", message="<nonce>", timestamp="<unix_ms>"
 *
 * Authorization response:
 *   Authorization: XMR402 txid="<hash>", proof="<signature>"
 *
 * Full flow requires a Monero Wallet RPC.
 * Config: { walletRpcUrl: "http://...", walletPassword: "..." }
 *
 * Without wallet RPC: returns proof_pending for manual handling.
 */
async function createXMR402Proof(wwwAuthenticate, config) {
  const params = {};
  for (const [, key, value] of wwwAuthenticate.matchAll(/(\w+)="([^"]*)"/g)) {
    params[key] = value;
  }

  const { address, amount, message, timestamp } = params;

  if (!address || !amount) {
    return { error: 'Invalid XMR402 challenge: missing address or amount' };
  }

  // Monero Wallet RPCが設定されている場合は実際に送金
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

      if (txData.error) {
        return { error: `XMR wallet error: ${txData.error.message}` };
      }

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

  // Wallet RPC未設定: proof_pending を返す（呼び出し側で手動送金）
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

module.exports = { createXMR402Proof };

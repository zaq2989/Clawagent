// x402-client.js — browser-side x402 payment client
// ethers.js v6 must be loaded before this script (CDN in marketplace.html)

const X402_RESOURCE = 'https://clawagent-production.up.railway.app/api/tasks/create';
const X402_NETWORK = 'base-sepolia';

/**
 * Fetch with x402 payment flow:
 * 1. First request → expect 402 with payment requirements
 * 2. Sign payload with MetaMask / EIP-1193 wallet
 * 3. Retry with X-PAYMENT header
 */
async function fetchWithX402(url, options = {}) {
  // First request — may return 402
  const firstRes = await fetch(url, options);
  if (firstRes.status !== 402) return firstRes;

  const paymentRequired = await firstRes.json();

  // Find the 'exact' payment scheme
  const scheme = (paymentRequired.accepts || []).find(a => a.scheme === 'exact');
  if (!scheme) throw new Error('No supported payment scheme in 402 response');

  // Check for MetaMask / EIP-1193 wallet
  if (!window.ethereum) {
    throw new Error('No wallet found. Please install MetaMask and connect to Base Sepolia.');
  }

  // Connect wallet
  const provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send('eth_requestAccounts', []);
  const signer = await provider.getSigner();

  // Build x402 payment payload
  const nonce = Date.now().toString();
  const expiresAt = Math.floor(Date.now() / 1000) + 300; // 5 minutes

  const payload = {
    scheme: 'exact',
    network: scheme.network || X402_NETWORK,
    resource: scheme.resource || X402_RESOURCE,
    maxAmountRequired: scheme.maxAmountRequired,
    payTo: scheme.payTo || scheme.recipient,
    nonce,
    expiresAt,
  };

  // Sign the payload as a personal message
  const message = JSON.stringify(payload);
  const signature = await signer.signMessage(message);

  // Encode payment as base64 JSON
  const xPayment = btoa(JSON.stringify({ ...payload, signature }));

  // Retry with X-PAYMENT header
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      'X-PAYMENT': xPayment,
    },
  });
}

window.X402Client = { fetchWithX402 };

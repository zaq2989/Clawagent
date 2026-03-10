'use strict';

/**
 * Payment Router
 * WWW-Authenticateヘッダーを解析して適切なPayment Clientにルーティング
 */
async function routePayment(wwwAuthenticate, paymentConfig) {
  const scheme = detectScheme(wwwAuthenticate);

  switch (scheme) {
    case 'x402': {
      if (!paymentConfig?.x402?.privateKey) {
        return { error: 'x402 payment requires x402.privateKey in SDK config' };
      }
      const { createX402Proof } = require('./x402Client');
      return createX402Proof(wwwAuthenticate, paymentConfig.x402.privateKey);
    }

    case 'xmr402': {
      if (!paymentConfig?.xmr402) {
        return { error: 'xmr402 payment requires xmr402 config in SDK config' };
      }
      const { createXMR402Proof } = require('./xmr402Client');
      return createXMR402Proof(wwwAuthenticate, paymentConfig.xmr402);
    }

    case 'intmax402': {
      if (!paymentConfig?.intmax402?.ethPrivateKey) {
        return { error: 'intmax402 payment requires intmax402.ethPrivateKey in SDK config' };
      }
      const { createIntmax402Proof } = require('./intmax402Client');
      return createIntmax402Proof(wwwAuthenticate, paymentConfig.intmax402);
    }

    default:
      return { error: `Unknown payment scheme: ${scheme}` };
  }
}

function detectScheme(wwwAuthenticate) {
  const header = (wwwAuthenticate || '').toLowerCase().trim();
  if (header.startsWith('xmr402')) return 'xmr402';
  if (header.startsWith('intmax402')) return 'intmax402';
  if (header.startsWith('x402')) return 'x402';
  return 'unknown';
}

module.exports = { routePayment, detectScheme };

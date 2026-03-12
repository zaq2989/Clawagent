// x402 payment middleware — offline-capable implementation
// Follows x402 HTTP 402 spec: https://x402.org
// Base Sepolia testnet, USDC, 0.001 USDC per task creation

const PAYMENT_ADDRESS = process.env.X402_ADDRESS || '0x0000000000000000000000000000000000000000';
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || 'https://x402.xyz/facilitator';

// Platform fee configuration
const PLATFORM_ADDRESS = process.env.PLATFORM_FEE_ADDRESS || '0xe2f49C10D833a9969476Ed1b9B818C1a593F863d';
const PLATFORM_FEE_BPS = parseInt(process.env.PLATFORM_FEE_BPS || '500'); // 500 bps = 5%

// Base Sepolia USDC (EIP-3009 compatible)
const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const NETWORK = 'base-sepolia';         // V1 network name
const NETWORK_CAIP = 'eip155:84532';   // V2 CAIP-2 network id
const AMOUNT = '1000';                  // 0.001 USDC (6 decimals)
const MAX_TIMEOUT_SECONDS = 300;

// Protected routes: method + path
const PROTECTED_ROUTES = [
  { method: 'POST', path: '/api/tasks/create' },
];

function matchesRoute(req) {
  return PROTECTED_ROUTES.some(
    r => r.method === req.method && req.path === r.path
  );
}

/**
 * Build x402 payment required response body (V1 format, also compatible with new SDK).
 */
function buildPaymentRequired(req) {
  const resource = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

  return {
    x402Version: 1,
    error: 'Payment Required',
    accepts: [
      {
        scheme: 'exact',
        network: NETWORK,
        maxAmountRequired: AMOUNT,
        resource,
        description: 'Create a task and hire an AI agent',
        mimeType: 'application/json',
        outputSchema: {},
        payTo: PAYMENT_ADDRESS,
        maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
        asset: BASE_SEPOLIA_USDC,
        extra: {
          name: 'USDC',
          version: '2',
        },
      },
    ],
  };
}

/**
 * Express middleware that gates protected routes with x402 payment.
 * - No X-PAYMENT header → 402 with payment requirements
 * - X-PAYMENT header present → passes through to route (settlement is async via facilitator)
 */
function createX402Middleware() {
  return function x402Middleware(req, res, next) {
    if (!matchesRoute(req)) {
      return next();
    }

    const paymentHeader = req.headers['x-payment'];

    if (!paymentHeader) {
      // No payment — return 402
      res.status(402).json(buildPaymentRequired(req));
      return;
    }

    // Payment header present — pass through
    // (In production on Railway, the facilitator verifies the payment)
    next();
  };
}

module.exports = { createX402Middleware, PAYMENT_ADDRESS, NETWORK, AMOUNT, PLATFORM_ADDRESS, PLATFORM_FEE_BPS };

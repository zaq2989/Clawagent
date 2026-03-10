# claw-network

**AI Capability Internet SDK** — Resolve and call AI capabilities by name.

> Every capability should be: discoverable · addressable · callable · payable · trustable

## Install

```bash
npm install claw-network
# or globally for CLI
npm install -g claw-network
```

## Quick Start

```js
const { ClawNetwork } = require('claw-network');
const claw = new ClawNetwork();

// Call a capability directly
const result = await claw.call('sentiment', { text: 'This is amazing!' });
console.log(result.output); // { sentiment: 'positive', score: 1 }

// Resolve capability to providers
const providers = await claw.resolve('translate.en-ja');
console.log(providers);
```

## CLI

```bash
# Call a capability
claw call echo '{"text":"hello world"}'
claw call sentiment '{"text":"This is amazing!"}'
claw call detect.lang '{"text":"こんにちは"}'

# Resolve capability to providers
claw resolve translate.en-ja

# Register your agent
CLAW_API_KEY=your-key claw register ./my-agent.json
```

## Built-in Capabilities

| Capability | Short Name | Description |
|---|---|---|
| `echo.text` | `echo` | Echo input back |
| `analyze.sentiment` | `sentiment` | Positive/negative/neutral analysis |
| `detect.language` | `detect.lang` | Detect text language |
| `validate.json` | `validate` | Validate and parse JSON |
| `format.markdown` | `format.md` | Convert markdown to HTML |

## Register Your Agent

Create `capability.json`:
```json
{
  "name": "My Translate Agent",
  "endpoint": "https://my-agent.example.com/run",
  "capabilities": ["translate.text.en-ja"],
  "pricing": { "mode": "per_call", "price_per_call": 0.001, "currency": "ETH" },
  "input_schema": { "text": "string" },
  "output_schema": { "translated_text": "string" }
}
```

```bash
CLAW_API_KEY=your-key claw register capability.json
```

## API

### `GET /resolve?capability=<name>`
Resolve capability name to ranked list of providers.

### `POST /call`
```json
{ "capability": "sentiment", "input": { "text": "..." }, "budget": 0.01, "timeout_ms": 5000 }
```

### `GET /api/agents?capability=<name>`
List registered agents, optionally filtered by capability.

## Multi-Payment Support

Claw Network supports 3 payment rails, auto-selected based on the provider's `WWW-Authenticate` header:

| Rail | Currency | Privacy | Best For |
|------|----------|---------|----------|
| x402 | USDC (Base) | None | General use |
| xmr402 | XMR (Monero) | Full anonymity | Privacy-critical |
| intmax402 | ETH (ZK L2) | ZK Proof | High-trust / large amounts |

### Configure payment rails

```js
const claw = new ClawNetwork({
  payment: {
    x402:     { privateKey: process.env.USDC_KEY },          // USDC on Base
    xmr402:   { walletRpcUrl: 'http://127.0.0.1:18083' },    // Monero wallet RPC
    intmax402: { ethPrivateKey: process.env.ETH_KEY },        // ZK L2
  }
});

// Claw Network auto-selects the rail based on provider's WWW-Authenticate
const result = await claw.call('translate.en-ja', { text: 'hello' });
```

### Backward compatibility

```js
// Legacy: x402 only (still works)
const claw = new ClawNetwork({ privateKey: process.env.USDC_KEY });
```

### Payment flow

1. Provider returns `402 Payment Required` with `WWW-Authenticate` header
2. SDK detects scheme: `x402`, `xmr402`, or `intmax402`
3. SDK creates proof using the matching payment client
4. SDK retries request with `payment_proof` + `payment_scheme`

### Manual payment (proof_pending)

If the payment client cannot complete automatically (e.g. no wallet RPC for xmr402), it returns a `proof_pending` response with payment instructions:

```js
// result.status === 'proof_pending'
// result.payment_request → { address, amount_xmr, message }
// result.instructions → human-readable payment instructions
```

## Links
- 🌐 [Live API](https://clawagent-production.up.railway.app)
- 📖 [API Docs](https://clawagent-production.up.railway.app/docs/)
- 🔗 [GitHub](https://github.com/zaq2989/Clawagent)

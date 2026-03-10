# Claw Network — Architecture & Design Decisions

## Overview

Claw Network is a routing and discovery layer. It does **not** execute capabilities itself (except built-ins), and it does **not** hold user funds or keys. It is a stateless intermediary.

## Core Principles

### 1. Trust is at the edges
Claw Network routes requests but does not validate business logic. Payment verification, output validation, and rate limiting are responsibilities of the provider.

This is intentional: Claw Network should remain lightweight and neutral.

### 2. payment_proof is passed through, not verified
When a caller provides `payment_proof`, Claw Network forwards it to the provider as an HTTP header without verifying its validity.

**Why**: Payment proof verification requires blockchain state access, which would couple Claw Network to specific chains. Providers are responsible for verifying payment using their own facilitators (e.g., x402.xyz for USDC, Monero wallet for XMR).

**Security implication**: A fake payment_proof will be rejected by the provider (HTTP 403/402), not by Claw Network. This is acceptable because the caller only succeeds if the provider accepts the proof.

### 3. Reputation is advisory, not authoritative
Reputation scores influence routing but do not block access. A low-reputation provider can still be called directly via `payment_proof`. Reputation is a soft signal for automated routing.

### 4. Federation is loop-safe by design
The `federated=true` query parameter prevents re-broadcasting to peers. Each node adds itself to the `visited` list before forwarding. Nodes in the `visited` list are skipped.

### 5. Keys never leave the client
Private keys for payment are configured in the SDK (client-side). Claw Network never receives, stores, or logs private keys. The server receives only signed proofs.

## Payment Architecture

```
Client (SDK)                 Claw Network              Provider
    │                             │                        │
    │─── POST /call ─────────────▶│                        │
    │                             │─── POST endpoint ─────▶│
    │                             │◀── 402 WWW-Auth ───────│
    │◀── { status: payment_req,   │                        │
    │      www_authenticate } ────│                        │
    │                             │                        │
    │ [client signs payment]      │                        │
    │                             │                        │
    │─── POST /call ─────────────▶│                        │
    │    { payment_proof }        │─── POST + X-PAYMENT ──▶│
    │                             │◀── 200 output ─────────│
    │◀── { status: success } ─────│                        │
```

## Capability Scoring

```
score = reputation_score × 0.35
      + success_rate × 100 × 0.35
      - price_per_call × 1000 × 0.1
      - latency_ms / 100 × 0.1
      + verified_bonus (10 if verified, 0 otherwise)
```

Reputation and success_rate are updated after each `/call` execution based on actual outcomes.

## Security Boundaries

| What Claw Network protects | What it delegates |
|---|---|
| SSRF in peer/endpoint registration | Payment validity |
| SQL injection | Output content validation |
| Rate limiting (30 req/min/IP) | Business logic errors |
| Payload size (1MB) | Provider authentication |
| Admin API access | Payer wallet security |
| Federation loops | Smart contract execution |

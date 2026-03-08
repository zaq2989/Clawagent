# ClawAgent × intmax402 Demo

End-to-end demo of AI-to-AI payment using [intmax402](https://github.com/zaq2989/intmax402) — HTTP 402 payment gate on INTMAX ZK L2.

## How it works

1. Agent A requests a resource from Agent B
2. Agent B responds with **402 Payment Required** + payment challenge (nonce, amount, chainId)
3. Agent A sends ETH on **INTMAX L2** (zero-knowledge, private)
4. Agent A presents proof (txHash + signature)
5. Agent B verifies on-chain and grants access

## Network

| | Mainnet (default) | Testnet |
|---|---|---|
| L1 | Ethereum (chainId=1) | Sepolia (chainId=11155111) |
| L2 | Scroll (chainId=534352) | Scroll Sepolia (chainId=534351) |
| L1 RPC | `https://api.rpc.intmax.io?network=ethereum` | `https://ethereum-sepolia-rpc.publicnode.com` |

## Quick Start (Mainnet)

```bash
# Terminal 1: Start Agent B (server)
node demo/payment-server.js

# Terminal 2: Run Agent A (client)
CLIENT_PRIVATE_KEY=0x<your-key> node demo/payment-demo.js
```

**Requirements:** Agent A must have ETH deposited on INTMAX mainnet.  
Deposit at: https://intmax.io

## Quick Start (Testnet)

1. Edit `payment-server.js` and `payment-demo.js`: set `environment: "testnet"` and `L1_RPC: "https://ethereum-sepolia-rpc.publicnode.com"`
2. Get Sepolia ETH: https://sepoliafaucet.com
3. Deposit to INTMAX testnet: https://intmax.io
4. Run same commands above

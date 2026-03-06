# ClawAgent × intmax402 Demo

AI エージェント間の認証デモ — Agent A が Agent B の有料 API に intmax402 プロトコルで自動認証してアクセスします。

---

## 概要 / Overview

```
Agent A (買い手)                         Agent B (売り手)
  |                                          |
  |──── GET /intelligence ──────────────────>|
  |<─── 401 + WWW-Authenticate (nonce) ─────|
  |                                          |
  |  [ウォレットで nonce に署名]              |
  |                                          |
  |──── GET /intelligence + Authorization ──>|
  |     address="0x...", nonce="...",        |
  |     signature="0x..."                    |
  |<─── 200 OK + 機密情報 ──────────────────|
```

### 何が起きているか

1. **Agent A** はランダムに Ethereum ウォレットを生成（身元証明）
2. **Agent B** の `/intelligence` エンドポイントにアクセス → `401 Unauthorized` + INTMAX402 チャレンジ（nonce）を受信
3. **Agent A** は自分の秘密鍵で nonce に署名
4. 署名を `Authorization` ヘッダーに乗せて再リクエスト
5. **Agent B** が署名を検証 → 正当なエージェントと認定 → 機密情報を返す

### ポイント
- **事前登録不要** — ウォレットアドレスさえあれば誰でも認証可能
- **ガスフリー** — identity mode はオンチェーン取引なし（署名のみ）
- **AI ネイティブ** — エージェントが自律的に認証フローを完結

---

## 起動方法 / Quick Start

```bash
cd /home/zaq/Projects/clawagent
bash demo/run-demo.sh
```

### 期待される出力

```
🚀 ClawAgent × intmax402 Demo
================================
Starting Agent B server...
Agent B listening on http://localhost:3770
Agent A connecting...

🤖 Agent A initialized
   Wallet address : 0x1234...abcd
   (ephemeral — generated fresh each run)

📡 Step 0: GET /free (no auth required)
   → 200 OK
   → {"message":"Hello from Agent B!","agent":"ClawAgent-B"}

📡 Step 1: GET /intelligence (no auth)
   → 401 Unauthorized + INTMAX402 challenge
   → {"error":"Unauthorized","protocol":"INTMAX402","mode":"identity"}
   → nonce: a1b2c3d4e5f6g7h8...

🔐 Step 2: Signing challenge with wallet 0x1234...
   → Signed nonce & sent Authorization header

✅ Step 3: GET /intelligence + Authorization
   → 200 OK
   → {
       "intelligence": "🔐 CLASSIFIED: ...",
       "accessedBy": "0x1234...abcd",
       "timestamp": "2026-03-07T...",
       "protocol": "INTMAX402"
     }

🎉 Demo complete! AI Agent authenticated via INTMAX402 protocol.
```

---

## INTMAX402 プロトコルについて / About INTMAX402

**INTMAX402** は HTTP 402 Payment Required を拡張した AI エージェント向け認証・決済プロトコルです。

| モード | 用途 | 仕組み |
|--------|------|--------|
| `identity` | 身元確認のみ | Ethereum 署名でウォレットアドレスを証明 |
| `payment` | 実際の支払い | INTMAX2 ZK ロールアップで少額決済 |

### エンドポイント構成

| エンドポイント | 認証 | 説明 |
|----------------|------|------|
| `GET /free` | 不要 | 誰でもアクセス可能 |
| `GET /intelligence` | intmax402 identity | 署名付き Ethereum ウォレットが必要 |

### パッケージ

- **`@tanakayuto/intmax402-express`** — Express ミドルウェア（サーバー側）
- **`@tanakayuto/intmax402-client`** — 自動認証クライアント（エージェント側）
- GitHub: https://github.com/zaq2989/intmax402

---

## ファイル構成 / Structure

```
demo/
├── server.js      # Agent B — intmax402 で保護された API サーバー (port 3770)
├── client.js      # Agent A — 自動認証クライアント
├── run-demo.sh    # デモ実行スクリプト
├── package.json   # ESM + 依存パッケージ
└── README.md      # このファイル
```

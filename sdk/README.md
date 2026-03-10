# claw-network

SDK for Claw Network — AI Capability Internet.

## Install

```
npm install claw-network
```

## Usage

```js
const { ClawNetwork } = require('claw-network');
const claw = new ClawNetwork();

// Resolve capability to providers
const providers = await claw.resolve('translate.en-ja');

// Call a capability directly
const result = await claw.call('translate.en-ja', { text: 'Hello' });

// List agents (optionally filtered by capability)
const agents = await claw.listAgents('translate.text.en-ja');
```

## Options

```js
const claw = new ClawNetwork({
  baseUrl: 'https://clawagent-production.up.railway.app', // default
  apiKey: 'your-api-key',                                 // optional
});
```

## `call()` Options

```js
const result = await claw.call('translate.en-ja', { text: 'Hello' }, {
  budget: 0.01,     // max price per call in ETH (skip providers over budget)
  timeout_ms: 5000, // max wait time in ms
});
```

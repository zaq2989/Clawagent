"""Claw Network Python SDK — AI Capability Internet"""
import httpx
import json
from typing import Optional, Any

DEFAULT_BASE_URL = "https://clawagent-production.up.railway.app"

class ClawNetwork:
    def __init__(self, base_url: str = DEFAULT_BASE_URL, api_key: Optional[str] = None,
                 private_key: Optional[str] = None):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.private_key = private_key  # client-side payer key
        self._client = httpx.Client(timeout=30.0)

    def _headers(self) -> dict:
        h = {"Content-Type": "application/json"}
        if self.api_key:
            h["X-API-Key"] = self.api_key
        return h

    def resolve(self, capability: str) -> dict:
        """Resolve a capability name to a list of providers."""
        r = self._client.get(f"{self.base_url}/resolve", params={"capability": capability})
        r.raise_for_status()
        return r.json()

    def _post(self, path: str, body: dict) -> dict:
        r = self._client.post(f"{self.base_url}{path}", json=body, headers=self._headers())
        r.raise_for_status()
        return r.json()

    def _create_payment_proof(self, www_authenticate: str) -> str:
        """Sign payment using eth_account (pip install eth-account)."""
        try:
            from eth_account import Account
            import json, base64, time
            account = Account.from_key(self.private_key)
            payload = json.dumps({"from": account.address, "www_authenticate": www_authenticate,
                                  "timestamp": int(time.time())})
            signed = account.sign_message(payload.encode())
            return base64.b64encode(
                json.dumps({"payload": payload, "signature": signed.signature.hex()}).encode()
            ).decode()
        except ImportError:
            raise ImportError("pip install eth-account required for payment support")

    def call(self, capability: str, input: dict = {}, budget: Optional[float] = None,
             timeout_ms: int = 5000, **kwargs) -> dict:
        """Call a capability and return the result.

        Args:
            capability: The capability name (e.g. "task.run.general").
            input:      Payload forwarded to the provider.
            budget:     Max price_per_call in ETH to filter providers.
            timeout_ms: Provider call timeout in milliseconds.

        If the server returns payment_required and self.private_key is set,
        the SDK automatically signs the payment and retries (client-side flow).
        """
        body = {"capability": capability, "input": input, "timeout_ms": timeout_ms}
        if budget is not None:
            body["budget"] = budget

        result = self._post("/call", body)

        # Client-side payment: sign and retry
        if result.get("status") == "payment_required" and result.get("www_authenticate") and self.private_key:
            payment_proof = self._create_payment_proof(result["www_authenticate"])
            result = self._post("/call", {**body, "payment_proof": payment_proof})

        return result

    def call_async(self, capability: str, input: dict = {}, budget: Optional[float] = None) -> dict:
        """Start an async capability call. Returns job_id."""
        body = {"capability": capability, "input": input}
        if budget is not None:
            body["budget"] = budget
        r = self._client.post(f"{self.base_url}/call/async", json=body, headers=self._headers())
        r.raise_for_status()
        return r.json()

    def get_job(self, job_id: str) -> dict:
        """Poll job status."""
        r = self._client.get(f"{self.base_url}/jobs/{job_id}")
        r.raise_for_status()
        return r.json()

    def search(self, query: str) -> dict:
        """Search capabilities by natural language query."""
        r = self._client.get(f"{self.base_url}/search", params={"q": query})
        r.raise_for_status()
        return r.json()

    def list_agents(self, capability: Optional[str] = None) -> dict:
        """List registered agents."""
        params = {}
        if capability:
            params["capability"] = capability
        r = self._client.get(f"{self.base_url}/api/agents", params=params)
        r.raise_for_status()
        return r.json()

    def close(self):
        self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


# Async client
class AsyncClawNetwork:
    def __init__(self, base_url: str = DEFAULT_BASE_URL, api_key: Optional[str] = None):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key

    def _headers(self) -> dict:
        h = {"Content-Type": "application/json"}
        if self.api_key:
            h["X-API-Key"] = self.api_key
        return h

    async def resolve(self, capability: str) -> dict:
        async with httpx.AsyncClient(timeout=30.0) as c:
            r = await c.get(f"{self.base_url}/resolve", params={"capability": capability})
            r.raise_for_status()
            return r.json()

    async def call(self, capability: str, input: dict = {}, budget: Optional[float] = None,
                   timeout_ms: int = 5000, payer: Optional[dict] = None) -> dict:
        """Call a capability. Supports x402 payments via payer={"key_env": "MY_KEY"}."""
        body = {"capability": capability, "input": input, "timeout_ms": timeout_ms}
        if budget is not None:
            body["budget"] = budget
        if payer is not None:
            body["payer"] = payer
        async with httpx.AsyncClient(timeout=30.0) as c:
            r = await c.post(f"{self.base_url}/call", json=body, headers=self._headers())
            r.raise_for_status()
            return r.json()

    async def call_async(self, capability: str, input: dict = {}, budget: Optional[float] = None) -> dict:
        body = {"capability": capability, "input": input}
        if budget is not None:
            body["budget"] = budget
        async with httpx.AsyncClient(timeout=30.0) as c:
            r = await c.post(f"{self.base_url}/call/async", json=body, headers=self._headers())
            r.raise_for_status()
            return r.json()

    async def get_job(self, job_id: str) -> dict:
        async with httpx.AsyncClient(timeout=30.0) as c:
            r = await c.get(f"{self.base_url}/jobs/{job_id}")
            r.raise_for_status()
            return r.json()

    async def search(self, query: str) -> dict:
        async with httpx.AsyncClient(timeout=30.0) as c:
            r = await c.get(f"{self.base_url}/search", params={"q": query})
            r.raise_for_status()
            return r.json()

    async def list_agents(self, capability: Optional[str] = None) -> dict:
        params = {}
        if capability:
            params["capability"] = capability
        async with httpx.AsyncClient(timeout=30.0) as c:
            r = await c.get(f"{self.base_url}/api/agents", params=params)
            r.raise_for_status()
            return r.json()


__all__ = ["ClawNetwork", "AsyncClawNetwork", "DEFAULT_BASE_URL"]

"""Claw Network Python SDK — AI Capability Internet"""
import httpx
import json
from typing import Optional, Any

DEFAULT_BASE_URL = "https://clawagent-production.up.railway.app"

class ClawNetwork:
    def __init__(self, base_url: str = DEFAULT_BASE_URL, api_key: Optional[str] = None):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
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

    def call(self, capability: str, input: dict = {}, budget: Optional[float] = None, timeout_ms: int = 5000) -> dict:
        """Call a capability and return the result."""
        body = {"capability": capability, "input": input, "timeout_ms": timeout_ms}
        if budget is not None:
            body["budget"] = budget
        r = self._client.post(f"{self.base_url}/call", json=body, headers=self._headers())
        r.raise_for_status()
        return r.json()

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

    async def call(self, capability: str, input: dict = {}, budget: Optional[float] = None, timeout_ms: int = 5000) -> dict:
        body = {"capability": capability, "input": input, "timeout_ms": timeout_ms}
        if budget is not None:
            body["budget"] = budget
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

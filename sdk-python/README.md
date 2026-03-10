# claw-network (Python)

Python SDK for Claw Network — AI Capability Internet.

## Install

```bash
pip install claw-network
```

## Usage

```python
from claw_network import ClawNetwork

claw = ClawNetwork()

# Call a capability
result = claw.call("sentiment", {"text": "This is amazing!"})
print(result["output"])  # {"sentiment": "positive", "score": 1}

# Search capabilities by natural language
results = claw.search("translate japanese")
for r in results["results"]:
    print(r["capability"], r["score"])

# Resolve providers for a capability
providers = claw.resolve("echo.text")
print(providers)

# Async capability call (returns job_id immediately)
job = claw.call_async("echo", {"text": "hello"})
print(job["job_id"])  # poll with get_job()

# Poll job status
status = claw.get_job(job["job_id"])
print(status["status"])  # pending / running / done / failed

# List agents
agents = claw.list_agents()
print(agents["agents"])
```

## Async Client

```python
from claw_network import AsyncClawNetwork
import asyncio

async def main():
    claw = AsyncClawNetwork()
    result = await claw.call("echo", {"text": "hello"})
    print(result)

    results = await claw.search("translate japanese")
    print(results)

asyncio.run(main())
```

## Budget Control

```python
# Only use providers within 0.001 ETH
result = claw.call("translate.text.en-ja", {"text": "hello"}, budget=0.001)
```

## Custom Endpoint

```python
claw = ClawNetwork(base_url="http://localhost:3750")
```

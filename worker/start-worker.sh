#!/bin/bash
# Ollama Workerを起動するスクリプト
# 使い方: ./worker/start-worker.sh <api_key>
export CLAWAGENT_URL=${CLAWAGENT_URL:-"https://clawagent-production.up.railway.app"}
export CLAWAGENT_API_KEY=${1:-$CLAWAGENT_API_KEY}
export OLLAMA_URL=${OLLAMA_URL:-"http://localhost:11434"}
export OLLAMA_MODEL=${OLLAMA_MODEL:-"qwen2.5:7b"}
export WORKER_NAME=${WORKER_NAME:-"OllamaWorker-Local"}

node worker/ollama-worker.js

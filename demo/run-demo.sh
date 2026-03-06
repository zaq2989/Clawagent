#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "🚀 ClawAgent × intmax402 Demo"
echo "================================"
echo ""

# Install demo dependencies if needed
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  echo "📦 Installing demo dependencies..."
  cd "$SCRIPT_DIR"
  if command -v pnpm &>/dev/null; then
    pnpm install
  else
    npm install
  fi
  echo ""
fi

cd "$PROJECT_DIR"

echo "Starting Agent B server..."
node demo/server.js &
SERVER_PID=$!

# Give the server time to start
sleep 2

echo "Agent A connecting..."
node demo/client.js
EXIT_CODE=$?

# Clean up
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

exit $EXIT_CODE

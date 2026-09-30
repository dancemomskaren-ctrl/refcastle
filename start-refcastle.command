#!/bin/bash
# Double-click launcher for RefCastle. Starts the local server and opens the site.
# Stop the server with Ctrl+C, or by closing this Terminal window.

set -u
cd "$HOME/refcastle" 2>/dev/null || { echo "RefCastle not found at ~/refcastle"; exit 1; }

if [ ! -x "./node_modules/.bin/bun" ]; then
  echo "Dependencies are missing. Run once from Terminal:"
  echo "  cd ~/refcastle && npm ci"
  exit 1
fi

# Already running? Just open the site.
if curl -s -o /dev/null --max-time 2 http://127.0.0.1:4318/; then
  echo "RefCastle is already running — opening the site."
  open "http://127.0.0.1:4318"
  exit 0
fi

echo "Starting RefCastle… (Ctrl+C to stop)"
# Open the browser once the server responds.
( for _ in 1 2 3 4 5 6 7 8 9 10; do
    sleep 1
    curl -s -o /dev/null --max-time 2 http://127.0.0.1:4318/ && { open "http://127.0.0.1:4318"; break; }
  done ) >/dev/null 2>&1 &

./node_modules/.bin/bun server.ts
echo "RefCastle stopped."

#!/bin/bash
echo ""
echo "  ⚡ ChrxGPT"
echo "  ─────────────────"
echo ""

# Start proxy
echo "  🔀 Starting proxy..."
node server.mjs &
PROXY_PID=$!
sleep 1

# Start frontend
echo "  🌐 Starting frontend..."
npm run dev &
VITE_PID=$!

echo ""
echo "  ✅ ChrxGPT is live!"
echo ""
echo "  Press Ctrl+C to stop."
echo ""

trap "kill $PROXY_PID $VITE_PID 2>/dev/null; exit" SIGINT SIGTERM
wait

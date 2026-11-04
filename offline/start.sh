#!/data/data/com.termux/files/usr/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is missing. In Termux, install it with: pkg install nodejs"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing CBT HUB dependencies..."
  npm install
fi

echo "Starting CBT HUB on this device..."
echo "Keep this app open during exams."
echo "Connect student laptops to the same Wi-Fi or hotspot."
echo "Open http://DEVICE-IP:3000 on student laptops."
echo "Press Ctrl+C to stop."
npm start

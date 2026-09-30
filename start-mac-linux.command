#!/bin/bash
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  echo "First-time setup - installing dependencies (this can take a minute)..."
  npm install
fi
echo "Starting Story Creator - it will open in your browser automatically."
npm run dev -- --open

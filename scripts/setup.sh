#!/bin/bash
set -e

echo "=== Cubert Setup ==="

# Check prerequisites
command -v docker >/dev/null 2>&1 || { echo "Docker required"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Node.js required"; exit 1; }

# Copy env file if not exists
[ ! -f .env ] && cp .env.example .env

echo "Installing dependencies..."
cd packages/body && npm install && cd ../..
cd packages/brain && npm install && cd ../..
cd tools/scenario-runner && npm install && cd ../..

echo "=== Setup Complete ==="
echo ""
echo "To start the development stack:"
echo "  ./scripts/dev.sh"
echo ""
echo "To run a specific scenario:"
echo "  ./scripts/dev.sh gold-mining"

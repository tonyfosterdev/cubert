#!/bin/bash
set -e

SCENARIO=${1:-gold-mining}
export SCENARIO

echo "=== Starting Cubert (Scenario: $SCENARIO) ==="
docker compose up --build

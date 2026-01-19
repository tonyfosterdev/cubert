#!/bin/bash
set -e

SCENARIO=${1:-gold-mining}

echo "=== Initializing Scenario: $SCENARIO ==="
docker compose run --rm -e SCENARIO=$SCENARIO scenario-init

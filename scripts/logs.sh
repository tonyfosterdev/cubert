#!/bin/bash

SERVICE=${1:-brain}

echo "=== Logs for $SERVICE ==="
docker compose logs -f $SERVICE

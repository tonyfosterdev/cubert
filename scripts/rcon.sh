#!/bin/bash
set -e

# Execute an RCON command
COMMAND="$@"

if [ -z "$COMMAND" ]; then
  echo "Usage: ./scripts/rcon.sh <command>"
  echo "Example: ./scripts/rcon.sh tp Cubert 0 65 0"
  exit 1
fi

docker compose exec minecraft rcon-cli "$COMMAND"

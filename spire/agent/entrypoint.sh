#!/bin/sh
set -e

echo "Waiting for join token..."
while [ ! -f /run/spire/join-token/token ]; do
  sleep 1
done

TOKEN=$(cat /run/spire/join-token/token)
echo "Got join token, starting agent..."

exec /opt/spire/bin/spire-agent run \
  -config /opt/spire/conf/agent/agent.conf \
  -joinToken "$TOKEN"

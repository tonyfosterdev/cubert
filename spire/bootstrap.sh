#!/bin/sh
set -e

echo "Waiting for SPIRE server to be ready..."
while ! /opt/spire/bin/spire-server healthcheck -socketPath /opt/spire/sockets/server.sock 2>/dev/null; do
  sleep 2
done

echo "SPIRE server is ready. Creating registration entries..."

# Register supervisor workload (Docker label selector)
/opt/spire/bin/spire-server entry create \
  -socketPath /opt/spire/sockets/server.sock \
  -spiffeID spiffe://cubert.local/supervisor \
  -parentID spiffe://cubert.local/agent \
  -selector docker:label:com.cubert.service:supervisor \
  || echo "Supervisor entry may already exist"

# Register brain workload (Docker label selector)
/opt/spire/bin/spire-server entry create \
  -socketPath /opt/spire/sockets/server.sock \
  -spiffeID spiffe://cubert.local/brain \
  -parentID spiffe://cubert.local/agent \
  -selector docker:label:com.cubert.service:brain \
  || echo "Brain entry may already exist"

# Register body workload (Docker label selector)
/opt/spire/bin/spire-server entry create \
  -socketPath /opt/spire/sockets/server.sock \
  -spiffeID spiffe://cubert.local/body \
  -parentID spiffe://cubert.local/agent \
  -selector docker:label:com.cubert.service:body \
  || echo "Body entry may already exist"

echo "Registration entries created. Generating join token..."

# Generate join token and write to shared volume
TOKEN=$(/opt/spire/bin/spire-server token generate \
  -socketPath /opt/spire/sockets/server.sock \
  -spiffeID spiffe://cubert.local/agent \
  -ttl 3600 | awk '{print $2}')

echo "$TOKEN" > /run/spire/join-token/token
echo "Join token written to /run/spire/join-token/token"

echo "Bootstrap complete."

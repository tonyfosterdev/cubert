#!/bin/bash
# Register SPIRE entries using Docker image hash selectors (production attestation).
# This provides cryptographic proof of which service version is running.
#
# Usage: ./scripts/spire-register-by-hash.sh
#
# Prerequisites:
#   - SPIRE server must be running and accessible
#   - Docker images must be built locally
#   - spire-server CLI must be available (run inside spire-server container)

set -euo pipefail

SPIRE_SOCKET="${SPIRE_SOCKET:-/opt/spire/sockets/server.sock}"
TRUST_DOMAIN="cubert.local"

echo "Building images and registering by hash..."

# Build production images
echo "Building supervisor image..."
docker build -t cubert-supervisor -f packages/supervisor/Dockerfile packages/supervisor/
SUPERVISOR_HASH=$(docker inspect --format='{{.Id}}' cubert-supervisor)

echo "Building brain image..."
docker build -t cubert-brain -f packages/brain/Dockerfile packages/brain/
BRAIN_HASH=$(docker inspect --format='{{.Id}}' cubert-brain)

echo "Building body image..."
docker build -t cubert-body -f packages/body/Dockerfile packages/body/
BODY_HASH=$(docker inspect --format='{{.Id}}' cubert-body)

echo ""
echo "Image hashes:"
echo "  supervisor: ${SUPERVISOR_HASH}"
echo "  brain:      ${BRAIN_HASH}"
echo "  body:       ${BODY_HASH}"
echo ""

# Register entries using image hash selectors
# These commands should be run inside the spire-server container:
echo "Run the following commands inside the spire-server container:"
echo ""
echo "# Register supervisor by image hash"
echo "spire-server entry create \\"
echo "  -socketPath ${SPIRE_SOCKET} \\"
echo "  -spiffeID spiffe://${TRUST_DOMAIN}/supervisor \\"
echo "  -parentID spiffe://${TRUST_DOMAIN}/agent \\"
echo "  -selector docker:image_id:${SUPERVISOR_HASH}"
echo ""
echo "# Register brain by image hash"
echo "spire-server entry create \\"
echo "  -socketPath ${SPIRE_SOCKET} \\"
echo "  -spiffeID spiffe://${TRUST_DOMAIN}/brain \\"
echo "  -parentID spiffe://${TRUST_DOMAIN}/agent \\"
echo "  -selector docker:image_id:${BRAIN_HASH}"
echo ""
echo "# Register body by image hash"
echo "spire-server entry create \\"
echo "  -socketPath ${SPIRE_SOCKET} \\"
echo "  -spiffeID spiffe://${TRUST_DOMAIN}/body \\"
echo "  -parentID spiffe://${TRUST_DOMAIN}/agent \\"
echo "  -selector docker:image_id:${BODY_HASH}"

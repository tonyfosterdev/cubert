# Supervisor Pattern with SPIRE mTLS

## Architecture

```
                    brain-network                body-network
                 +----------------+         +--------------------+
                 |                |         |                    |
  +----------+   |  +------------+|         |+------------+      |
  |  brain   |---+--|            ||---------|+   body     |      |
  +----------+   |  | supervisor ||         |+------------+      |
                 |  +------------+|         |      |             |
                 |                |         | +------------+     |
                 +----------------+         | | minecraft  |     |
                                            | +------------+     |
                                            +--------------------+
```

Both brain and body initiate mTLS connections **to** the supervisor (hub model). Network segmentation ensures they cannot talk directly. SPIRE provides X.509 SVIDs for mutual authentication.

## Concepts

- **SPIFFE**: Secure Production Identity Framework for Everyone. Defines a standard for service identity (SPIFFE IDs like `spiffe://cubert.local/brain`).
- **SPIRE**: The SPIFFE Runtime Environment. Issues and rotates X.509 certificates (SVIDs) to workloads.
- **SVID**: SPIFFE Verifiable Identity Document. An X.509 certificate with the SPIFFE ID encoded in the SAN URI field.
- **mTLS**: Mutual TLS. Both client and server present certificates and validate each other.

## Trust Domain

All services operate under `spiffe://cubert.local/`:

| Service    | SPIFFE ID                          |
|------------|-------------------------------------|
| Supervisor | `spiffe://cubert.local/supervisor` |
| Brain      | `spiffe://cubert.local/brain`      |
| Body       | `spiffe://cubert.local/body`       |

## How to Run

### Direct mode (no supervisor, existing behavior)

```bash
docker compose up
```

### Supervisor mode (with mTLS)

```bash
docker compose -f docker-compose.yml -f docker-compose.supervisor.yml up
```

The startup order is: SPIRE server -> bootstrap (creates entries + join token) -> SPIRE agent -> supervisor -> brain/body.

## Verifying Attestation

### Check SPIRE registration entries

```bash
docker compose -f docker-compose.yml -f docker-compose.supervisor.yml \
  exec spire-server spire-server entry show \
  -socketPath /opt/spire/sockets/server.sock
```

### Check agent logs for workload attestation

```bash
docker compose -f docker-compose.yml -f docker-compose.supervisor.yml \
  logs spire-agent
```

Look for lines like:
```
Workload attestation succeeded  spiffe_id=spiffe://cubert.local/supervisor
Workload attestation succeeded  spiffe_id=spiffe://cubert.local/brain
Workload attestation succeeded  spiffe_id=spiffe://cubert.local/body
```

### Check supervisor logs for SPIFFE IDs on connections

```bash
docker compose -f docker-compose.yml -f docker-compose.supervisor.yml \
  logs supervisor
```

Look for:
```
Body connected to supervisor  spiffeId=spiffe://cubert.local/body
Brain connected to supervisor  spiffeId=spiffe://cubert.local/brain
```

## Inspecting SVIDs

To inspect the X.509 certificate issued to a service:

```bash
# Fetch the SVID from within a container
docker compose -f docker-compose.yml -f docker-compose.supervisor.yml \
  exec supervisor cat /tmp/svid.pem | openssl x509 -text -noout
```

Look for:
- **Subject Alternative Name**: `URI:spiffe://cubert.local/supervisor`
- **Issuer**: The SPIRE CA

## Network Isolation

Verify that brain and body cannot communicate directly:

```bash
# This should fail (different networks)
docker compose -f docker-compose.yml -f docker-compose.supervisor.yml \
  exec brain ping -c 1 body

# This should succeed (both on brain-network)
docker compose -f docker-compose.yml -f docker-compose.supervisor.yml \
  exec brain ping -c 1 supervisor
```

## Production: Image Hash Attestation

For production, use image hash selectors instead of Docker labels:

```bash
./scripts/spire-register-by-hash.sh
```

This builds production images, extracts their sha256 digests, and outputs the SPIRE entry commands with `docker:image_id` selectors.

## Troubleshooting

### Agent not ready

If services fail with "No SVID available", the SPIRE agent may not be ready:

```bash
docker compose -f docker-compose.yml -f docker-compose.supervisor.yml \
  logs spire-agent
```

The agent needs to successfully attest to the server using the join token before it can issue SVIDs.

### Certificate issues

If mTLS connections fail, check that:
1. The SPIRE server is healthy and has registration entries
2. The agent has attested and is running
3. Docker labels match the registration entry selectors
4. The trust domain matches across all configs (`cubert.local`)

### Network connectivity

If the supervisor can't be reached:
1. Verify it's on both `brain-network` and `body-network`
2. Check that the service name resolution works (`supervisor:5100`)
3. Verify the port mapping in docker-compose

### SVID rotation warnings

The supervisor logs a warning on SVID rotation because `@grpc/grpc-js` doesn't support hot-swapping server credentials. For long-running deployments, plan periodic restarts or implement a graceful restart mechanism.

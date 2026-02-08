# Architecture Evolution: Accountability & Verifiability

This document describes the architectural changes made to Cubert since the [original design](https://www.tonyfoster.dev/meet-cubert-trust-judgment-and-lava/), which identified critical gaps in trust, accountability, and verifiability. The original post posed the questions; this is the engineering answer.

---

## Original Architecture

The initial Cubert design was a two-service system:

```
┌──────────────┐    bidirectional gRPC    ┌──────────────┐
│    Brain     │◄────────────────────────►│     Body     │
│  (Claude AI) │     insecure, direct     │ (Mineflayer) │
└──────────────┘                          └──────────────┘
```

- **Brain** called Claude to decide what to do. **Body** executed it.
- Communication was a single bidirectional gRPC stream on a shared network.
- No authentication — any service that could reach port 5000 could connect.
- No audit trail — when Cubert walked into lava, there was no way to determine whether the Brain saw the hazard and chose to proceed, or never received the sensor data at all.
- No verification — nothing prevented either service from lying about what happened.

The blog post identified the core problem: *"We can't even prove what happened."*

---

## What Changed

Four architectural additions address this, each layered on the one before it.

### 1. Network Partitioning

**Problem:** Brain and Body on the same network means either can reach the other directly. There is no enforcement point where policy or logging can be applied.

**Solution:** Brain and Body are placed on separate Docker bridge networks with no shared connectivity.

```
┌──────────────────────┐         ┌──────────────────────────────┐
│    brain-network     │         │       body-network           │
│                      │         │                              │
│  Brain  Prometheus   │         │  Body  Prometheus  Minecraft │
│                      │         │                    Scenario  │
└──────────────────────┘         └──────────────────────────────┘
           ▲                                ▲
           │    No direct path exists       │
           └────────────┬───────────────────┘
                        │
                   Supervisor
              (bridges both networks)
```

Brain cannot send a packet to Body. Body cannot send a packet to Brain. The only service with interfaces on both `brain-network` and `body-network` is the Supervisor (by design — it's the relay) and Prometheus (read-only metric scraping, not a communication channel). This isn't a software convention — it's enforced by Docker network isolation at the kernel level.

**Network membership summary (supervisor overlay):**
| Network | Services |
|---|---|
| `brain-network` | brain, supervisor, spire-agent, prometheus |
| `body-network` | body, supervisor, spire-agent, prometheus, minecraft, scenario |
| `spire-network` | spire-server, spire-bootstrap, spire-agent |
| `default` | supervisor, log-archiver, prometheus, grafana, loki, promtail, cadvisor, minecraft, scenario |

**What this buys:** Every message between Brain and Body *must* transit the Supervisor. There is no way to bypass the logging and authentication layer by going direct.

---

### 2. Supervisor (Authenticated Relay)

**Problem:** Even with network isolation, something has to relay messages and ensure only legitimate services connect.

**Solution:** A new `supervisor` service acts as the sole communication hub. It terminates two independent gRPC streams — one from Brain, one from Body — and relays messages between them.

```
                     brain-network
                          │
┌──────────┐    mTLS      │      mTLS    ┌──────────┐
│  Brain   │◄────────►┌───┴───┐◄────────►│   Body   │
│          │          │ Super-│          │          │
│          │          │ visor │          │          │
└──────────┘          └───┬───┘          └──────────┘
                          │
                     body-network
```

**Protocol change:** The original `BrainService.Connect()` RPC (single bidirectional stream) is replaced by two separate RPCs on a new `SupervisorService`:
- `BodyUplink(stream BodyMessage) returns (stream Action)` — Body connects here
- `BrainUplink(stream Action) returns (stream BodyMessage)` — Brain connects here

The Supervisor's relay logic is straightforward: data arriving on the Body stream is written to the Brain stream, and vice versa. But every message is logged with direction, type, and a content summary (position, health, action type, etc.). This creates the audit trail that the original architecture lacked entirely.

**Backward compatibility:** The original direct mode (`BrainService.Connect()`) still works. Supervisor mode is activated by setting `SUPERVISOR_HOST` — services detect the environment variable and switch their connection target and credential strategy accordingly.

---

### 3. SPIFFE/mTLS (Cryptographic Identity)

**Problem:** Network isolation prevents *accidental* direct communication, but doesn't authenticate *who* is connecting to the Supervisor. Without identity verification, a compromised or rogue container on the same network could impersonate Brain or Body.

**Solution:** SPIRE (the SPIFFE Runtime Environment) issues short-lived X.509 certificates to each service, identified by SPIFFE URIs:

| Service    | SPIFFE ID                          |
|------------|------------------------------------|
| Brain      | `spiffe://cubert.local/brain`      |
| Body       | `spiffe://cubert.local/body`       |
| Supervisor | `spiffe://cubert.local/supervisor` |

**How it works:**

1. **SPIRE Server** runs as the certificate authority for the `cubert.local` trust domain.
2. **SPIRE Agent** runs with access to the Docker socket and uses container labels (`com.cubert.service: brain`, etc.) to attest workload identity.
3. Each service runs a **SvidWatcher** that connects to the SPIRE Agent's Workload API via Unix socket, receives its X.509 SVID (certificate + private key + trust bundle), and keeps the stream open for automatic rotation.
4. Certificates are used to establish **mutual TLS** — both client and server present certificates and validate the peer against the shared trust bundle.

**Supervisor-side validation:** When a stream is established, the Supervisor extracts the peer certificate's Subject Alternative Name (a SPIFFE URI) and compares it against the expected ID for that RPC. A connection to `BodyUplink` must present `spiffe://cubert.local/body`; a connection to `BrainUplink` must present `spiffe://cubert.local/brain`. Mismatches are rejected and logged.

**Certificate rotation:** SPIRE rotates certificates before expiry. The SvidWatcher emits a `rotated` event; clients disconnect the existing gRPC connection, build new credentials from the fresh SVID, and reconnect. This keeps the compromise window small even if a key is leaked.

**What this buys:** Identity is no longer implicit (whoever happens to be on the network). It is cryptographically attested by a third party (SPIRE) and validated on every connection. The Supervisor knows *who* is talking, not just *what* is being said.

---

### 4. Log Archiver (Tamper-Evident Verification)

**Problem:** The Supervisor now logs everything, but logs stored on disk can be modified after the fact. If someone (or something) alters the logs, the audit trail is worthless.

**Solution:** A `log-archiver` service watches the Supervisor's rotated log files and creates cryptographic commitments that make tampering detectable — and anchors those commitments to the Bitcoin blockchain so they can't be backdated.

**Pipeline:**

```
Supervisor writes structured logs (pino JSON, rotated by pino-roll)
        │
        ▼
FileWatcher (chokidar) detects completed log file
        │
        ▼
BatchProcessor reads all lines
        │
        ├──► SHA-256 hash of each line (leaf hashes)
        ├──► Build Merkle tree from leaves
        ├──► Save .tree file (all leaf hashes for later proof generation)
        ├──► Submit Merkle root to OpenTimestamps calendar servers
        ├──► Save .ots file (serialized timestamp proof)
        └──► Update manifest.json (root, leaf count, file size, timestamp)
```

**Merkle tree properties:** Any modification to any single log line changes its leaf hash, which propagates up the tree and changes the root. The root is a 32-byte commitment to the exact contents of every line in the batch. To verify a specific line, you only need the line itself, its sibling hashes along the path to the root (O(log n) hashes), and the root.

**Bitcoin anchoring via OpenTimestamps:** The Merkle root is submitted to OTS calendar servers, which aggregate many hashes and commit them to the Bitcoin blockchain. Once confirmed in a Bitcoin block, the timestamp proof establishes:
- The log contents existed at or before the block's timestamp
- Altering the logs would require re-mining Bitcoin blocks (computationally infeasible)

**Verification API:** The log-archiver exposes a web API (port 3201) that lets anyone verify any specific log entry:

```
GET /api/batches/:filename/verify/:lineNum

Response:
{
  "logEntry": "<the actual log line>",
  "leafHash": "abc123...",
  "proof": { "leaf": "...", "siblings": [...], "root": "..." },
  "valid": true,
  "ots": {
    "status": "verified",
    "bitcoinBlockHeight": 830000,
    "bitcoinTimestamp": "2024-01-15T12:00:00Z",
    "explorerUrl": "https://blockstream.info/block-height/830000"
  }
}
```

No secrets are needed to verify. The proof is a public cryptographic commitment.

---

## How the Layers Compose

Each layer addresses a distinct threat that the previous layers leave open:

| Layer | Addresses | Without it |
|-------|-----------|------------|
| **Network partitioning** | Prevents Brain/Body from bypassing the Supervisor | Services could communicate directly, evading all logging and auth |
| **Supervisor** | Creates an audit trail and single enforcement point | No record of what messages were exchanged or when |
| **SPIFFE/mTLS** | Authenticates who is connecting | Any container on the network could impersonate Brain or Body |
| **Log Archiver** | Makes the audit trail tamper-evident | Logs could be silently modified after the fact |

Together, the guarantees chain:

1. Every Brain/Body message **must** pass through the Supervisor (network isolation)
2. Only the real Brain and Body **can** connect (mTLS + SPIFFE ID validation)
3. Every relayed message **is** logged (Supervisor structured logging)
4. The logs **cannot** be altered without detection (Merkle trees + Bitcoin anchoring)

---

## Original Questions, Answered

The blog post asked:

> *"Was the hazard data even sent? Did the Brain receive it and choose to proceed anyway? We have no way to know."*

**Now we do.** The Supervisor logs every `BodyMessage` relayed to the Brain, including sensor data with nearby hazard blocks. The log-archiver commits those logs to a Merkle tree anchored to Bitcoin. To verify whether hazard data was sent, query the verification API for the relevant log batch and line number. The Merkle proof confirms the log entry is authentic and unmodified.

> *"There's no audit trail. There are no logs documenting what happened."*

**Now there is.** The Supervisor logs direction, message type, and content summary for every relay. These logs are immutable once archived — any modification invalidates the Merkle root, which is independently verifiable against the Bitcoin blockchain.

> *"Nothing prevents the Brain from lying about what it decided, or the Body from lying about what it executed."*

**The architecture doesn't prevent lying, but it makes it provably detectable.** The Supervisor sees the actual messages in transit. If the Brain claims it never received hazard data, but the log shows a `BodyMessage` with `sensorData` containing lava blocks was relayed to the Brain 2 seconds before it sent a `MoveToAction` toward those coordinates — the logs contradict the claim, and the logs are cryptographically committed.

---

## Deployment

The original direct mode still works for development:

```bash
docker compose up          # Brain ↔ Body, insecure, no supervisor
```

The full accountability stack is activated with the supervisor overlay:

```bash
docker compose -f docker-compose.yml -f docker-compose.supervisor.yml up
```

This starts SPIRE (server → bootstrap → agent), then the Supervisor, then Brain/Body with mTLS credentials, and the log-archiver watching the Supervisor's log output.

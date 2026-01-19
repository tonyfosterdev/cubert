# Cubert

A modular Minecraft bot system with clean separation between perception/actuation (Body) and decision-making (Brain).

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Minecraft     │◄───►│      Body       │◄───►│      Brain      │
│   Server        │     │  (Mineflayer)   │     │ (State Machine) │
│                 │     │                 │     │                 │
│   Port: 25565   │     │  Sensors:       │     │  States:        │
│   RCON: 25575   │     │  - Position     │────►│  - IDLE         │
│                 │     │  - Blocks       │     │  - SEARCHING    │
│                 │     │  - Inventory    │     │  - MOVING       │
│                 │     │  - Health       │     │  - MINING       │
│                 │     │                 │     │  - DEPOSITING   │
│                 │     │  Actuators:     │◄────│                 │
│                 │     │  - Movement     │     │  gRPC Server    │
│                 │     │  - Mining       │     │  Port: 5000     │
│                 │     │  - Inventory    │     │                 │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        Docker                Local/Docker           Local/Docker
```

## Prerequisites

- Docker and Docker Compose
- Node.js 20+ (for local development)

## Quick Start with Docker

Run everything in Docker containers:

```bash
# Start all services
./scripts/dev.sh gold-mining

# Or manually:
docker compose up --build
```

This starts:
- Minecraft server (always in Docker)
- Brain service (gRPC server with state machine)
- Body service (Mineflayer bot)
- Scenario initializer (sets up the world)

## Local Development

Run the brain and body services locally for faster iteration, with only Minecraft in Docker.

### 1. Start Minecraft Server

```bash
docker run -d \
  --name minecraft \
  -p 25565:25565 \
  -p 25575:25575 \
  -e EULA=TRUE \
  -e TYPE=VANILLA \
  -e VERSION=1.20.4 \
  -e ONLINE_MODE=FALSE \
  -e ENABLE_RCON=TRUE \
  -e RCON_PASSWORD=minecraft \
  -e MEMORY=2G \
  itzg/minecraft-server

# Wait for server to be ready (check logs)
docker logs -f minecraft
```

### 2. Install Dependencies

```bash
# Install all packages
cd packages/brain && npm install && cd ../..
cd packages/body && npm install && cd ../..
cd tools/scenario-runner && npm install && cd ../..
```

### 3. Start Brain Service

```bash
cd packages/brain
BRAIN_PORT=5000 SCENARIO=gold-mining npm run dev
```

You should see:
```
Cubert Brain starting...
Scenario: gold-mining
Initial state: IDLE
Brain gRPC server listening on port 5000
```

### 4. Start Body Service

In a new terminal:

```bash
cd packages/body
MC_HOST=localhost MC_PORT=25565 BRAIN_HOST=localhost BRAIN_PORT=5000 npm run dev
```

You should see:
```
Cubert Body starting...
Connecting to Minecraft server at localhost:25565...
Bot Cubert spawned!
Connected to Minecraft!
Connected to brain!
Cubert Body ready!
```

### 5. Initialize Scenario

In a new terminal:

```bash
cd tools/scenario-runner
MC_HOST=localhost RCON_PORT=25575 RCON_PASSWORD=minecraft SCENARIO=gold-mining npm run dev
```

This sets up the gold mining arena with ore deposits, lava pit, and chest.

## Observing the Bot

### Connect with Minecraft Client

1. Open Minecraft Java Edition 1.20.4
2. Multiplayer → Add Server → `localhost:25565`
3. Join and watch Cubert mine gold!

### View Logs

```bash
# Docker mode
docker compose logs -f brain
docker compose logs -f body

# Local mode - logs appear in each terminal
```

## Project Structure

```
cubert/
├── proto/
│   └── cubert.proto          # gRPC service definitions
├── packages/
│   ├── body/                  # Mineflayer bot service
│   │   └── src/
│   │       ├── bot/           # Bot connection management
│   │       ├── sensors/       # Position, blocks, inventory, health
│   │       ├── actuators/     # Movement, mining, chat
│   │       └── grpc/          # Brain client
│   └── brain/                 # Decision-making service
│       └── src/
│           ├── state-machine/ # Generic state machine
│           │   └── scenarios/ # Scenario-specific states
│           └── grpc/          # gRPC server
├── scenarios/
│   └── gold-mining/           # Scenario configuration
├── tools/
│   └── scenario-runner/       # RCON world setup
├── scripts/                   # Helper scripts
└── docker-compose.yml         # Full stack configuration
```

## Environment Variables

### Body Service

| Variable | Default | Description |
|----------|---------|-------------|
| MC_HOST | minecraft | Minecraft server host |
| MC_PORT | 25565 | Minecraft server port |
| MC_VERSION | 1.20.4 | Minecraft version |
| BOT_USERNAME | Cubert | Bot username |
| BRAIN_HOST | brain | Brain service host |
| BRAIN_PORT | 5000 | Brain service port |
| PROTO_PATH | (auto) | Path to cubert.proto |

### Brain Service

| Variable | Default | Description |
|----------|---------|-------------|
| BRAIN_PORT | 5000 | gRPC server port |
| SCENARIO | gold-mining | Active scenario |
| PROTO_PATH | (auto) | Path to cubert.proto |

### Scenario Runner

| Variable | Default | Description |
|----------|---------|-------------|
| MC_HOST | minecraft | Minecraft server host |
| RCON_PORT | 25575 | RCON port |
| RCON_PASSWORD | minecraft | RCON password |
| SCENARIO | gold-mining | Scenario to initialize |
| BOT_USERNAME | Cubert | Bot to equip |

## Scripts

```bash
./scripts/dev.sh [scenario]     # Start full Docker stack
./scripts/run-scenario.sh [scenario]  # Re-initialize scenario
./scripts/logs.sh [service]     # View service logs
./scripts/rcon.sh <command>     # Execute RCON command
```

## Gold Mining Scenario

The default scenario creates:
- Stone platform at y=63
- 6 gold ore blocks scattered around
- Lava pit (danger zone) at coordinates (5-8, 62, 5-8)
- Chest at (-8, 64, 0) for deposits

The bot will:
1. Search for nearby gold ore
2. Navigate to gold (avoiding lava)
3. Mine the ore
4. When inventory has 32+ gold items, find and deposit in chest
5. Repeat

## Troubleshooting

### Bot can't connect to Minecraft
- Ensure Minecraft server is fully started (check for "Done!" in logs)
- Verify `ONLINE_MODE=FALSE` is set
- Check port 25565 is accessible

### Brain connection fails
- Ensure brain service is running first
- Check BRAIN_HOST and BRAIN_PORT match
- Verify port 5000 is accessible

### Proto file not found
- In Docker: Ensure `PROTO_PATH=/app/proto/cubert.proto`
- Locally: The path is auto-resolved from source location

### Hot reload not working in Docker
- Nodemon uses legacy watch mode (`-L` flag) for Docker volumes
- Changes to `src/` should trigger restart automatically

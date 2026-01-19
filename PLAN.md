# Cubert: Minecraft Bot System

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Research Findings](#research-findings)
4. [Implementation Plan](#implementation-plan)
5. [Directory Structure](#directory-structure)
6. [Proto Definition](#proto-definition)
7. [Body Service](#body-service)
8. [Brain Service](#brain-service)
9. [Scenario System](#scenario-system)
10. [Docker Setup](#docker-setup)
11. [Scripts](#scripts)
12. [Verification](#verification)

---

## Overview

Cubert is a modular Minecraft bot system with clean separation between:
- **Body**: Perception and actuation (mineflayer + sensors/actuators)
- **Brain**: Decision-making (deterministic state machine, NOT LLM)

Communication uses gRPC bidirectional streaming for real-time sensor/action flow.

### First Scenario: Gold Mining
- Bot spawned near lava pit and chest
- Mine gold ore, avoid lava hazards
- Deposit gold in chest when inventory fills
- Repeat the cycle

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Docker Network                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐ │
│  │                  │     │                  │     │                  │ │
│  │  Minecraft       │◄───►│  Body            │◄───►│  Brain           │ │
│  │  Server          │     │  (Mineflayer)    │     │  (State Machine) │ │
│  │                  │     │                  │     │                  │ │
│  │  Port: 25565     │     │  gRPC Client     │     │  gRPC Server     │ │
│  │  RCON: 25575     │     │                  │     │  Port: 5000      │ │
│  │                  │     │  Sensors:        │     │                  │ │
│  │  itzg/minecraft  │     │  - Position      │     │  States:         │ │
│  │  -server         │     │  - Blocks        │────►│  - IDLE          │ │
│  │                  │     │  - Inventory     │     │  - SEARCHING     │ │
│  │                  │     │  - Health        │     │  - MOVING        │ │
│  │                  │     │  - Path Status   │     │  - MINING        │ │
│  │                  │     │                  │     │  - DEPOSITING    │ │
│  │                  │     │  Actuators:      │     │                  │ │
│  │                  │     │  - Movement      │◄────│  Actions:        │ │
│  │                  │     │  - Mining        │     │  - MOVE_TO       │ │
│  │                  │     │  - Inventory     │     │  - MINE_BLOCK    │ │
│  │                  │     │  - Chat          │     │  - DEPOSIT       │ │
│  │                  │     │                  │     │  - SPEAK         │ │
│  └──────────────────┘     └──────────────────┘     └──────────────────┘ │
│           ▲                                                             │
│           │                                                             │
│  ┌────────┴─────────┐                                                   │
│  │                  │                                                   │
│  │  Scenario Runner │                                                   │
│  │  (RCON)          │                                                   │
│  │                  │                                                   │
│  └──────────────────┘                                                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

Data Flow:
  SensorData (Body → Brain): Position, nearby blocks, inventory, health, path status
  Actions (Brain → Body): Move commands, mine commands, speak commands
```

### Key Design Decisions

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| gRPC Server | Brain | Stateless, scalable, handles decisions |
| gRPC Client | Body | Stateful sensors, manages reconnection |
| Communication | Bidirectional Streaming | Real-time, independent read/write |
| Message Format | Protobuf proto3 | Efficient, forward-compatible |
| Sensor Rate | Poll 20Hz, Send 2Hz | Balance responsiveness vs overhead |
| State Machine | Explicit transitions | Deterministic, easy to debug |

---

## Research Findings

### Mineflayer Capabilities

#### Sensors / World Information Gathering

**Block Data Access:**
```javascript
// Find blocks within a radius
const results = bot.findBlocks({
  matching: (block) => block.name === 'gold_ore',
  maxDistance: 64,  // search radius (default 16)
  count: 10         // number of results to find
});

// Get block at specific position
const block = bot.blockAt(position);
```

**View Distance & Observable Range:**
- Blocks: Default max 256 blocks from bot's eye position
- Entities: Default max 3.5 blocks detection distance
- Block Search: Default max 64 blocks (configurable)
- Uses Octahedron iterator (3D diamond pattern) for efficient searching

**Entity Detection:**
```javascript
Object.values(bot.entities).forEach(entity => {
  console.log(entity.username, entity.position, entity.type);
});
```

**Inventory Information:**
```javascript
bot.inventory.slots  // Array of item slots
bot.inventory.items() // Items in inventory
```

**Key Events (Sensor Data Sources):**
- `spawn` - Bot spawned/respawned
- `physicsTick` - Fires 20/sec, main heartbeat for sensor polling
- `entitySpawn`, `entityMoved`, `entityGone` - Entity tracking
- `blockUpdate` - Block state changed
- `chat` - Public chat message received

#### Actuators / Actions

**Movement with Pathfinder:**
```javascript
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');

bot.loadPlugin(pathfinder);

const movements = new Movements(bot);
movements.canDig = true;
movements.allowParkour = true;

bot.pathfinder.setMovements(movements);
bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, range));
```

**Goal Types:**
- `GoalBlock(x, y, z)` - Reach exact block
- `GoalNear(x, y, z, range)` - Approach within range
- `GoalFollow(entity, range)` - Follow a player/mob

**Mining:**
```javascript
const block = bot.blockAt(position);
await bot.tool.equipForBlock(block);  // Equip best tool
await bot.dig(block);
```

**Chest Interaction:**
```javascript
const chest = await bot.openContainer(chestBlock);
await chest.deposit(itemType, metadata, count);
chest.close();
```

**Chat/Speaking:**
```javascript
bot.chat('Hello everyone!');
```

#### Rate Limiting / Performance

**Physics Updates:** 20 ticks/second (50ms per tick)

**Manual Throttling Pattern:**
```javascript
let lastCheck = 0;
const checkInterval = 500;  // 500ms

bot.on('physicsTick', () => {
  if (Date.now() - lastCheck < checkInterval) return;

  // Do expensive block queries
  const blocks = bot.findBlocks({ maxDistance: 32, count: 10 });
  lastCheck = Date.now();
});
```

**Best Practices:**
1. Cache block data rather than repeated queries
2. Use reasonable `maxDistance` in findBlocks()
3. Batch world queries in single event handler
4. Use `physicsTick` wisely - it fires 20/sec

---

### gRPC in Node.js

#### Library: @grpc/grpc-js

```json
{
  "@grpc/grpc-js": "^1.12.0",
  "@grpc/proto-loader": "^0.7.0"
}
```

#### Bidirectional Streaming Proto:

```protobuf
service BrainService {
  rpc Connect(stream SensorData) returns (stream Action) {}
}
```

#### Server Implementation (Brain):

```typescript
const service: BrainServiceServer = {
  connect: (stream) => {
    stream.on('data', (sensorData) => {
      const actions = stateMachine.update(sensorData);
      for (const action of actions) {
        stream.write(action);
      }
    });

    stream.on('end', () => stream.end());
  }
};
```

#### Client Implementation (Body):

```typescript
const stream = client.connect();

// Send sensor data
stream.write(sensorData);

// Receive actions
stream.on('data', (action) => {
  actuators.execute(action);
});

// Handle reconnection
stream.on('error', () => scheduleReconnect());
```

#### Reconnection Pattern:

```typescript
private scheduleReconnect(): void {
  this.reconnectAttempts++;
  const delay = Math.min(
    this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts),
    30000  // Cap at 30 seconds
  );

  setTimeout(() => this.connect(), delay);
}
```

---

### Docker Setup

#### Minecraft Server: itzg/minecraft-server

```yaml
minecraft:
  image: itzg/minecraft-server:latest
  environment:
    EULA: "TRUE"
    TYPE: "VANILLA"
    VERSION: "1.20.4"
    ENABLE_RCON: "TRUE"
    RCON_PASSWORD: "minecraft"
    ONLINE_MODE: "FALSE"
  ports:
    - "25565:25565"
    - "25575:25575"  # RCON
  healthcheck:
    test: mc-monitor status --host localhost --port 25565
    interval: 10s
    start_period: 120s
```

#### Scenario Setup via RCON:

```javascript
const { Rcon } = require('rcon-client');

const rcon = await Rcon.connect({
  host: 'minecraft',
  port: 25575,
  password: 'minecraft'
});

await rcon.send('/fill 0 63 0 10 65 10 lava');
await rcon.send('/setblock 5 64 5 chest');
await rcon.send('/tp Cubert 0 65 0');
```

#### Hot Reloading with Nodemon:

```yaml
body:
  volumes:
    - ./packages/body/src:/app/src
    - /app/node_modules
  command: npx nodemon --inspect=0.0.0.0:9229 -L src/index.ts
```

The `-L` flag enables legacy watch mode required for Docker volume mounts.

---

## Implementation Plan

### Phase 1: Project Setup
1. Create directory structure
2. Initialize package.json files with dependencies
3. Create tsconfig.json files
4. Create .env.example

### Phase 2: Proto Definition
1. Write `proto/cubert.proto` with:
   - SensorData message (position, inventory, blocks, health, path status)
   - Action messages (MOVE_TO, MINE_BLOCK, DEPOSIT_ITEMS, SPEAK, IDLE)
   - BrainService with bidirectional `Connect` stream

### Phase 3: Body Service
1. Create BotManager (mineflayer connection + pathfinder plugin)
2. Implement sensors:
   - PositionSensor: x, y, z, yaw, pitch
   - BlockSensor: find gold_ore, lava, chest within radius
   - InventorySensor: slot contents
   - HealthSensor: health, food, oxygen
3. Implement actuators:
   - MovementActuator: pathfinder.goto()
   - MiningActuator: bot.dig()
   - InventoryActuator: bot.openContainer() + deposit
   - ChatActuator: bot.chat()
4. Create gRPC client with reconnection logic
5. Wire up main loop: physicsTick → aggregate sensors → send to brain

### Phase 4: Brain Service
1. Implement generic StateMachine class
2. Create gold-mining states:
   - IDLE: Announce ready, transition to searching
   - SEARCHING_GOLD: Find nearest gold, check inventory fullness
   - MOVING_TO_GOLD: Navigate to gold, check lava proximity
   - MINING: Mine the block, report completion
   - SEARCHING_CHEST: Find chest when inventory full
   - MOVING_TO_CHEST: Navigate to chest
   - DEPOSITING: Open chest, deposit gold items
3. Create gRPC server handling Connect stream
4. Wire up: receive SensorData → state machine update → send Actions

### Phase 5: Scenario System
1. Create scenario.json format
2. Create setup.mcfunction for gold-mining
3. Implement scenario-runner using rcon-client
4. Add bot teleport and equipment commands

### Phase 6: Docker Setup
1. Create Dockerfile.dev for body and brain (with nodemon)
2. Create docker-compose.yml with all services
3. Configure volumes for hot reload
4. Set up health checks

### Phase 7: Scripts
1. setup.sh: Install deps, generate proto types
2. dev.sh: docker-compose up with scenario env var
3. run-scenario.sh: Trigger scenario initialization

---

## Directory Structure

```
/home/tony/repos/cubert/
├── PLAN.md                         # This file
├── docker-compose.yml              # Development stack
├── docker-compose.prod.yml         # Production stack
├── .env.example
├── .gitignore
│
├── proto/
│   └── cubert.proto                # gRPC service definitions
│
├── packages/
│   ├── body/                       # Body service (Mineflayer)
│   │   ├── Dockerfile
│   │   ├── Dockerfile.dev
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── nodemon.json
│   │   └── src/
│   │       ├── index.ts            # Entry point
│   │       ├── config.ts           # Configuration
│   │       ├── bot/
│   │       │   └── BotManager.ts   # Mineflayer lifecycle
│   │       ├── sensors/
│   │       │   ├── index.ts        # SensorAggregator
│   │       │   ├── BaseSensor.ts
│   │       │   ├── PositionSensor.ts
│   │       │   ├── BlockSensor.ts
│   │       │   ├── InventorySensor.ts
│   │       │   └── HealthSensor.ts
│   │       ├── actuators/
│   │       │   ├── index.ts        # ActuatorRegistry
│   │       │   ├── BaseActuator.ts
│   │       │   ├── MovementActuator.ts
│   │       │   ├── MiningActuator.ts
│   │       │   ├── InventoryActuator.ts
│   │       │   └── ChatActuator.ts
│   │       └── grpc/
│   │           ├── client.ts       # BrainClient
│   │           └── generated/      # Generated proto types
│   │
│   └── brain/                      # Brain service (State Machine)
│       ├── Dockerfile
│       ├── Dockerfile.dev
│       ├── package.json
│       ├── tsconfig.json
│       ├── nodemon.json
│       └── src/
│           ├── index.ts            # Entry point
│           ├── config.ts           # Configuration
│           ├── grpc/
│           │   ├── server.ts       # BrainServer
│           │   └── generated/      # Generated proto types
│           └── state-machine/
│               ├── StateMachine.ts
│               ├── State.ts
│               └── scenarios/
│                   └── gold-mining/
│                       ├── index.ts
│                       └── states.ts
│
├── scenarios/
│   └── gold-mining/
│       ├── scenario.json           # Scenario metadata
│       ├── setup.mcfunction        # RCON setup commands
│       └── README.md
│
├── tools/
│   └── scenario-runner/
│       ├── Dockerfile
│       ├── package.json
│       └── src/
│           └── index.ts            # RCON command executor
│
└── scripts/
    ├── setup.sh                    # Initial project setup
    ├── dev.sh                      # Start development stack
    ├── run-scenario.sh             # Run specific scenario
    └── proto-gen.sh                # Generate proto types
```

---

## Proto Definition

**File: `proto/cubert.proto`**

```protobuf
syntax = "proto3";

package cubert;

option optimize_for = SPEED;

// ============================================================================
// BRAIN SERVICE - Brain is the gRPC server, Body is the client
// ============================================================================

service BrainService {
  // Bidirectional stream: Body sends sensors, Brain sends actions
  rpc Connect(stream SensorData) returns (stream Action);

  // Health check
  rpc Ping(PingRequest) returns (PingResponse);
}

// ============================================================================
// SENSOR DATA - Body -> Brain
// ============================================================================

message SensorData {
  fixed64 timestamp = 1;              // Unix timestamp in ms
  string bot_id = 2;                  // Bot identifier

  PositionData position = 3;
  InventoryData inventory = 4;
  HealthData health = 5;
  BlocksData nearby_blocks = 6;
  PathStatus path_status = 7;
  ActionFeedback action_feedback = 8;
}

message PositionData {
  double x = 1;
  double y = 2;
  double z = 3;
  float yaw = 4;
  float pitch = 5;
  bool on_ground = 6;
}

message InventoryData {
  repeated InventorySlot slots = 1;
  int32 selected_slot = 2;
}

message InventorySlot {
  int32 slot_index = 1;
  string item_name = 2;               // e.g., "gold_ore", "cobblestone"
  int32 count = 3;
}

message HealthData {
  float health = 1;                   // 0-20
  float food = 2;                     // 0-20
  float saturation = 3;
  float oxygen = 4;                   // 0-20
}

message BlocksData {
  repeated BlockInfo gold_blocks = 1;
  repeated BlockInfo lava_blocks = 2;
  repeated BlockInfo chest_blocks = 3;
  repeated BlockInfo hazard_blocks = 4;
}

message BlockInfo {
  int32 x = 1;
  int32 y = 2;
  int32 z = 3;
  string block_name = 4;
  float distance = 5;                 // Distance from bot
}

message PathStatus {
  PathState state = 1;
  bool is_moving = 2;
  bool is_mining = 3;
  optional BlockInfo target_block = 4;
}

enum PathState {
  PATH_STATE_UNSPECIFIED = 0;
  PATH_STATE_IDLE = 1;
  PATH_STATE_COMPUTING = 2;
  PATH_STATE_FOLLOWING = 3;
  PATH_STATE_REACHED = 4;
  PATH_STATE_FAILED = 5;
}

message ActionFeedback {
  string action_id = 1;
  ActionResult result = 2;
  optional string error_message = 3;
}

enum ActionResult {
  ACTION_RESULT_UNSPECIFIED = 0;
  ACTION_RESULT_SUCCESS = 1;
  ACTION_RESULT_FAILED = 2;
  ACTION_RESULT_IN_PROGRESS = 3;
  ACTION_RESULT_CANCELLED = 4;
}

// ============================================================================
// ACTIONS - Brain -> Body
// ============================================================================

message Action {
  string action_id = 1;
  fixed64 timestamp = 2;
  ActionType type = 3;

  oneof payload {
    MoveToAction move_to = 10;
    MineBlockAction mine_block = 11;
    DepositItemsAction deposit_items = 12;
    SpeakAction speak = 13;
    IdleAction idle = 14;
    CancelAction cancel = 15;
  }
}

enum ActionType {
  ACTION_TYPE_UNSPECIFIED = 0;
  ACTION_TYPE_MOVE_TO = 1;
  ACTION_TYPE_MINE_BLOCK = 2;
  ACTION_TYPE_DEPOSIT_ITEMS = 3;
  ACTION_TYPE_SPEAK = 4;
  ACTION_TYPE_IDLE = 5;
  ACTION_TYPE_CANCEL = 6;
}

message MoveToAction {
  int32 x = 1;
  int32 y = 2;
  int32 z = 3;
  int32 range = 4;                    // How close to get (default 1)
  bool sprint = 5;
}

message MineBlockAction {
  int32 x = 1;
  int32 y = 2;
  int32 z = 3;
}

message DepositItemsAction {
  int32 chest_x = 1;
  int32 chest_y = 2;
  int32 chest_z = 3;
  repeated string item_names = 4;     // Items to deposit (empty = all)
}

message SpeakAction {
  string message = 1;
}

message IdleAction {
  int32 duration_ms = 1;
}

message CancelAction {
  string target_action_id = 1;
}

// ============================================================================
// UTILITY MESSAGES
// ============================================================================

message PingRequest {
  string bot_id = 1;
}

message PingResponse {
  bool ready = 1;
  string scenario = 2;
}
```

---

## Body Service

### Configuration

**File: `packages/body/src/config.ts`**

```typescript
export interface BodyConfig {
  minecraft: {
    host: string;
    port: number;
    username: string;
    version: string;
  };
  grpc: {
    brainHost: string;
    brainPort: number;
    reconnectIntervalMs: number;
    maxReconnectAttempts: number;
  };
  sensors: {
    pollIntervalMs: number;
    sendIntervalMs: number;
    blockSearchRadius: number;
    blockSearchCount: number;
  };
}

export const defaultConfig: BodyConfig = {
  minecraft: {
    host: process.env.MC_HOST || 'minecraft',
    port: parseInt(process.env.MC_PORT || '25565'),
    username: process.env.BOT_USERNAME || 'Cubert',
    version: process.env.MC_VERSION || '1.20.4',
  },
  grpc: {
    brainHost: process.env.BRAIN_HOST || 'brain',
    brainPort: parseInt(process.env.BRAIN_PORT || '5000'),
    reconnectIntervalMs: 2000,
    maxReconnectAttempts: -1,  // Infinite
  },
  sensors: {
    pollIntervalMs: 50,        // 20 ticks per second
    sendIntervalMs: 500,       // 2 updates per second to brain
    blockSearchRadius: 32,
    blockSearchCount: 10,
  },
};
```

### BlockSensor Example

**File: `packages/body/src/sensors/BlockSensor.ts`**

```typescript
import { Bot } from 'mineflayer';
import { BaseSensor } from './BaseSensor';
import { BlocksData, BlockInfo } from '../grpc/generated/cubert';

const GOLD_ORE_BLOCKS = ['gold_ore', 'deepslate_gold_ore', 'nether_gold_ore'];
const LAVA_BLOCKS = ['lava'];
const CHEST_BLOCKS = ['chest', 'trapped_chest', 'ender_chest'];
const HAZARD_BLOCKS = ['lava', 'fire', 'cactus', 'magma_block'];

export class BlockSensor extends BaseSensor<BlocksData> {
  private config: { radius: number; maxCount: number };
  private mcData: any;

  constructor(bot: Bot, config: { radius: number; maxCount: number }) {
    super(bot);
    this.config = config;
    this.mcData = require('minecraft-data')(bot.version);
  }

  read(): BlocksData {
    const botPos = this.bot.entity.position;

    return {
      goldBlocks: this.findBlocksOfType(GOLD_ORE_BLOCKS, botPos),
      lavaBlocks: this.findBlocksOfType(LAVA_BLOCKS, botPos),
      chestBlocks: this.findBlocksOfType(CHEST_BLOCKS, botPos),
      hazardBlocks: this.findBlocksOfType(HAZARD_BLOCKS, botPos),
    };
  }

  private findBlocksOfType(blockNames: string[], origin: any): BlockInfo[] {
    const blockIds = blockNames
      .map(name => this.mcData.blocksByName[name]?.id)
      .filter(id => id !== undefined);

    if (blockIds.length === 0) return [];

    const positions = this.bot.findBlocks({
      matching: blockIds,
      maxDistance: this.config.radius,
      count: this.config.maxCount,
    });

    return positions.map(pos => {
      const block = this.bot.blockAt(pos);
      const distance = pos.distanceTo(origin);

      return {
        x: pos.x,
        y: pos.y,
        z: pos.z,
        blockName: block?.name || 'unknown',
        distance: distance,
      };
    }).sort((a, b) => a.distance - b.distance);
  }
}
```

### MovementActuator Example

**File: `packages/body/src/actuators/MovementActuator.ts`**

```typescript
import { Bot } from 'mineflayer';
import { goals } from 'mineflayer-pathfinder';
import { BaseActuator } from './BaseActuator';
import { MoveToAction } from '../grpc/generated/cubert';

export class MovementActuator extends BaseActuator {
  constructor(bot: Bot) {
    super(bot);

    this.bot.on('goal_reached', () => {
      if (this.currentActionId) {
        this.complete(this.currentActionId, true);
      }
    });

    this.bot.on('path_reset', (reason) => {
      if (this.currentActionId && reason === 'no_path') {
        this.complete(this.currentActionId, false, 'No path found');
      }
    });
  }

  async execute(actionId: string, payload: MoveToAction): Promise<void> {
    this.currentActionId = actionId;
    this.isExecuting = true;

    const { x, y, z, range = 1, sprint = false } = payload;

    const goal = new goals.GoalNear(x, y, z, range);

    try {
      await this.bot.pathfinder.goto(goal);
    } catch (err: any) {
      this.complete(actionId, false, err.message);
    }
  }

  cancel(): void {
    this.bot.pathfinder.stop();
    super.cancel();
  }
}
```

### Main Entry Point

**File: `packages/body/src/index.ts`**

```typescript
import { defaultConfig } from './config';
import { BotManager } from './bot/BotManager';
import { SensorAggregator } from './sensors';
import { ActuatorRegistry } from './actuators';
import { BrainClient } from './grpc/client';

async function main() {
  console.log('Cubert Body starting...');

  const config = defaultConfig;
  const botManager = new BotManager(config);
  const brainClient = new BrainClient(config);

  // Connect to Minecraft
  const bot = await botManager.connect();
  console.log('Connected to Minecraft!');

  // Initialize sensors and actuators
  const sensors = new SensorAggregator(bot, config);
  const actuators = new ActuatorRegistry(bot);

  // Connect to brain
  await brainClient.connect();
  console.log('Connected to brain!');

  // Handle incoming actions from brain
  brainClient.on('action', async (action) => {
    await actuators.execute(action);
  });

  // Sensor polling loop
  let lastSendTime = 0;

  bot.on('physicsTick', () => {
    const now = Date.now();

    if (now - lastSendTime >= config.sensors.sendIntervalMs) {
      const sensorData = sensors.collect();
      brainClient.sendSensorData(sensorData);
      lastSendTime = now;
    }
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    brainClient.disconnect();
    botManager.disconnect();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

---

## Brain Service

### State Machine

**File: `packages/brain/src/state-machine/StateMachine.ts`**

```typescript
import { State, StateContext } from './State';
import { SensorData, Action } from '../grpc/generated/cubert';
import { EventEmitter } from 'events';

export class StateMachine extends EventEmitter {
  private states: Map<string, State> = new Map();
  private currentState: State | null = null;
  private context: StateContext;

  constructor() {
    super();
    this.context = {
      sensorData: {} as SensorData,
      memory: new Map(),
    };
  }

  addState(state: State): void {
    this.states.set(state.name, state);
  }

  setInitialState(stateName: string): void {
    const state = this.states.get(stateName);
    if (!state) throw new Error(`State '${stateName}' not found`);
    this.currentState = state;
  }

  update(sensorData: SensorData): Action[] {
    if (!this.currentState) return [];

    this.context.sensorData = sensorData;
    const actions: Action[] = [];

    const { action, nextState } = this.currentState.onUpdate(this.context);

    if (action) actions.push(action);

    if (nextState && nextState !== this.currentState.name) {
      const newState = this.states.get(nextState);
      if (newState) {
        if (this.currentState.onExit) {
          this.currentState.onExit(this.context);
        }

        this.currentState = newState;

        if (this.currentState.onEnter) {
          const enterAction = this.currentState.onEnter(this.context);
          if (enterAction) actions.push(enterAction);
        }

        this.emit('stateChange', nextState);
      }
    }

    return actions;
  }
}
```

### Gold Mining States

**File: `packages/brain/src/state-machine/scenarios/gold-mining/states.ts`**

```typescript
import { State, StateContext } from '../../State';
import { Action, ActionType } from '../../../grpc/generated/cubert';
import { v4 as uuidv4 } from 'uuid';

function createAction(type: ActionType, payload: any): Action {
  return {
    actionId: uuidv4(),
    timestamp: BigInt(Date.now()),
    type,
    ...payload,
  };
}

export const IdleState: State = {
  name: 'IDLE',

  onEnter(context: StateContext): Action | null {
    return createAction(ActionType.ACTION_TYPE_SPEAK, {
      speak: { message: 'Ready for gold mining!' }
    });
  },

  onUpdate(context: StateContext) {
    return { action: null, nextState: 'SEARCHING_GOLD' };
  },
};

export const SearchingGoldState: State = {
  name: 'SEARCHING_GOLD',

  onEnter(context: StateContext): Action | null {
    return createAction(ActionType.ACTION_TYPE_SPEAK, {
      speak: { message: 'Looking for gold...' }
    });
  },

  onUpdate(context: StateContext) {
    const { sensorData, memory } = context;
    const goldBlocks = sensorData.nearbyBlocks?.goldBlocks || [];

    // Check if inventory is full
    const goldCount = countGoldInInventory(sensorData);
    if (goldCount >= 32) {
      return { action: null, nextState: 'SEARCHING_CHEST' };
    }

    if (goldBlocks.length > 0) {
      memory.set('targetGold', goldBlocks[0]);
      return { action: null, nextState: 'MOVING_TO_GOLD' };
    }

    return { action: null, nextState: null };
  },
};

export const MovingToGoldState: State = {
  name: 'MOVING_TO_GOLD',

  onEnter(context: StateContext): Action | null {
    const target = context.memory.get('targetGold');
    if (!target) return null;

    return createAction(ActionType.ACTION_TYPE_MOVE_TO, {
      moveTo: { x: target.x, y: target.y, z: target.z, range: 3 }
    });
  },

  onUpdate(context: StateContext) {
    const { sensorData, memory } = context;

    // Check for lava hazard
    if (isNearLava(sensorData, 3)) {
      memory.delete('targetGold');
      return {
        action: createAction(ActionType.ACTION_TYPE_SPEAK, {
          speak: { message: 'Too close to lava! Finding safer gold...' }
        }),
        nextState: 'SEARCHING_GOLD',
      };
    }

    // Check if close enough to mine
    const target = memory.get('targetGold');
    if (target && isWithinRange(sensorData, target, 4)) {
      return { action: null, nextState: 'MINING' };
    }

    return { action: null, nextState: null };
  },
};

export const MiningState: State = {
  name: 'MINING',

  onEnter(context: StateContext): Action | null {
    const target = context.memory.get('targetGold');
    context.memory.set('miningStarted', false);

    return createAction(ActionType.ACTION_TYPE_SPEAK, {
      speak: { message: 'Mining gold ore!' }
    });
  },

  onUpdate(context: StateContext) {
    const { sensorData, memory } = context;
    const target = memory.get('targetGold');

    if (!memory.get('miningStarted')) {
      memory.set('miningStarted', true);
      return {
        action: createAction(ActionType.ACTION_TYPE_MINE_BLOCK, {
          mineBlock: { x: target.x, y: target.y, z: target.z }
        }),
        nextState: null,
      };
    }

    const feedback = sensorData.actionFeedback;
    if (feedback?.result === 1 || feedback?.result === 2) {
      memory.delete('targetGold');
      return { action: null, nextState: 'SEARCHING_GOLD' };
    }

    return { action: null, nextState: null };
  },
};

// ... similar patterns for SEARCHING_CHEST, MOVING_TO_CHEST, DEPOSITING

function isNearLava(sensorData: any, maxDistance: number): boolean {
  const lavaBlocks = sensorData.nearbyBlocks?.lavaBlocks || [];
  return lavaBlocks.some((block: any) => block.distance <= maxDistance);
}

function countGoldInInventory(sensorData: any): number {
  const slots = sensorData.inventory?.slots || [];
  const goldItems = ['gold_ore', 'deepslate_gold_ore', 'raw_gold'];
  return slots
    .filter((slot: any) => goldItems.includes(slot.itemName))
    .reduce((sum: number, slot: any) => sum + slot.count, 0);
}

function isWithinRange(sensorData: any, target: any, range: number): boolean {
  const pos = sensorData.position;
  const distance = Math.sqrt(
    Math.pow(pos.x - target.x, 2) +
    Math.pow(pos.y - target.y, 2) +
    Math.pow(pos.z - target.z, 2)
  );
  return distance <= range;
}
```

---

## Scenario System

### Scenario Config

**File: `scenarios/gold-mining/scenario.json`**

```json
{
  "name": "gold-mining",
  "description": "Mine gold ore, avoid lava, deposit in chest",
  "version": "1.0.0",
  "minecraft": {
    "gamemode": "survival",
    "difficulty": "normal",
    "time": 6000,
    "weather": "clear"
  },
  "spawn": {
    "x": 0,
    "y": 65,
    "z": 0
  },
  "setup": {
    "commands": "setup.mcfunction"
  }
}
```

### Setup Commands

**File: `scenarios/gold-mining/setup.mcfunction`**

```mcfunction
# Gold Mining Scenario Setup

# Clear area around spawn
fill -15 60 -15 15 75 15 air

# Create floor
fill -15 63 -15 15 63 15 stone

# Place lava pit (danger zone)
fill 5 63 5 8 63 8 air
fill 5 62 5 8 62 8 lava

# Place gold ore deposits (away from lava)
setblock -5 64 -3 gold_ore
setblock -6 64 -5 gold_ore
setblock -3 64 -7 gold_ore
setblock -8 64 -2 gold_ore
setblock -4 63 -6 deepslate_gold_ore
setblock -7 63 -4 deepslate_gold_ore

# Place chest for deposits
setblock -8 64 0 chest

# Set time and weather
time set day
weather clear

# Announce setup complete
say Gold Mining scenario ready!
```

---

## Docker Setup

### Development Stack

**File: `docker-compose.yml`**

```yaml
version: '3.8'

services:
  minecraft:
    image: itzg/minecraft-server:latest
    environment:
      EULA: "TRUE"
      TYPE: "VANILLA"
      VERSION: "1.20.4"
      ONLINE_MODE: "FALSE"
      ENABLE_RCON: "TRUE"
      RCON_PASSWORD: "minecraft"
      MEMORY: "2G"
      DIFFICULTY: "normal"
      SPAWN_PROTECTION: "0"
      ENABLE_AUTOPAUSE: "FALSE"
    ports:
      - "25565:25565"
      - "25575:25575"
    volumes:
      - minecraft-data:/data
    healthcheck:
      test: mc-monitor status --host localhost --port 25565
      interval: 10s
      timeout: 5s
      retries: 20
      start_period: 120s

  brain:
    build:
      context: ./packages/brain
      dockerfile: Dockerfile.dev
    environment:
      BRAIN_PORT: "5000"
      SCENARIO: "gold-mining"
      NODE_ENV: "development"
    ports:
      - "5000:5000"
      - "9230:9230"
    volumes:
      - ./packages/brain/src:/app/src
      - ./proto:/app/proto
      - brain-node-modules:/app/node_modules
    command: npx nodemon --inspect=0.0.0.0:9230 -L src/index.ts
    depends_on:
      minecraft:
        condition: service_healthy

  body:
    build:
      context: ./packages/body
      dockerfile: Dockerfile.dev
    environment:
      MC_HOST: "minecraft"
      MC_PORT: "25565"
      MC_VERSION: "1.20.4"
      BOT_USERNAME: "Cubert"
      BRAIN_HOST: "brain"
      BRAIN_PORT: "5000"
      NODE_ENV: "development"
    ports:
      - "9229:9229"
    volumes:
      - ./packages/body/src:/app/src
      - ./proto:/app/proto
      - body-node-modules:/app/node_modules
    command: npx nodemon --inspect=0.0.0.0:9229 -L src/index.ts
    depends_on:
      brain:
        condition: service_started
      minecraft:
        condition: service_healthy

  scenario-init:
    build:
      context: ./tools/scenario-runner
    environment:
      MC_HOST: "minecraft"
      RCON_PORT: "25575"
      RCON_PASSWORD: "minecraft"
      BOT_USERNAME: "Cubert"
      SCENARIO: "gold-mining"
    volumes:
      - ./scenarios:/scenarios:ro
    depends_on:
      body:
        condition: service_started
    restart: "no"

volumes:
  minecraft-data:
  brain-node-modules:
  body-node-modules:
```

### Development Dockerfile

**File: `packages/body/Dockerfile.dev`**

```dockerfile
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm install

COPY proto ./proto
RUN npm run proto:gen

# Source mounted as volume, command in docker-compose
```

---

## Scripts

### Setup Script

**File: `scripts/setup.sh`**

```bash
#!/bin/bash
set -e

echo "=== Cubert Setup ==="

command -v docker >/dev/null 2>&1 || { echo "Docker required"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Node.js required"; exit 1; }

[ ! -f .env ] && cp .env.example .env

echo "Installing dependencies..."
cd packages/body && npm install && cd ../..
cd packages/brain && npm install && cd ../..
cd tools/scenario-runner && npm install && cd ../..

echo "Generating gRPC types..."
./scripts/proto-gen.sh

echo "=== Setup Complete ==="
```

### Development Script

**File: `scripts/dev.sh`**

```bash
#!/bin/bash
set -e

SCENARIO=${1:-gold-mining}
export SCENARIO

echo "=== Starting Cubert (Scenario: $SCENARIO) ==="
docker-compose up --build
```

### Run Scenario Script

**File: `scripts/run-scenario.sh`**

```bash
#!/bin/bash
set -e

SCENARIO=${1:-gold-mining}

echo "=== Initializing Scenario: $SCENARIO ==="
docker-compose run --rm -e SCENARIO=$SCENARIO scenario-init
```

---

## Verification

### Manual Testing Steps

```bash
# 1. Start the development stack
./scripts/dev.sh gold-mining

# 2. Wait for services (all should be healthy)
docker-compose ps

# 3. Watch brain logs for state transitions
docker-compose logs -f brain

# 4. Connect Minecraft client to localhost:25565

# 5. Initialize the scenario world
./scripts/run-scenario.sh gold-mining

# 6. Observe Cubert:
#    - Announces "Ready for gold mining!"
#    - Navigates toward gold ore
#    - Avoids lava
#    - Mines gold
#    - Deposits in chest when full
#    - Repeats

# 7. Test hot reload
# Edit packages/brain/src/state-machine/scenarios/gold-mining/states.ts
# Change a message, observe automatic restart

# 8. Test RCON
./scripts/rcon.sh "tp Cubert 0 65 0"
```

### Success Criteria

- [ ] Bot spawns and connects to brain
- [ ] Brain receives sensor data at ~2Hz
- [ ] State machine transitions logged
- [ ] Bot mines at least one gold ore
- [ ] Bot avoids lava (no deaths)
- [ ] Bot deposits items in chest
- [ ] Hot reload works for both services
- [ ] System recovers from disconnections

---

## Running Outside Docker

For faster iteration:

```bash
# Terminal 1: Minecraft server only
docker run -d -p 25565:25565 -p 25575:25575 \
  -e EULA=TRUE -e ENABLE_RCON=TRUE -e RCON_PASSWORD=minecraft \
  --name mc-server itzg/minecraft-server

# Terminal 2: Brain (native)
cd packages/brain && npm run dev

# Terminal 3: Body (native)
cd packages/body && npm run dev

# Terminal 4: Scenario init (one-time)
cd tools/scenario-runner && SCENARIO=gold-mining npm start
```

---

## Dependencies Summary

### Body Service
```json
{
  "mineflayer": "^4.20.0",
  "mineflayer-pathfinder": "^2.4.5",
  "minecraft-data": "^3.61.0",
  "vec3": "^0.1.10",
  "@grpc/grpc-js": "^1.10.0",
  "@grpc/proto-loader": "^0.7.10",
  "uuid": "^9.0.0"
}
```

### Brain Service
```json
{
  "@grpc/grpc-js": "^1.10.0",
  "@grpc/proto-loader": "^0.7.10",
  "uuid": "^9.0.0"
}
```

### Scenario Runner
```json
{
  "rcon-client": "^4.2.4"
}
```

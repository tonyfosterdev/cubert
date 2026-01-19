# Event Flow Architecture

This document describes how messages, events, and state transitions flow through the Cubert brain-body system.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              BRAIN                                       │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                        StateMachine                              │   │
│  │  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │   │
│  │  │   IDLE   │───►│SEARCHING │───►│ MOVING   │───►│  MINING  │  │   │
│  │  └──────────┘    │  _GOLD   │◄───│ _TO_GOLD │◄───│          │  │   │
│  │                  └──────────┘    └──────────┘    └──────────┘  │   │
│  │                        │              ▲               │         │   │
│  │                        │         onEvent()            │         │   │
│  │                        ▼              │               ▼         │   │
│  │                  context.memory: { pendingActionId, targetGold } │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                              │                                          │
│                         gRPC Server                                     │
│                              │                                          │
└──────────────────────────────┼──────────────────────────────────────────┘
                               │
              ═══════════ gRPC Stream ═══════════
                               │
         BodyMessage (up)      │      Action (down)
         - SensorData          │      - MOVE_TO
         - ActionEvent         │      - MINE_BLOCK
         - ConnectEvent        │      - SPEAK
                               │
┌──────────────────────────────┼──────────────────────────────────────────┐
│                              │                                          │
│                         gRPC Client                                     │
│                              │                                          │
│  ┌───────────────────────────┴───────────────────────────────────────┐ │
│  │                         BODY                                       │ │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐   │ │
│  │  │   Sensors   │    │  Actuators  │    │     BotManager      │   │ │
│  │  │ - position  │    │ - movement  │    │  (mineflayer bot)   │   │ │
│  │  │ - inventory │    │ - mining    │    │                     │   │ │
│  │  │ - blocks    │    │ - inventory │    │                     │   │ │
│  │  └─────────────┘    └─────────────┘    └─────────────────────┘   │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Message Types

### Body → Brain

| Message | Purpose | When Sent |
|---------|---------|-----------|
| `ConnectEvent` | Handshake on connection | On gRPC connect, on bot spawn/respawn |
| `SensorData` | World state snapshot | Every 500ms (physics tick) |
| `ActionEvent` | Action completed | Immediately when actuator finishes |

### Brain → Body

| Message | Purpose | When Sent |
|---------|---------|-----------|
| `Action` | Command to execute | When state machine decides |

---

## Normal Operation Flow

### Scenario: Bot finds and mines gold

```
Time    Body                          Network              Brain
────────────────────────────────────────────────────────────────────────────

T+0     [Bot spawns]
        cancelAll()
        collect sensors
                                      ─── ConnectEvent ──►
                                          {initial_sensor_data}
                                                              resetToSafeState()
                                                              state = SEARCHING_GOLD
                                                              update(sensorData)
                                                              "Found gold at (-5,64,-3)"
                                                              memory.targetGold = {...}
                                                              transition → MOVING_TO_GOLD
                                                              onEnter(): create MOVE_TO action
                                                              memory.pendingActionId = "abc-123"
                                      ◄── Action ──────────
                                          {MOVE_TO, id:"abc-123"}

T+1     Receive action
        movement.execute(MOVE_TO)
        [pathfinder starts]

T+2     [still moving]
        collect sensors
                                      ─── SensorData ────►
                                          {position, isMoving:true}
                                                              update(sensorData)
                                                              onUpdate(): no lava, wait
                                                              return {action:null, nextState:null}

T+3     [arrived at goal]
        movement completes
        emit 'actionComplete'
                                      ─── ActionEvent ───►
                                          {id:"abc-123", SUCCESS}
                                                              handleEvent()
                                                              onEvent(): id matches pendingActionId
                                                              delete pendingActionId
                                                              return {nextState: 'MINING'}
                                                              transition → MINING
                                                              onEnter(): create MINE_BLOCK action
                                                              memory.miningActionId = "def-456"
                                      ◄── Action ──────────
                                          {MINE_BLOCK, id:"def-456"}

T+4     Receive action
        mining.execute(MINE_BLOCK)
        [bot starts digging]

T+5     [mining completes]
        emit 'actionComplete'
                                      ─── ActionEvent ───►
                                          {id:"def-456", SUCCESS}
                                                              handleEvent()
                                                              onEvent(): id matches miningActionId
                                                              delete miningActionId, targetGold
                                                              return {nextState: 'SEARCHING_GOLD'}
                                                              transition → SEARCHING_GOLD
                                                              onEnter(): "Looking for gold..."
                                      ◄── Action ──────────
                                          {SPEAK, "Looking for gold..."}

        [cycle repeats]
```

---

## State Transitions

### How States Work

Each state has three handlers:

```typescript
interface State {
  name: string;
  onEnter?(context): Action | null;    // Called once when entering state
  onUpdate(context): StateResult;       // Called on every SensorData
  onEvent?(context, event): StateResult; // Called on ActionEvent
}
```

### Transition Flow

```
                    ┌─────────────────────────────────┐
                    │         StateMachine            │
                    └─────────────────────────────────┘
                                   │
          ┌────────────────────────┼────────────────────────┐
          │                        │                        │
          ▼                        ▼                        ▼
    update(sensorData)      handleEvent(event)       resetToSafeState()
          │                        │                        │
          ▼                        ▼                        ▼
    currentState.onUpdate()  currentState.onEvent()   memory.clear()
          │                        │                  currentState = SEARCHING
          ▼                        ▼
    {action, nextState}      {action, nextState}
          │                        │
          └────────────┬───────────┘
                       │
                       ▼
              if nextState != null:
                  performTransition(nextState)
                       │
                       ▼
              oldState.onExit()
              currentState = newState
              newState.onEnter() → action
```

### Example: MOVING_TO_GOLD State

```typescript
export const MovingToGoldState: State = {
  name: 'MOVING_TO_GOLD',

  // Called once when we enter this state
  onEnter(context: StateContext): Action | null {
    const target = context.memory.get('targetGold');

    // Create move action and track its ID
    const action = createAction('ACTION_TYPE_MOVE_TO', {
      moveTo: { x: target.x, y: target.y, z: target.z, range: 3 },
    });
    context.memory.set('pendingActionId', action.actionId);

    return action;  // Brain sends this to body
  },

  // Called when body sends ActionEvent
  onEvent(context: StateContext, event: ActionEvent) {
    const pendingActionId = context.memory.get('pendingActionId');

    // Ignore events for other actions
    if (event.actionId !== pendingActionId) {
      return { action: null, nextState: null };
    }

    context.memory.delete('pendingActionId');

    if (event.result === 'ACTION_RESULT_SUCCESS') {
      return { action: null, nextState: 'MINING' };
    } else {
      context.memory.delete('targetGold');
      return { action: null, nextState: 'SEARCHING_GOLD' };
    }
  },

  // Called every 500ms with sensor data
  onUpdate(context: StateContext) {
    // Only safety checks here - lava detection
    if (isNearLava(context.sensorData, 3)) {
      context.memory.delete('targetGold');
      context.memory.delete('pendingActionId');
      return { action: speakAction('Lava!'), nextState: 'SEARCHING_GOLD' };
    }

    // Wait for onEvent to handle completion
    return { action: null, nextState: null };
  },
};
```

---

## Reconnection Scenarios

### Scenario 1: Body Disconnects Mid-Action

```
Time    Body                          Network              Brain
────────────────────────────────────────────────────────────────────────────

T+0     [moving to gold]
        pendingActionId = "abc-123"
                                                           state = MOVING_TO_GOLD
                                                           memory.pendingActionId = "abc-123"

T+1     [NETWORK FAILURE]
        gRPC stream breaks
        movement.cancel() called
        scheduleReconnect()
                                      ─── stream end ────►
                                                           "Stream error"
                                                           (brain still has stale state)

T+2     [body reconnecting...]
        exponential backoff

T+3     [gRPC reconnected]
        cancelAll()
        collect sensors
                                      ─── ConnectEvent ──►
                                          {initial_sensor_data}
                                                           [CONNECT] resetting state
                                                           memory.clear()  // pendingActionId gone
                                                           state = SEARCHING_GOLD
                                                           update(sensorData)
                                                           "Found gold at (-5,64,-3)"
                                                           transition → MOVING_TO_GOLD
                                      ◄── Action ──────────
                                          {MOVE_TO, id:"xyz-789"}  // new action

T+4     [bot resumes normally]
```

**Key point**: Brain's stale `pendingActionId` is cleared by `resetToSafeState()`. Fresh start.

---

### Scenario 2: Brain Restarts

```
Time    Body                          Network              Brain
────────────────────────────────────────────────────────────────────────────

T+0     [mining gold]
        miningActionId = "abc-123"
                                                           state = MINING
                                                           memory.miningActionId = "abc-123"

T+1                                                        [BRAIN PROCESS CRASHES]

T+2     [mining completes]
        emit 'actionComplete'
                                      ─── ActionEvent ───►
                                          {id:"abc-123", SUCCESS}
                                      ─── stream error ──►
        "Stream error"
        scheduleReconnect()

T+3                                                        [BRAIN RESTARTS]
                                                           state = IDLE
                                                           memory = empty

T+4     [body reconnects]
        cancelAll()
        collect sensors
                                      ─── ConnectEvent ──►
                                          {initial_sensor_data}
                                                           [CONNECT] resetting state
                                                           (already fresh, but reset anyway)
                                                           state = SEARCHING_GOLD
                                                           update(sensorData)
                                      ◄── Action ──────────

T+5     [bot resumes normally]
```

**Key point**: Brain was already fresh. ConnectEvent still triggers reset (idempotent). Body's orphaned action event was lost, but that's fine - we're starting fresh.

---

### Scenario 3: Bot Dies in Minecraft

```
Time    Body                          Network              Brain
────────────────────────────────────────────────────────────────────────────

T+0     [mining gold]
                                                           state = MINING
                                                           memory.miningActionId = "abc-123"

T+1     [BOT DIES - fell in lava]
        BotManager: 'death' event
        bot disconnects from MC

T+2     BotManager: scheduleReconnect()
        [gRPC still connected to brain]

T+3     [Bot respawns at spawn point]
        BotManager: 'spawn' event
        cancelAll()
        collect sensors (new position!)
                                      ─── ConnectEvent ──►
                                          {initial_sensor_data}
                                          (position is now spawn point)
                                                           [CONNECT] resetting state
                                                           memory.clear()
                                                           state = SEARCHING_GOLD
                                                           update(sensorData)
                                                           "No gold nearby" (at spawn)
                                                           stay in SEARCHING_GOLD

T+4     [bot wanders, finds gold]
                                      ─── SensorData ────►
                                          {goldBlocks: [...]}
                                                           "Found gold!"
                                                           transition → MOVING_TO_GOLD
                                      ◄── Action ──────────
```

**Key point**: gRPC connection stayed up, but bot state reset. ConnectEvent on 'spawn' tells brain to reset. Bot starts searching from new location.

---

## Memory Management

### What's Stored in context.memory

| Key | Set By | Cleared By | Purpose |
|-----|--------|------------|---------|
| `targetGold` | SEARCHING_GOLD.onUpdate | MINING.onEvent, resetToSafeState | Block to mine |
| `pendingActionId` | MOVING_*.onEnter | MOVING_*.onEvent, resetToSafeState | Track move action |
| `miningActionId` | MINING.onEnter | MINING.onEvent, resetToSafeState | Track mine action |
| `targetChest` | SEARCHING_CHEST.onUpdate | DEPOSITING.onEvent, resetToSafeState | Chest to deposit |
| `depositActionId` | DEPOSITING.onEnter | DEPOSITING.onEvent, resetToSafeState | Track deposit action |

### Memory Lifecycle

```
SEARCHING_GOLD
    │
    │ Found gold → memory.set('targetGold', block)
    ▼
MOVING_TO_GOLD
    │ onEnter → memory.set('pendingActionId', action.id)
    │
    │ ActionEvent received → memory.delete('pendingActionId')
    ▼
MINING
    │ onEnter → memory.set('miningActionId', action.id)
    │
    │ ActionEvent received → memory.delete('miningActionId')
    │                      → memory.delete('targetGold')
    ▼
SEARCHING_GOLD (cycle repeats)


ConnectEvent received at any point:
    → memory.clear()  // Everything wiped
    → state = SEARCHING_GOLD
```

---

## Event vs Polling: Why Events?

### Old Architecture (Polling)

```
Body sends SensorData every 500ms with actionFeedback field
Brain checks actionFeedback in onUpdate()
Problem: 500ms latency, feedback can be missed, complex state tracking
```

### New Architecture (Events)

```
Body sends ActionEvent immediately when action completes
Brain's onEvent() handles it directly
Benefit: Instant response, guaranteed delivery, clean separation
```

### Comparison

| Aspect | Polling | Events |
|--------|---------|--------|
| Latency | Up to 500ms | Immediate |
| Delivery | Can miss if not in next tick | Guaranteed (separate message) |
| State tracking | Check every update | Only on event |
| Code clarity | Mixed concerns in onUpdate | Separate onUpdate/onEvent |

---

## Error Handling

### Action Failure

```
Body                              Brain
  │                                 │
  │  [pathfinder fails]             │
  │  emit 'actionComplete'          │
  │    success: false               │
  │    errorMessage: "No path"      │
  │                                 │
  ├─── ActionEvent ────────────────►│
  │    {id, FAILED, "No path"}      │
  │                                 │
  │                    onEvent():   │
  │                    result = FAILED
  │                    clear target │
  │                    → SEARCHING  │
```

### Network Failure

```
Body                              Brain
  │                                 │
  │  [stream breaks]                │
  │  actuators.cancelAll()          │
  │  scheduleReconnect()            │
  │                                 │
  │  ... exponential backoff ...    │
  │                                 │
  │  [reconnected]                  │
  │  actuators.cancelAll()          │
  │  sendConnectEvent()             │
  │                                 │
  ├─── ConnectEvent ───────────────►│
  │                                 │
  │                    resetToSafeState()
  │                    → SEARCHING  │
```

---

## Summary

1. **SensorData** flows continuously (500ms) for world awareness
2. **ActionEvent** fires immediately on action completion for state transitions
3. **ConnectEvent** fires on any connection/reconnection to reset brain state
4. **States** use `onEnter` to start actions, `onEvent` to handle completion, `onUpdate` only for safety checks
5. **Memory** tracks pending action IDs; cleared on reset
6. **Reconnection** always resets to SEARCHING_GOLD - simple recovery over complex reconciliation

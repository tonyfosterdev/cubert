# Event-Driven Bot Architecture Refactor Plan

## Overview

Refactor Cubert from polling-based action completion detection to event-driven. Currently, action feedback is bundled with sensor data (polled every 500ms), causing delayed and unreliable state transitions. After this refactor, action completions will be sent immediately through the gRPC stream.

**IMPORTANT**: Aggressively remove old/unused code. No dead code left behind.

---

## Architecture Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│ Body (Minecraft Primitives)                                 │
│  - MOVE_TO(x,y,z) → pathfinder                              │
│  - MINE_BLOCK(x,y,z) → bot.dig()                            │
│  - DEPOSIT_ITEMS → chest operations                         │
│  - No scenario knowledge                                    │
│  - Sends ActionEvent immediately when actuators complete    │
└─────────────────────────────────────────────────────────────┘
                         ▲ Generic Actions / ActionEvents
                         │
┌─────────────────────────────────────────────────────────────┐
│ Brain (State Machine + Scenario Logic)                      │
│  - Gold mining states know about gold_ore, lava, thresholds │
│  - Event-driven state transitions via onEvent() handler     │
│  - Routes ActionEvents to current state                     │
└─────────────────────────────────────────────────────────────┘
```

---

## How ActionId Flow Works

1. **Brain creates action** with UUID: `action.actionId = "abc-123"`
2. **Brain stores ID** in memory: `memory.set('miningActionId', action.actionId)`
3. **Brain sends action** to Body via gRPC
4. **Body executes** via actuator, tracking `currentActionId`
5. **Actuator completes** → emits `complete` event with same `actionId`
6. **Body sends ActionEvent** immediately: `{ actionId: "abc-123", result: SUCCESS }`
7. **Brain receives event** → routes to `currentState.onEvent()`
8. **State matches ID**: `if (event.actionId === memory.get('miningActionId'))` → transition

---

## Implementation Steps

### Step 1: Proto Changes

**File**: `proto/cubert.proto`

Add these NEW message types (insert before the UTILITY MESSAGES section):

```protobuf
// ============================================================================
// BODY MESSAGE WRAPPER - Body -> Brain (supports both sensor data and events)
// ============================================================================

message BodyMessage {
  oneof payload {
    SensorData sensor_data = 1;
    ActionEvent action_event = 2;
  }
}

message ActionEvent {
  fixed64 timestamp = 1;
  string action_id = 2;
  ActionResult result = 3;
  optional string error_message = 4;
  ActionEventType event_type = 5;
}

enum ActionEventType {
  ACTION_EVENT_UNSPECIFIED = 0;
  ACTION_EVENT_STARTED = 1;
  ACTION_EVENT_COMPLETED = 2;
}
```

**MODIFY** the BrainService:
```protobuf
service BrainService {
  // CHANGE: stream SensorData → stream BodyMessage
  rpc Connect(stream BodyMessage) returns (stream Action);
  rpc Ping(PingRequest) returns (PingResponse);
}
```

**REMOVE** from SensorData message:
```protobuf
// DELETE this line from SensorData:
ActionFeedback action_feedback = 8;
```

**REMOVE** entirely:
```protobuf
// DELETE the entire ActionFeedback message (lines ~93-97):
message ActionFeedback {
  string action_id = 1;
  ActionResult result = 2;
  optional string error_message = 3;
}
```

After changes, regenerate protos:
```bash
cd packages/brain && npm run build
cd packages/body && npm run build
```

---

### Step 2: State Interface Updates

**File**: `packages/brain/src/state-machine/State.ts`

**ADD** ActionEvent interface:
```typescript
export interface ActionEvent {
  actionId: string;
  result: string;
  errorMessage?: string;
  eventType: string;
}
```

**MODIFY** StateContext to add lastEvent:
```typescript
export interface StateContext {
  sensorData: SensorData;
  memory: Map<string, any>;
  lastEvent: ActionEvent | null;  // ADD THIS
}
```

**MODIFY** State interface to add onEvent handler:
```typescript
export interface State {
  name: string;
  onEnter?(context: StateContext): Action | null;
  onUpdate(context: StateContext): StateResult;
  onEvent?(context: StateContext, event: ActionEvent): StateResult;  // ADD THIS
  onExit?(context: StateContext): void;
}
```

**REMOVE** from SensorData interface:
```typescript
// DELETE actionFeedback field:
actionFeedback: {
  actionId: string;
  result: string;
  errorMessage?: string;
} | null;
```

---

### Step 3: StateMachine Updates

**File**: `packages/brain/src/state-machine/StateMachine.ts`

**ADD** import for ActionEvent:
```typescript
import { State, StateContext, SensorData, Action, ActionEvent } from './State';
```

**MODIFY** constructor to initialize lastEvent:
```typescript
constructor() {
  super();
  this.context = {
    sensorData: {} as SensorData,
    memory: new Map(),
    lastEvent: null,  // ADD THIS
  };
}
```

**ADD** new handleEvent method (add after update method):
```typescript
handleEvent(event: ActionEvent): Action[] {
  if (!this.currentState) return [];

  this.context.lastEvent = event;

  // If state has an event handler, use it
  if (this.currentState.onEvent) {
    const { action, nextState } = this.currentState.onEvent(this.context, event);
    const actions: Action[] = [];

    if (action) actions.push(action);

    if (nextState && nextState !== this.currentState.name) {
      this.performTransition(nextState, actions);
    }

    return actions;
  }

  return [];
}
```

**REFACTOR** update method - extract transition logic:
```typescript
update(sensorData: SensorData): Action[] {
  if (!this.currentState) return [];

  this.context.sensorData = sensorData;
  this.context.lastEvent = null;  // Clear event
  const actions: Action[] = [];

  const { action, nextState } = this.currentState.onUpdate(this.context);

  if (action) actions.push(action);

  if (nextState && nextState !== this.currentState.name) {
    this.performTransition(nextState, actions);
  }

  return actions;
}
```

**ADD** private performTransition helper:
```typescript
private performTransition(nextStateName: string, actions: Action[]): void {
  const newState = this.states.get(nextStateName);
  if (newState) {
    console.log(`[${new Date().toISOString()}] State transition: ${this.currentState!.name} -> ${nextStateName}`);

    if (this.currentState!.onExit) {
      this.currentState!.onExit(this.context);
    }

    this.currentState = newState;

    if (this.currentState.onEnter) {
      const enterAction = this.currentState.onEnter(this.context);
      if (enterAction) actions.push(enterAction);
    }

    this.emit('stateChange', nextStateName);
  }
}
```

---

### Step 4: Brain Server Updates

**File**: `packages/brain/src/grpc/server.ts`

**MODIFY** handleConnect to detect message type:
```typescript
private handleConnect(stream: grpc.ServerDuplexStream<any, any>): void {
  console.log('Bot connected to brain');

  stream.on('data', (bodyMessage: any) => {
    try {
      // Determine message type from the wrapper
      if (bodyMessage.sensorData) {
        // Regular sensor update
        const sensorData = this.deserializeSensorData(bodyMessage.sensorData);
        const actions = this.stateMachine.update(sensorData);

        for (const action of actions) {
          const actionMsg = this.serializeAction(action);
          stream.write(actionMsg);
        }
      } else if (bodyMessage.actionEvent) {
        // Immediate action event
        const event = this.deserializeActionEvent(bodyMessage.actionEvent);
        console.log(`[EVENT] ${event.eventType}: ${event.actionId} = ${event.result}`);

        const actions = this.stateMachine.handleEvent(event);

        for (const action of actions) {
          const actionMsg = this.serializeAction(action);
          stream.write(actionMsg);
        }
      }
    } catch (err) {
      console.error('Error processing message:', err);
    }
  });

  // ... rest of existing handlers (error, end) stay the same
}
```

**ADD** deserializeActionEvent method:
```typescript
private deserializeActionEvent(msg: any): ActionEvent {
  return {
    actionId: msg.actionId || msg.action_id,
    result: msg.result,
    errorMessage: msg.errorMessage || msg.error_message,
    eventType: msg.eventType || msg.event_type,
  };
}
```

**REMOVE** from deserializeSensorData:
```typescript
// DELETE these lines that handle actionFeedback:
actionFeedback: msg.actionFeedback ? {
  actionId: msg.actionFeedback.actionId || msg.actionFeedback.action_id,
  result: msg.actionFeedback.result,
  errorMessage: msg.actionFeedback.errorMessage || msg.actionFeedback.error_message,
} : null,
```

**ADD** ActionEvent import at top:
```typescript
import { ActionEvent } from '../state-machine/State';
```

---

### Step 5: Body Client Updates

**File**: `packages/body/src/grpc/client.ts`

**MODIFY** sendSensorData to wrap in BodyMessage:
```typescript
sendSensorData(data: SensorData): void {
  if (!this.stream || !this.connected) {
    return;
  }

  const message = {
    sensorData: this.serializeSensorData(data),  // Wrap in sensorData field
  };

  try {
    this.stream.write(message);
  } catch (err) {
    console.error('Failed to send sensor data:', err);
  }
}

private serializeSensorData(data: SensorData): any {
  return {
    timestamp: data.timestamp,
    botId: data.botId,
    position: data.position,
    inventory: {
      slots: data.inventory.slots.map(slot => ({
        slotIndex: slot.slotIndex,
        itemName: slot.itemName,
        count: slot.count,
      })),
      selectedSlot: data.inventory.selectedSlot,
    },
    health: data.health,
    nearbyBlocks: {
      goldBlocks: data.nearbyBlocks.goldBlocks,
      lavaBlocks: data.nearbyBlocks.lavaBlocks,
      chestBlocks: data.nearbyBlocks.chestBlocks,
      hazardBlocks: data.nearbyBlocks.hazardBlocks,
    },
    pathStatus: data.pathStatus,
    // REMOVED: actionFeedback - no longer sent with sensor data
  };
}
```

**ADD** sendActionEvent method:
```typescript
sendActionEvent(event: ActionEvent): void {
  if (!this.stream || !this.connected) {
    return;
  }

  const message = {
    actionEvent: {
      timestamp: Date.now().toString(),
      actionId: event.actionId,
      result: event.result,
      errorMessage: event.errorMessage,
      eventType: event.eventType,
    },
  };

  try {
    this.stream.write(message);
  } catch (err) {
    console.error('Failed to send action event:', err);
  }
}
```

**ADD** ActionEvent interface (or import from shared types):
```typescript
export interface ActionEvent {
  actionId: string;
  result: string;
  errorMessage?: string;
  eventType: string;
}
```

---

### Step 6: Body Main Updates

**File**: `packages/body/src/index.ts`

**REPLACE** the actionComplete handler (lines ~40-46):

BEFORE:
```typescript
// Handle action completion feedback
actuators.on('actionComplete', (result) => {
  sensors.setActionFeedback({
    actionId: result.actionId,
    result: result.success ? 'ACTION_RESULT_SUCCESS' : 'ACTION_RESULT_FAILED',
    errorMessage: result.errorMessage,
  });
});
```

AFTER:
```typescript
// Handle action completion - send immediately as event
actuators.on('actionComplete', (result) => {
  console.log(`[EVENT] Action ${result.actionId} completed: ${result.success ? 'SUCCESS' : 'FAILED'}`);

  brainClient.sendActionEvent({
    actionId: result.actionId,
    result: result.success ? 'ACTION_RESULT_SUCCESS' : 'ACTION_RESULT_FAILED',
    errorMessage: result.errorMessage,
    eventType: 'ACTION_EVENT_COMPLETED',
  });
});
```

---

### Step 7: Sensor Aggregator Cleanup

**File**: `packages/body/src/sensors/index.ts`

**REMOVE** lastActionFeedback field from class:
```typescript
// DELETE this line:
private lastActionFeedback: ActionFeedback | null = null;
```

**REMOVE** setActionFeedback method entirely:
```typescript
// DELETE this entire method:
setActionFeedback(feedback: ActionFeedback): void {
  this.lastActionFeedback = feedback;
}
```

**REMOVE** actionFeedback from collect() return:
```typescript
// In collect() method, DELETE:
actionFeedback: this.lastActionFeedback,

// And DELETE this line that clears it:
this.lastActionFeedback = null;
```

**REMOVE** ActionFeedback interface if defined here:
```typescript
// DELETE if present:
interface ActionFeedback {
  actionId: string;
  result: string;
  errorMessage?: string;
}
```

---

### Step 8: Gold Mining States Refactor

**File**: `packages/brain/src/state-machine/scenarios/gold-mining/states.ts`

**ADD** import for ActionEvent:
```typescript
import { State, StateContext, Action, SensorData, BlockInfo, ActionEvent } from '../../State';
```

#### 8.1 MovingToGoldState

**REPLACE** entire state with event-driven version:

```typescript
export const MovingToGoldState: State = {
  name: 'MOVING_TO_GOLD',

  onEnter(context: StateContext): Action | null {
    const target = context.memory.get('targetGold') as BlockInfo;
    if (!target) return null;

    const action = createAction('ACTION_TYPE_MOVE_TO', {
      moveTo: { x: target.x, y: target.y, z: target.z, range: 3, sprint: false },
    });
    context.memory.set('pendingActionId', action.actionId);
    console.log(`[${new Date().toISOString()}] Moving to gold at (${target.x}, ${target.y}, ${target.z})`);
    return action;
  },

  onEvent(context: StateContext, event: ActionEvent) {
    const pendingActionId = context.memory.get('pendingActionId') as string;

    if (event.actionId !== pendingActionId) {
      return { action: null, nextState: null };
    }

    // Clear pending action
    context.memory.delete('pendingActionId');

    if (event.result === 'ACTION_RESULT_SUCCESS') {
      console.log(`[${new Date().toISOString()}] Arrived at gold`);
      return { action: null, nextState: 'MINING' };
    } else {
      console.log(`[${new Date().toISOString()}] Failed to reach gold: ${event.errorMessage}`);
      context.memory.delete('targetGold');
      return { action: null, nextState: 'SEARCHING_GOLD' };
    }
  },

  onUpdate(context: StateContext) {
    const { sensorData, memory } = context;

    // Safety check only - lava hazard
    if (isNearLava(sensorData, 3)) {
      memory.delete('targetGold');
      memory.delete('pendingActionId');
      return {
        action: createAction('ACTION_TYPE_SPEAK', {
          speak: { message: 'Too close to lava! Finding safer gold...' },
        }),
        nextState: 'SEARCHING_GOLD',
      };
    }

    // Wait for onEvent to handle completion
    return { action: null, nextState: null };
  },
};
```

**REMOVED from old version**:
- `moveStarted` memory flag (not needed)
- Polling for `actionFeedback` in onUpdate
- Distance-based fallback completion check
- `PATH_STATE_FAILED` polling check

#### 8.2 MiningState

**REPLACE** entire state:

```typescript
export const MiningState: State = {
  name: 'MINING',

  onEnter(context: StateContext): Action | null {
    const target = context.memory.get('targetGold') as BlockInfo;
    if (!target) {
      console.log(`[${new Date().toISOString()}] No target gold in memory`);
      return null;
    }

    const action = createAction('ACTION_TYPE_MINE_BLOCK', {
      mineBlock: { x: target.x, y: target.y, z: target.z },
    });
    context.memory.set('miningActionId', action.actionId);

    console.log(`[${new Date().toISOString()}] Mining gold at (${target.x}, ${target.y}, ${target.z})`);
    return action;
  },

  onEvent(context: StateContext, event: ActionEvent) {
    const miningActionId = context.memory.get('miningActionId') as string;

    if (event.actionId !== miningActionId) {
      return { action: null, nextState: null };
    }

    console.log(`[${new Date().toISOString()}] Mining complete: ${event.result}`);

    // Clean up and search for more gold
    context.memory.delete('targetGold');
    context.memory.delete('miningActionId');
    return { action: null, nextState: 'SEARCHING_GOLD' };
  },

  onUpdate(context: StateContext) {
    // No polling needed - onEvent handles completion
    return { action: null, nextState: null };
  },
};
```

**REMOVED from old version**:
- `miningStarted` flag and first-update action sending (now in onEnter)
- `miningCheckTime` timeout logic (lines 243-255)
- Polling for `actionFeedback` in onUpdate
- Polling for `pathStatus.isMining`
- The speak action in onEnter (optional, can keep if desired)

#### 8.3 MovingToChestState

**REPLACE** entire state:

```typescript
export const MovingToChestState: State = {
  name: 'MOVING_TO_CHEST',

  onEnter(context: StateContext): Action | null {
    const target = context.memory.get('targetChest') as BlockInfo;
    if (!target) return null;

    const action = createAction('ACTION_TYPE_MOVE_TO', {
      moveTo: { x: target.x, y: target.y, z: target.z, range: 2, sprint: false },
    });
    context.memory.set('pendingActionId', action.actionId);
    console.log(`[${new Date().toISOString()}] Moving to chest at (${target.x}, ${target.y}, ${target.z})`);
    return action;
  },

  onEvent(context: StateContext, event: ActionEvent) {
    const pendingActionId = context.memory.get('pendingActionId') as string;

    if (event.actionId !== pendingActionId) {
      return { action: null, nextState: null };
    }

    context.memory.delete('pendingActionId');

    if (event.result === 'ACTION_RESULT_SUCCESS') {
      console.log(`[${new Date().toISOString()}] Arrived at chest`);
      return { action: null, nextState: 'DEPOSITING' };
    } else {
      console.log(`[${new Date().toISOString()}] Failed to reach chest: ${event.errorMessage}`);
      context.memory.delete('targetChest');
      return { action: null, nextState: 'SEARCHING_CHEST' };
    }
  },

  onUpdate(context: StateContext) {
    // Wait for onEvent
    return { action: null, nextState: null };
  },
};
```

**REMOVED from old version**:
- Distance-based `isWithinRange` check in onUpdate
- Polling for `actionFeedback` in onUpdate

#### 8.4 DepositingState

**REPLACE** entire state:

```typescript
export const DepositingState: State = {
  name: 'DEPOSITING',

  onEnter(context: StateContext): Action | null {
    const target = context.memory.get('targetChest') as BlockInfo;
    if (!target) return null;

    const action = createAction('ACTION_TYPE_DEPOSIT_ITEMS', {
      depositItems: {
        chestX: target.x,
        chestY: target.y,
        chestZ: target.z,
        itemNames: ['gold_ore', 'deepslate_gold_ore', 'raw_gold'],
      },
    });
    context.memory.set('depositActionId', action.actionId);

    console.log(`[${new Date().toISOString()}] Depositing gold in chest`);
    return action;
  },

  onEvent(context: StateContext, event: ActionEvent) {
    const depositActionId = context.memory.get('depositActionId') as string;

    if (event.actionId !== depositActionId) {
      return { action: null, nextState: null };
    }

    console.log(`[${new Date().toISOString()}] Deposit complete: ${event.result}`);

    context.memory.delete('targetChest');
    context.memory.delete('depositActionId');
    return { action: null, nextState: 'SEARCHING_GOLD' };
  },

  onUpdate(context: StateContext) {
    // Wait for onEvent
    return { action: null, nextState: null };
  },
};
```

**REMOVED from old version**:
- `depositStarted` flag and first-update action sending (now in onEnter)
- Polling for `actionFeedback` in onUpdate
- The speak action in onEnter (optional)

#### 8.5 Keep These States Unchanged (mostly)

- **IdleState**: No changes needed
- **SearchingGoldState**: No changes needed (just polls sensor data for gold blocks)
- **SearchingChestState**: No changes needed (just polls sensor data for chests)

---

## Files Summary

| File | Action |
|------|--------|
| `proto/cubert.proto` | ADD BodyMessage, ActionEvent, ActionEventType; REMOVE ActionFeedback; MODIFY BrainService |
| `packages/brain/src/state-machine/State.ts` | ADD ActionEvent; MODIFY StateContext, State; REMOVE actionFeedback from SensorData |
| `packages/brain/src/state-machine/StateMachine.ts` | ADD handleEvent(), performTransition(); MODIFY update(), constructor |
| `packages/brain/src/grpc/server.ts` | ADD deserializeActionEvent(); MODIFY handleConnect(); REMOVE actionFeedback deserialize |
| `packages/body/src/grpc/client.ts` | ADD sendActionEvent(); MODIFY sendSensorData(); REMOVE actionFeedback serialize |
| `packages/body/src/index.ts` | REPLACE actionComplete handler to send events |
| `packages/body/src/sensors/index.ts` | REMOVE lastActionFeedback, setActionFeedback(), actionFeedback from collect() |
| `packages/brain/src/state-machine/scenarios/gold-mining/states.ts` | REWRITE MovingToGoldState, MiningState, MovingToChestState, DepositingState |

---

## Verification Steps

1. **Build both packages**:
   ```bash
   cd packages/brain && npm run build
   cd packages/body && npm run build
   ```

2. **Start brain**: `cd packages/brain && npm start`

3. **Start body**: `cd packages/body && npm start`

4. **Observe logs**: Should see immediate `[EVENT]` logs when actions complete, followed by state transitions

5. **Test full cycle**: Bot should smoothly: search → move → mine → search (repeat)

6. **Test storage**: When inventory has 32+ gold, should: search chest → move → deposit → search gold

7. **Verify no timeouts**: The 5-second mining timeout is GONE. Mining should complete via event only.

---

## What Was Removed (Aggressive Cleanup)

- `ActionFeedback` message from proto
- `actionFeedback` field from `SensorData` (proto and TypeScript)
- `lastActionFeedback` field from `SensorAggregator`
- `setActionFeedback()` method from `SensorAggregator`
- All `actionFeedback` polling in state `onUpdate()` methods
- `miningStarted`, `depositStarted`, `moveStarted` flags (actions now sent in `onEnter`)
- `miningCheckTime` timeout logic
- Distance-based fallback completion checks
- `PATH_STATE_FAILED` polling checks

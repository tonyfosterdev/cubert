# Connection Recovery Protocol

## Problem

When brain or body disconnects and reconnects, the brain has stale state (`pendingActionId`, `miningActionId`) waiting for events that will never come. The system gets stuck.

## Solution

**ConnectEvent + Reset-on-Connect**

When body connects (or reconnects), it sends a `ConnectEvent`. Brain resets to `SEARCHING_GOLD` state, clearing all pending action IDs. Simple beats complex.

---

## Proto Changes

**File**: `proto/cubert.proto`

```protobuf
message BodyMessage {
  oneof payload {
    SensorData sensor_data = 1;
    ActionEvent action_event = 2;
    ConnectEvent connect_event = 3;  // NEW
  }
}

message ConnectEvent {
  fixed64 timestamp = 1;
  SensorData initial_sensor_data = 2;
}
```

---

## Implementation

### Step 1: Proto
Add `ConnectEvent` message and add to `BodyMessage` oneof.

### Step 2: Body - Actuator cancelAll
**File**: `packages/body/src/actuators/index.ts`

```typescript
cancelAll(): void {
  this.movement.cancel();
  this.mining.cancel();
  // ... other actuators
}
```

### Step 3: Body - Send ConnectEvent
**File**: `packages/body/src/grpc/client.ts`

```typescript
sendConnectEvent(sensorData: SensorData): void {
  if (!this.stream || !this.connected) return;

  this.stream.write({
    connectEvent: {
      timestamp: Date.now().toString(),
      initialSensorData: this.serializeSensorData(sensorData),
    },
  });
}
```

### Step 4: Body - Trigger on connect/respawn
**File**: `packages/body/src/index.ts`

On brain connection established:
```typescript
brainClient.on('connected', () => {
  actuators.cancelAll();
  brainClient.sendConnectEvent(sensors.collect());
});
```

On bot respawn (gRPC still connected):
```typescript
botManager.on('spawn', () => {
  actuators.cancelAll();
  brainClient.sendConnectEvent(sensors.collect());
});
```

### Step 5: Brain - Handle ConnectEvent
**File**: `packages/brain/src/grpc/server.ts`

```typescript
if (bodyMessage.connectEvent) {
  console.log('[CONNECT] Body connected, resetting state');
  this.stateMachine.resetToSafeState();

  // Process initial sensor data
  if (bodyMessage.connectEvent.initialSensorData) {
    const sensorData = this.deserializeSensorData(bodyMessage.connectEvent.initialSensorData);
    const actions = this.stateMachine.update(sensorData);
    for (const action of actions) {
      stream.write(this.serializeAction(action));
    }
  }
}
```

### Step 6: Brain - resetToSafeState
**File**: `packages/brain/src/state-machine/StateMachine.ts`

```typescript
resetToSafeState(): void {
  // Clear all pending action IDs
  this.context.memory.clear();

  // Transition to searching state
  const searchState = this.states.get('SEARCHING_GOLD');
  if (searchState) {
    if (this.currentState?.onExit) {
      this.currentState.onExit(this.context);
    }
    this.currentState = searchState;
    this.emit('stateChange', 'SEARCHING_GOLD');
  }
}
```

---

## Files to Modify

| File | Change |
|------|--------|
| `proto/cubert.proto` | Add ConnectEvent message |
| `packages/body/src/actuators/index.ts` | Add cancelAll() |
| `packages/body/src/grpc/client.ts` | Add sendConnectEvent() |
| `packages/body/src/index.ts` | Wire up connect/spawn handlers |
| `packages/brain/src/grpc/server.ts` | Handle connectEvent |
| `packages/brain/src/state-machine/StateMachine.ts` | Add resetToSafeState() |

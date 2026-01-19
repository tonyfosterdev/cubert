import { describe, it, expect, beforeEach } from 'vitest';
import { TestHarness } from '../harness/TestHarness';
import { createGoldMiningStateMachine } from '../../src/state-machine/scenarios/gold-mining';
import { createSensorData, withGoldBlock } from '../fixtures/sensorData';

describe('ConnectEvent', () => {
  let harness: TestHarness;

  beforeEach(() => {
    const sm = createGoldMiningStateMachine();
    harness = new TestHarness(sm);
  });

  it('resets mid-MINING state back to SEARCHING_GOLD', () => {
    // Move from IDLE to SEARCHING_GOLD
    harness.sendSensorData(createSensorData());

    // Get to MOVING_TO_GOLD
    const sensorData = withGoldBlock(createSensorData(), { x: 5, y: 64, z: 0 });
    harness.sendSensorData(sensorData);

    expect(harness.getCurrentState()).toBe('MOVING_TO_GOLD');

    // Complete the move action to get to MINING
    const moveAction = harness.getActionsByType('ACTION_TYPE_MOVE_TO')[0];
    harness.completeAction(moveAction.actionId, 'SUCCESS');

    expect(harness.getCurrentState()).toBe('MINING');

    // Now simulate a reconnect
    harness.sendConnectEvent(createSensorData());

    expect(harness.getCurrentState()).toBe('SEARCHING_GOLD');
  });

  it('clears all pending action IDs from memory', () => {
    // Move from IDLE to SEARCHING_GOLD
    harness.sendSensorData(createSensorData());

    const sensorData = withGoldBlock(createSensorData(), { x: 5, y: 64, z: 0 });
    harness.sendSensorData(sensorData);

    expect(harness.getCurrentState()).toBe('MOVING_TO_GOLD');
    expect(harness.getMemory().has('pendingActionId')).toBe(true);

    harness.sendConnectEvent(createSensorData());

    expect(harness.getMemory().has('pendingActionId')).toBe(false);
    expect(harness.getMemory().size).toBe(0);
  });

  it('processes initial sensor data and returns appropriate actions', () => {
    // First move from IDLE to SEARCHING_GOLD
    harness.sendSensorData(createSensorData());
    harness.clearHistory();

    // Simulate reconnect with gold in sensor data
    const sensorData = withGoldBlock(createSensorData(), { x: 10, y: 64, z: 0 });
    const actions = harness.sendConnectEvent(sensorData);

    // Should transition to MOVING_TO_GOLD and emit a move action
    expect(harness.getCurrentState()).toBe('MOVING_TO_GOLD');
    expect(actions.some((a) => a.type === 'ACTION_TYPE_MOVE_TO')).toBe(true);
  });

  it('stays in SEARCHING_GOLD when no gold in sensor data', () => {
    harness.clearHistory();
    harness.sendConnectEvent(createSensorData());

    expect(harness.getCurrentState()).toBe('SEARCHING_GOLD');
  });
});

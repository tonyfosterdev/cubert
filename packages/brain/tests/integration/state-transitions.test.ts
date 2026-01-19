import { describe, it, expect, beforeEach } from 'vitest';
import { TestHarness } from '../harness/TestHarness';
import { createGoldMiningStateMachine } from '../../src/state-machine/scenarios/gold-mining';
import {
  createSensorData,
  withGoldBlock,
  withLavaBlock,
  withChestBlock,
  withInventoryGold,
} from '../fixtures/sensorData';

describe('State Transitions', () => {
  let harness: TestHarness;

  beforeEach(() => {
    const sm = createGoldMiningStateMachine();
    harness = new TestHarness(sm);
  });

  it('IDLE -> SEARCHING_GOLD (immediate)', () => {
    expect(harness.getCurrentState()).toBe('IDLE');

    harness.sendSensorData(createSensorData());

    expect(harness.getCurrentState()).toBe('SEARCHING_GOLD');
    expect(harness.stateHistory).toContain('SEARCHING_GOLD');
  });

  it('SEARCHING_GOLD -> MOVING_TO_GOLD (gold block in sensor data)', () => {
    harness.sendSensorData(createSensorData()); // IDLE -> SEARCHING_GOLD
    harness.clearHistory();

    const sensorData = withGoldBlock(createSensorData(), { x: 10, y: 64, z: 5 });
    harness.sendSensorData(sensorData);

    expect(harness.getCurrentState()).toBe('MOVING_TO_GOLD');
    expect(harness.stateHistory).toContain('MOVING_TO_GOLD');
  });

  it('SEARCHING_GOLD -> SEARCHING_CHEST (inventory >= 32 gold)', () => {
    harness.sendSensorData(createSensorData()); // IDLE -> SEARCHING_GOLD
    harness.clearHistory();

    const sensorData = withInventoryGold(createSensorData(), 32);
    harness.sendSensorData(sensorData);

    expect(harness.getCurrentState()).toBe('SEARCHING_CHEST');
  });

  it('gold near lava is skipped', () => {
    harness.sendSensorData(createSensorData()); // IDLE -> SEARCHING_GOLD

    // Gold at (5, 64, 0), lava at (6, 64, 0) - distance < 3
    let sensorData = withGoldBlock(createSensorData(), { x: 5, y: 64, z: 0 });
    sensorData = withLavaBlock(sensorData, { x: 6, y: 64, z: 0 });

    harness.sendSensorData(sensorData);

    // Should stay in SEARCHING_GOLD because gold is too close to lava
    expect(harness.getCurrentState()).toBe('SEARCHING_GOLD');
  });

  it('selects safe gold when some gold is near lava', () => {
    harness.sendSensorData(createSensorData()); // IDLE -> SEARCHING_GOLD

    // First gold near lava, second gold is safe
    let sensorData = withGoldBlock(createSensorData(), { x: 5, y: 64, z: 0 });
    sensorData = withLavaBlock(sensorData, { x: 6, y: 64, z: 0 });
    sensorData = withGoldBlock(sensorData, { x: 20, y: 64, z: 0 }); // Safe gold

    harness.sendSensorData(sensorData);

    expect(harness.getCurrentState()).toBe('MOVING_TO_GOLD');

    // Check the target is the safe gold
    const targetGold = harness.getMemory().get('targetGold');
    expect(targetGold.x).toBe(20);
  });

  describe('full mining cycle', () => {
    it('search -> move -> mine -> search', () => {
      // Start: IDLE
      expect(harness.getCurrentState()).toBe('IDLE');

      // IDLE -> SEARCHING_GOLD
      harness.sendSensorData(createSensorData());
      expect(harness.getCurrentState()).toBe('SEARCHING_GOLD');

      // SEARCHING_GOLD -> MOVING_TO_GOLD
      const sensorData = withGoldBlock(createSensorData(), { x: 5, y: 64, z: 0 });
      harness.sendSensorData(sensorData);
      expect(harness.getCurrentState()).toBe('MOVING_TO_GOLD');

      // MOVING_TO_GOLD -> MINING
      const moveAction = harness.getActionsByType('ACTION_TYPE_MOVE_TO')[0];
      harness.completeAction(moveAction.actionId, 'SUCCESS');
      expect(harness.getCurrentState()).toBe('MINING');

      // MINING -> SEARCHING_GOLD
      const mineAction = harness.getActionsByType('ACTION_TYPE_MINE_BLOCK')[0];
      harness.completeAction(mineAction.actionId, 'SUCCESS');
      expect(harness.getCurrentState()).toBe('SEARCHING_GOLD');

      // Verify full cycle in state history
      expect(harness.stateHistory).toEqual([
        'SEARCHING_GOLD',
        'MOVING_TO_GOLD',
        'MINING',
        'SEARCHING_GOLD',
      ]);
    });
  });

  describe('full deposit cycle', () => {
    it('search gold -> search chest -> move to chest -> deposit -> search gold', () => {
      harness.sendSensorData(createSensorData()); // IDLE -> SEARCHING_GOLD
      harness.clearHistory();

      // Inventory full -> SEARCHING_CHEST
      let sensorData = withInventoryGold(createSensorData(), 32);
      harness.sendSensorData(sensorData);
      expect(harness.getCurrentState()).toBe('SEARCHING_CHEST');

      // Found chest -> MOVING_TO_CHEST
      sensorData = withChestBlock(sensorData, { x: 8, y: 64, z: 0 });
      harness.sendSensorData(sensorData);
      expect(harness.getCurrentState()).toBe('MOVING_TO_CHEST');

      // Arrived at chest -> DEPOSITING
      const moveAction = harness.getActionsByType('ACTION_TYPE_MOVE_TO').slice(-1)[0];
      harness.completeAction(moveAction.actionId, 'SUCCESS');
      expect(harness.getCurrentState()).toBe('DEPOSITING');

      // Deposit complete -> SEARCHING_GOLD
      const depositAction = harness.getActionsByType('ACTION_TYPE_DEPOSIT_ITEMS')[0];
      harness.completeAction(depositAction.actionId, 'SUCCESS');
      expect(harness.getCurrentState()).toBe('SEARCHING_GOLD');
    });
  });
});

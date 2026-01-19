import { describe, it, expect, beforeEach } from 'vitest';
import { TestHarness } from '../harness/TestHarness';
import { createGoldMiningStateMachine } from '../../src/state-machine/scenarios/gold-mining';
import { createSensorData, withGoldBlock, withInventoryGold } from '../fixtures/sensorData';

describe('Sensor Processing', () => {
  let harness: TestHarness;

  beforeEach(() => {
    const sm = createGoldMiningStateMachine();
    harness = new TestHarness(sm);
    harness.sendSensorData(createSensorData()); // IDLE -> SEARCHING_GOLD
  });

  it('empty goldBlocks array keeps state in SEARCHING_GOLD', () => {
    const sensorData = createSensorData();
    harness.sendSensorData(sensorData);

    expect(harness.getCurrentState()).toBe('SEARCHING_GOLD');

    // Send again with no gold
    harness.sendSensorData(sensorData);

    expect(harness.getCurrentState()).toBe('SEARCHING_GOLD');
  });

  it('multiple gold blocks selects first safe one', () => {
    const sensorData = withGoldBlock(
      withGoldBlock(
        withGoldBlock(createSensorData(), { x: 5, y: 64, z: 0 }),
        { x: 10, y: 64, z: 0 }
      ),
      { x: 15, y: 64, z: 0 }
    );

    harness.sendSensorData(sensorData);

    expect(harness.getCurrentState()).toBe('MOVING_TO_GOLD');

    const targetGold = harness.getMemory().get('targetGold');
    expect(targetGold.x).toBe(5); // First one in the list
  });

  it('health data is accessible in context', () => {
    const sensorData = createSensorData({
      health: { health: 10, food: 15, saturation: 3, oxygen: 200 },
    });

    harness.sendSensorData(sensorData);

    // State machine context should have the health data
    const context = (harness.stateMachine as any).context;
    expect(context.sensorData.health.health).toBe(10);
    expect(context.sensorData.health.food).toBe(15);
  });

  it('position data is accessible in context', () => {
    const sensorData = createSensorData({
      position: { x: 100, y: 70, z: -50, yaw: 90, pitch: 0, onGround: true },
    });

    harness.sendSensorData(sensorData);

    const context = (harness.stateMachine as any).context;
    expect(context.sensorData.position.x).toBe(100);
    expect(context.sensorData.position.y).toBe(70);
    expect(context.sensorData.position.z).toBe(-50);
  });

  it('inventory gold count triggers chest search at threshold', () => {
    // Just under threshold
    let sensorData = withInventoryGold(createSensorData(), 31);
    harness.sendSensorData(sensorData);
    expect(harness.getCurrentState()).toBe('SEARCHING_GOLD');

    // At threshold
    sensorData = withInventoryGold(createSensorData(), 32);
    harness.sendSensorData(sensorData);
    expect(harness.getCurrentState()).toBe('SEARCHING_CHEST');
  });

  it('mixed inventory items only counts gold types', () => {
    const sensorData = createSensorData({
      inventory: {
        slots: [
          { slotIndex: 0, itemName: 'gold_ore', count: 15 },
          { slotIndex: 1, itemName: 'cobblestone', count: 64 },
          { slotIndex: 2, itemName: 'raw_gold', count: 10 },
          { slotIndex: 3, itemName: 'dirt', count: 32 },
        ],
        selectedSlot: 0,
      },
    });

    harness.sendSensorData(sensorData);

    // 15 + 10 = 25 gold items, under threshold
    expect(harness.getCurrentState()).toBe('SEARCHING_GOLD');
  });

  it('deepslate_gold_ore counts toward inventory threshold', () => {
    const sensorData = createSensorData({
      inventory: {
        slots: [
          { slotIndex: 0, itemName: 'gold_ore', count: 16 },
          { slotIndex: 1, itemName: 'deepslate_gold_ore', count: 16 },
        ],
        selectedSlot: 0,
      },
    });

    harness.sendSensorData(sensorData);

    // 16 + 16 = 32 gold items, at threshold
    expect(harness.getCurrentState()).toBe('SEARCHING_CHEST');
  });
});

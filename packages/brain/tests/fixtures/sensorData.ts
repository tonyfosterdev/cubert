import { SensorData, BlockInfo } from '../../src/state-machine/State';

export function createSensorData(overrides?: Partial<SensorData>): SensorData {
  return {
    timestamp: Date.now().toString(),
    botId: 'test-bot',
    position: { x: 0, y: 64, z: 0, yaw: 0, pitch: 0, onGround: true },
    inventory: { slots: [], selectedSlot: 0 },
    health: { health: 20, food: 20, saturation: 5, oxygen: 300 },
    nearbyBlocks: { goldBlocks: [], lavaBlocks: [], chestBlocks: [], hazardBlocks: [] },
    pathStatus: { state: 'idle', isMoving: false, isMining: false, targetBlock: null },
    ...overrides,
  };
}

export function withGoldBlock(data: SensorData, pos: { x: number; y: number; z: number }): SensorData {
  const block: BlockInfo = { ...pos, blockName: 'gold_ore', distance: Math.sqrt(pos.x ** 2 + pos.y ** 2 + pos.z ** 2) };
  return {
    ...data,
    nearbyBlocks: { ...data.nearbyBlocks, goldBlocks: [...data.nearbyBlocks.goldBlocks, block] },
  };
}

export function withLavaBlock(data: SensorData, pos: { x: number; y: number; z: number }): SensorData {
  const block: BlockInfo = { ...pos, blockName: 'lava', distance: Math.sqrt(pos.x ** 2 + pos.y ** 2 + pos.z ** 2) };
  return {
    ...data,
    nearbyBlocks: { ...data.nearbyBlocks, lavaBlocks: [...data.nearbyBlocks.lavaBlocks, block] },
  };
}

export function withChestBlock(data: SensorData, pos: { x: number; y: number; z: number }): SensorData {
  const block: BlockInfo = { ...pos, blockName: 'chest', distance: Math.sqrt(pos.x ** 2 + pos.y ** 2 + pos.z ** 2) };
  return {
    ...data,
    nearbyBlocks: { ...data.nearbyBlocks, chestBlocks: [...data.nearbyBlocks.chestBlocks, block] },
  };
}

export function withInventoryGold(data: SensorData, count: number): SensorData {
  return {
    ...data,
    inventory: {
      ...data.inventory,
      slots: [{ slotIndex: 0, itemName: 'gold_ore', count }],
    },
  };
}

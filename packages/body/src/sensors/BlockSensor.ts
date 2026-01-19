import { Bot } from 'mineflayer';
import { BaseSensor } from './BaseSensor';
import { Vec3 } from 'vec3';

const GOLD_ORE_BLOCKS = ['gold_ore', 'deepslate_gold_ore', 'nether_gold_ore'];
const LAVA_BLOCKS = ['lava'];
const CHEST_BLOCKS = ['chest', 'trapped_chest', 'ender_chest'];
const HAZARD_BLOCKS = ['lava', 'fire', 'cactus', 'magma_block'];

export interface BlockInfo {
  x: number;
  y: number;
  z: number;
  blockName: string;
  distance: number;
}

export interface BlocksData {
  goldBlocks: BlockInfo[];
  lavaBlocks: BlockInfo[];
  chestBlocks: BlockInfo[];
  hazardBlocks: BlockInfo[];
}

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

    // Collect all unique block IDs for a single scan
    const allBlockNames = [
      ...GOLD_ORE_BLOCKS,
      ...LAVA_BLOCKS,
      ...CHEST_BLOCKS,
      ...HAZARD_BLOCKS,
    ];
    const blockIds = [...new Set(allBlockNames)]
      .map((name) => this.mcData.blocksByName[name]?.id)
      .filter((id): id is number => id !== undefined);

    // Single findBlocks call instead of 4 separate calls
    const positions = this.bot.findBlocks({
      matching: blockIds,
      maxDistance: this.config.radius,
      count: this.config.maxCount * 4,
    });

    // Categorize results by block type
    const result: BlocksData = {
      goldBlocks: [],
      lavaBlocks: [],
      chestBlocks: [],
      hazardBlocks: [],
    };

    for (const pos of positions) {
      const block = this.bot.blockAt(pos);
      if (!block) continue;

      const info: BlockInfo = {
        x: pos.x,
        y: pos.y,
        z: pos.z,
        blockName: block.name,
        distance: pos.distanceTo(botPos),
      };

      if (GOLD_ORE_BLOCKS.includes(block.name)) result.goldBlocks.push(info);
      if (LAVA_BLOCKS.includes(block.name)) result.lavaBlocks.push(info);
      if (CHEST_BLOCKS.includes(block.name)) result.chestBlocks.push(info);
      if (HAZARD_BLOCKS.includes(block.name)) result.hazardBlocks.push(info);
    }

    // Sort each category by distance
    for (const arr of Object.values(result)) {
      arr.sort((a, b) => a.distance - b.distance);
    }

    return result;
  }

  private findBlocksOfType(blockNames: string[], origin: Vec3): BlockInfo[] {
    const blockIds = blockNames
      .map((name) => this.mcData.blocksByName[name]?.id)
      .filter((id): id is number => id !== undefined);

    if (blockIds.length === 0) return [];

    const positions = this.bot.findBlocks({
      matching: blockIds,
      maxDistance: this.config.radius,
      count: this.config.maxCount,
    });

    return positions
      .map((pos) => {
        const block = this.bot.blockAt(pos);
        const distance = pos.distanceTo(origin);

        return {
          x: pos.x,
          y: pos.y,
          z: pos.z,
          blockName: block?.name || 'unknown',
          distance: distance,
        };
      })
      .sort((a, b) => a.distance - b.distance);
  }
}

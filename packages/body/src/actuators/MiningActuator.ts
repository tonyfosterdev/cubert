import { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { BaseActuator } from './BaseActuator';
import { goldMinedTotal } from '../metrics';

export interface MineBlockPayload {
  x: number;
  y: number;
  z: number;
}

export class MiningActuator extends BaseActuator {
  constructor(bot: Bot) {
    super(bot);
  }

  async execute(actionId: string, payload: MineBlockPayload): Promise<void> {
    this.currentActionId = actionId;
    this.isExecuting = true;

    const { x, y, z } = payload;
    const position = new Vec3(x, y, z);
    console.log(`[MINE] Attempting to mine block at (${x}, ${y}, ${z})`);

    try {
      const block = this.bot.blockAt(position);

      if (!block || block.name === 'air') {
        console.log(`[MINE] No block at position (${x}, ${y}, ${z}) - found: ${block?.name || 'null'}`);
        this.complete(actionId, false, 'No block at position');
        return;
      }

      console.log(`[MINE] Found block: ${block.name} at (${x}, ${y}, ${z})`);

      // Equip a pickaxe if we have one
      await this.equipPickaxe();

      console.log(`[MINE] Digging ${block.name}...`);
      await this.bot.dig(block);
      console.log(`[MINE] Successfully mined ${block.name}`);

      // Track gold ore mined
      if (block.name.includes('gold_ore')) {
        goldMinedTotal.inc();
      }

      this.complete(actionId, true);
    } catch (err: any) {
      console.log(`[MINE] Failed: ${err.message}`);
      this.complete(actionId, false, err.message);
    }
  }

  private async equipPickaxe(): Promise<void> {
    const pickaxeNames = ['netherite_pickaxe', 'diamond_pickaxe', 'iron_pickaxe', 'golden_pickaxe', 'stone_pickaxe', 'wooden_pickaxe'];

    for (const pickName of pickaxeNames) {
      const pickaxe = this.bot.inventory.items().find(item => item.name === pickName);
      if (pickaxe) {
        console.log(`[MINE] Equipping ${pickName}`);
        await this.bot.equip(pickaxe, 'hand');
        return;
      }
    }
    console.log(`[MINE] No pickaxe found in inventory, mining with current item`);
  }

  cancel(): void {
    this.bot.stopDigging();
    super.cancel();
  }
}

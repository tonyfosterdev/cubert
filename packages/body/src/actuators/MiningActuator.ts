import { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { BaseActuator } from './BaseActuator';

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

    try {
      const block = this.bot.blockAt(position);

      if (!block || block.name === 'air') {
        this.complete(actionId, false, 'No block at position');
        return;
      }

      // Equip the best tool for this block
      if ((this.bot as any).tool) {
        await (this.bot as any).tool.equipForBlock(block);
      }

      await this.bot.dig(block);
      this.complete(actionId, true);
    } catch (err: any) {
      this.complete(actionId, false, err.message);
    }
  }

  cancel(): void {
    this.bot.stopDigging();
    super.cancel();
  }
}

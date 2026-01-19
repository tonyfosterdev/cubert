import { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { BaseActuator } from './BaseActuator';
import { goldChest } from '../metrics';

export interface DepositItemsPayload {
  chestX: number;
  chestY: number;
  chestZ: number;
  itemNames?: string[];
}

export class InventoryActuator extends BaseActuator {
  constructor(bot: Bot) {
    super(bot);
  }

  async execute(actionId: string, payload: DepositItemsPayload): Promise<void> {
    this.currentActionId = actionId;
    this.isExecuting = true;

    const { chestX, chestY, chestZ, itemNames } = payload;
    const position = new Vec3(chestX, chestY, chestZ);

    try {
      const chestBlock = this.bot.blockAt(position);

      if (!chestBlock || !chestBlock.name.includes('chest')) {
        this.complete(actionId, false, 'No chest at position');
        return;
      }

      const chest = await this.bot.openContainer(chestBlock);

      // Get items to deposit
      const items = this.bot.inventory.items();
      const toDeposit = itemNames && itemNames.length > 0
        ? items.filter((item) => itemNames.includes(item.name))
        : items;

      // Deposit each item
      for (const item of toDeposit) {
        try {
          await chest.deposit(item.type, item.metadata, item.count);
        } catch (err) {
          // Chest might be full, continue with other items
          console.warn(`Could not deposit ${item.name}:`, err);
        }
      }

      // Count gold in chest and update metric
      const chestGold = chest.containerItems()
        .filter(item => item.name === 'raw_gold')
        .reduce((sum, item) => sum + item.count, 0);
      goldChest.set(chestGold);
      console.log(`[DEPOSIT] Chest now contains ${chestGold} raw gold`);

      chest.close();
      this.complete(actionId, true);
    } catch (err: any) {
      this.complete(actionId, false, err.message);
    }
  }
}

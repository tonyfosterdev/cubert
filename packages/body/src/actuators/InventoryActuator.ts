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

export interface WithdrawItemsPayload {
  chestX: number;
  chestY: number;
  chestZ: number;
  itemNames?: string[];
  count?: number;
}

export class InventoryActuator extends BaseActuator {
  constructor(bot: Bot) {
    super(bot);
  }

  async deposit(actionId: string, payload: DepositItemsPayload): Promise<void> {
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

      // Check if bot is close enough to open the chest (within ~4 blocks)
      const botPos = this.bot.entity.position;
      const distance = botPos.distanceTo(position);
      if (distance > 4.5) {
        console.log(`[DEPOSIT] Too far from chest (${distance.toFixed(1)} blocks)`);
        this.complete(actionId, false, `Too far from chest (${distance.toFixed(1)} blocks)`);
        return;
      }

      console.log(`[DEPOSIT] Opening chest at ${position}`);
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

  async withdraw(actionId: string, payload: WithdrawItemsPayload): Promise<void> {
    this.currentActionId = actionId;
    this.isExecuting = true;

    const { chestX, chestY, chestZ, itemNames, count } = payload;
    const position = new Vec3(chestX, chestY, chestZ);

    try {
      const chestBlock = this.bot.blockAt(position);

      if (!chestBlock || !chestBlock.name.includes('chest')) {
        this.complete(actionId, false, 'No chest at position');
        return;
      }

      // Check if bot is close enough to open the chest (within ~4 blocks)
      const botPos = this.bot.entity.position;
      const distance = botPos.distanceTo(position);
      if (distance > 4.5) {
        console.log(`[WITHDRAW] Too far from chest (${distance.toFixed(1)} blocks)`);
        this.complete(actionId, false, `Too far from chest (${distance.toFixed(1)} blocks)`);
        return;
      }

      console.log(`[WITHDRAW] Opening chest at ${position}`);
      const chest = await this.bot.openContainer(chestBlock);

      // Get items in chest
      const chestItems = chest.containerItems();
      const toWithdraw = itemNames && itemNames.length > 0
        ? chestItems.filter((item) => itemNames.includes(item.name))
        : chestItems;

      let withdrawnCount = 0;

      // Withdraw each item
      for (const item of toWithdraw) {
        try {
          const withdrawAmount = count && count > 0
            ? Math.min(count, item.count)
            : item.count;
          await chest.withdraw(item.type, item.metadata, withdrawAmount);
          withdrawnCount += withdrawAmount;
          console.log(`[WITHDRAW] Took ${withdrawAmount}x ${item.name} from chest`);
        } catch (err) {
          // Inventory might be full, continue with other items
          console.warn(`Could not withdraw ${item.name}:`, err);
        }
      }

      console.log(`[WITHDRAW] Withdrew ${withdrawnCount} item(s) total`);

      chest.close();
      this.complete(actionId, true);
    } catch (err: any) {
      this.complete(actionId, false, err.message);
    }
  }
}

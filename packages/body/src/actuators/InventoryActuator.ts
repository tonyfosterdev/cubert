import { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { BaseActuator } from './BaseActuator';
import { goldChest } from '../metrics';
import { logger } from '../logger';

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

  async execute(_actionId: string, _payload: any): Promise<void> {
    throw new Error('Use deposit() or withdraw() instead');
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
        logger.warn({ distance: distance.toFixed(1) }, 'Too far from chest for deposit');
        this.complete(actionId, false, `Too far from chest (${distance.toFixed(1)} blocks)`);
        return;
      }

      logger.info({ position: { x: position.x, y: position.y, z: position.z } }, 'Opening chest for deposit');
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
          logger.warn({ err, item: item.name }, 'Could not deposit item');
        }
      }

      // Count gold in chest and update metric
      const chestGold = chest.containerItems()
        .filter(item => item.name === 'raw_gold')
        .reduce((sum, item) => sum + item.count, 0);
      goldChest.set(chestGold);
      logger.info({ rawGold: chestGold }, 'Chest gold count after deposit');

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
        logger.warn({ distance: distance.toFixed(1) }, 'Too far from chest for withdraw');
        this.complete(actionId, false, `Too far from chest (${distance.toFixed(1)} blocks)`);
        return;
      }

      logger.info({ position: { x: position.x, y: position.y, z: position.z } }, 'Opening chest for withdraw');
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
          logger.debug({ amount: withdrawAmount, item: item.name }, 'Withdrew item from chest');
        } catch (err) {
          // Inventory might be full, continue with other items
          logger.warn({ err, item: item.name }, 'Could not withdraw item');
        }
      }

      logger.info({ totalItems: withdrawnCount }, 'Withdraw complete');

      chest.close();
      this.complete(actionId, true);
    } catch (err: any) {
      this.complete(actionId, false, err.message);
    }
  }
}

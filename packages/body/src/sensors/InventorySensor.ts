import { Bot } from 'mineflayer';
import { BaseSensor } from './BaseSensor';

export interface InventorySlot {
  slotIndex: number;
  itemName: string;
  count: number;
}

export interface InventoryData {
  slots: InventorySlot[];
  selectedSlot: number;
}

export class InventorySensor extends BaseSensor<InventoryData> {
  constructor(bot: Bot) {
    super(bot);
  }

  read(): InventoryData {
    const items = this.bot.inventory.items();

    // Debug: log inventory contents
    if (items.length > 0) {
      console.log(`[INVENTORY] ${items.map(i => `${i.count}x ${i.name}`).join(', ')}`);
    }

    return {
      slots: items.map((item) => ({
        slotIndex: item.slot,
        itemName: item.name,
        count: item.count,
      })),
      selectedSlot: this.bot.quickBarSlot,
    };
  }
}

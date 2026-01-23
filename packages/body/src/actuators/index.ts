import { Bot } from 'mineflayer';
import { EventEmitter } from 'events';
import { MovementActuator } from './MovementActuator';
import { MiningActuator } from './MiningActuator';
import { InventoryActuator } from './InventoryActuator';
import { ChatActuator } from './ChatActuator';
import { ActuatorResult } from './BaseActuator';

export interface Action {
  actionId: string;
  timestamp: string;
  type: string;
  moveTo?: { x: number; y: number; z: number; range?: number; sprint?: boolean; ignoreDanger?: boolean };
  mineBlock?: { x: number; y: number; z: number };
  depositItems?: { chestX: number; chestY: number; chestZ: number; itemNames?: string[] };
  withdrawItems?: { chestX: number; chestY: number; chestZ: number; itemNames?: string[]; count?: number };
  speak?: { message: string };
  idle?: { durationMs: number };
  cancel?: { targetActionId: string };
}

export class ActuatorRegistry extends EventEmitter {
  private bot: Bot;
  private movement: MovementActuator;
  private mining: MiningActuator;
  private inventory: InventoryActuator;
  private chat: ChatActuator;

  constructor(bot: Bot) {
    super();
    this.bot = bot;

    this.movement = new MovementActuator(bot);
    this.mining = new MiningActuator(bot);
    this.inventory = new InventoryActuator(bot);
    this.chat = new ChatActuator(bot);

    // Forward completion events
    [this.movement, this.mining, this.inventory, this.chat].forEach((actuator) => {
      actuator.on('complete', (result: ActuatorResult) => {
        this.emit('actionComplete', result);
      });
    });
  }

  async execute(action: Action): Promise<void> {
    console.log(`Executing action: ${action.type} (${action.actionId})`);

    switch (action.type) {
      case 'ACTION_TYPE_MOVE_TO':
        if (action.moveTo) {
          await this.movement.execute(action.actionId, action.moveTo);
        }
        break;

      case 'ACTION_TYPE_MINE_BLOCK':
        if (action.mineBlock) {
          await this.mining.execute(action.actionId, action.mineBlock);
        }
        break;

      case 'ACTION_TYPE_DEPOSIT_ITEMS':
        if (action.depositItems) {
          await this.inventory.deposit(action.actionId, action.depositItems);
        }
        break;

      case 'ACTION_TYPE_WITHDRAW_ITEMS':
        if (action.withdrawItems) {
          await this.inventory.withdraw(action.actionId, action.withdrawItems);
        }
        break;

      case 'ACTION_TYPE_SPEAK':
        if (action.speak) {
          await this.chat.execute(action.actionId, action.speak);
        }
        break;

      case 'ACTION_TYPE_IDLE':
        if (action.idle) {
          console.log(`Idling for ${action.idle.durationMs}ms`);
          setTimeout(() => {
            this.emit('actionComplete', {
              actionId: action.actionId,
              success: true,
            });
          }, action.idle.durationMs);
        }
        break;

      case 'ACTION_TYPE_CANCEL':
        if (action.cancel) {
          this.cancelAction(action.cancel.targetActionId);
        }
        break;

      default:
        console.warn(`Unknown action type: ${action.type}`);
    }
  }

  private cancelAction(targetActionId: string): void {
    // Cancel any active actuator
    this.movement.cancel();
    this.mining.cancel();
  }

  cancelAll(): void {
    this.movement.cancel();
    this.mining.cancel();
    this.inventory.cancel();
    this.chat.cancel();
  }
}

export { MovementActuator } from './MovementActuator';
export { MiningActuator } from './MiningActuator';
export { InventoryActuator } from './InventoryActuator';
export { ChatActuator } from './ChatActuator';

import { Bot } from 'mineflayer';
import { EventEmitter } from 'events';

export interface ActuatorResult {
  actionId: string;
  success: boolean;
  errorMessage?: string;
}

export abstract class BaseActuator extends EventEmitter {
  protected bot: Bot;
  protected currentActionId: string | null = null;
  protected isExecuting = false;

  constructor(bot: Bot) {
    super();
    this.bot = bot;
  }

  abstract execute(actionId: string, payload: any): Promise<void>;

  cancel(): void {
    this.currentActionId = null;
    this.isExecuting = false;
  }

  protected complete(actionId: string, success: boolean, errorMessage?: string): void {
    this.isExecuting = false;
    this.currentActionId = null;

    this.emit('complete', {
      actionId,
      success,
      errorMessage,
    } as ActuatorResult);
  }

  isActive(): boolean {
    return this.isExecuting;
  }
}

import { Bot } from 'mineflayer';
import { BaseActuator } from './BaseActuator';

export interface SpeakPayload {
  message: string;
}

export class ChatActuator extends BaseActuator {
  constructor(bot: Bot) {
    super(bot);
  }

  async execute(actionId: string, payload: SpeakPayload): Promise<void> {
    this.currentActionId = actionId;
    this.isExecuting = true;

    try {
      this.bot.chat(payload.message);
      this.complete(actionId, true);
    } catch (err: any) {
      this.complete(actionId, false, err.message);
    }
  }
}

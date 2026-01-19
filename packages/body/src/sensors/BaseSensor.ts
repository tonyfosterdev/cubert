import { Bot } from 'mineflayer';

export abstract class BaseSensor<T> {
  protected bot: Bot;

  constructor(bot: Bot) {
    this.bot = bot;
  }

  abstract read(): T;
}

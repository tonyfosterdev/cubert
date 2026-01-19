import { Bot } from 'mineflayer';
import { BaseSensor } from './BaseSensor';

export interface HealthData {
  health: number;
  food: number;
  saturation: number;
  oxygen: number;
}

export class HealthSensor extends BaseSensor<HealthData> {
  constructor(bot: Bot) {
    super(bot);
  }

  read(): HealthData {
    return {
      health: this.bot.health,
      food: this.bot.food,
      saturation: this.bot.foodSaturation,
      oxygen: this.bot.oxygenLevel ?? 20,
    };
  }
}

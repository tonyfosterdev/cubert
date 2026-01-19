import { Bot } from 'mineflayer';
import { BaseSensor } from './BaseSensor';

export interface PositionData {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  onGround: boolean;
}

export class PositionSensor extends BaseSensor<PositionData> {
  constructor(bot: Bot) {
    super(bot);
  }

  read(): PositionData {
    const pos = this.bot.entity.position;
    return {
      x: pos.x,
      y: pos.y,
      z: pos.z,
      yaw: this.bot.entity.yaw,
      pitch: this.bot.entity.pitch,
      onGround: this.bot.entity.onGround,
    };
  }
}

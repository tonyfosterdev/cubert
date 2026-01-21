import { Bot } from 'mineflayer';

export interface PlayerInfo {
  username: string;
  x: number;
  y: number;
  z: number;
  distance: number;
}

export interface PlayerSensorConfig {
  maxCount: number;
}

export class PlayerSensor {
  private bot: Bot;
  private maxCount: number;

  constructor(bot: Bot, config: PlayerSensorConfig) {
    this.bot = bot;
    this.maxCount = config.maxCount;
  }

  read(): PlayerInfo[] {
    const players: PlayerInfo[] = [];
    const botPos = this.bot.entity.position;

    for (const playerName of Object.keys(this.bot.players)) {
      const player = this.bot.players[playerName];

      // Skip the bot itself
      if (playerName === this.bot.username) {
        continue;
      }

      // Skip players without entity (not visible/loaded)
      if (!player.entity) {
        continue;
      }

      const pos = player.entity.position;
      const distance = botPos.distanceTo(pos);

      players.push({
        username: playerName,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        distance,
      });
    }

    // Sort by distance and limit
    return players
      .sort((a, b) => a.distance - b.distance)
      .slice(0, this.maxCount);
  }
}

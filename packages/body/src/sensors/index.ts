import { Bot } from 'mineflayer';
import { BodyConfig } from '../config';
import { PositionSensor, PositionData } from './PositionSensor';
import { BlockSensor, BlocksData } from './BlockSensor';
import { InventorySensor, InventoryData } from './InventorySensor';
import { HealthSensor, HealthData } from './HealthSensor';
import { PlayerSensor, PlayerInfo } from './PlayerSensor';

export interface SensorData {
  timestamp: string;
  botId: string;
  position: PositionData;
  inventory: InventoryData;
  health: HealthData;
  nearbyBlocks: BlocksData;
  pathStatus: PathStatus;
  nearbyPlayers: PlayerInfo[];
}

export interface PathStatus {
  state: string;
  isMoving: boolean;
  isMining: boolean;
  targetBlock: { x: number; y: number; z: number; blockName: string; distance: number } | null;
}

export class SensorAggregator {
  private bot: Bot;
  private config: BodyConfig;
  private positionSensor: PositionSensor;
  private blockSensor: BlockSensor;
  private inventorySensor: InventorySensor;
  private healthSensor: HealthSensor;
  private playerSensor: PlayerSensor;

  constructor(bot: Bot, config: BodyConfig) {
    this.bot = bot;
    this.config = config;

    this.positionSensor = new PositionSensor(bot);
    this.blockSensor = new BlockSensor(bot, {
      radius: config.sensors.blockSearchRadius,
      maxCount: config.sensors.blockSearchCount,
    });
    this.inventorySensor = new InventorySensor(bot);
    this.healthSensor = new HealthSensor(bot);
    this.playerSensor = new PlayerSensor(bot, {
      maxCount: config.sensors.playerSearchCount ?? 10,
    });
  }

  collect(): SensorData {
    const pathStatus = this.getPathStatus();

    return {
      timestamp: Date.now().toString(),
      botId: this.config.minecraft.username,
      position: this.positionSensor.read(),
      inventory: this.inventorySensor.read(),
      health: this.healthSensor.read(),
      nearbyBlocks: this.blockSensor.read(),
      pathStatus,
      nearbyPlayers: this.playerSensor.read(),
    };
  }

  private getPathStatus(): PathStatus {
    const pathfinder = (this.bot as any).pathfinder;
    const isMoving = pathfinder?.isMoving() ?? false;
    const goal = pathfinder?.goal;

    let state = 'PATH_STATE_IDLE';
    if (isMoving) {
      state = 'PATH_STATE_FOLLOWING';
    } else if (goal) {
      state = 'PATH_STATE_COMPUTING';
    }

    return {
      state,
      isMoving,
      isMining: this.bot.targetDigBlock !== null,
      targetBlock: null,
    };
  }
}

export { PositionSensor } from './PositionSensor';
export { BlockSensor } from './BlockSensor';
export { InventorySensor } from './InventorySensor';
export { HealthSensor } from './HealthSensor';
export { PlayerSensor, PlayerInfo } from './PlayerSensor';

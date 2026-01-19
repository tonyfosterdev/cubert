import mineflayer, { Bot } from 'mineflayer';
import { pathfinder, Movements } from 'mineflayer-pathfinder';
import { EventEmitter } from 'events';
import { BodyConfig } from '../config';

export class BotManager extends EventEmitter {
  private config: BodyConfig;
  private bot: Bot | null = null;
  private reconnecting = false;

  constructor(config: BodyConfig) {
    super();
    this.config = config;
  }

  async connect(): Promise<Bot> {
    return new Promise((resolve, reject) => {
      console.log(`Connecting to Minecraft server at ${this.config.minecraft.host}:${this.config.minecraft.port}...`);

      this.bot = mineflayer.createBot({
        host: this.config.minecraft.host,
        port: this.config.minecraft.port,
        username: this.config.minecraft.username,
        version: this.config.minecraft.version,
        hideErrors: false,
      });

      this.bot.loadPlugin(pathfinder);

      this.bot.once('spawn', () => {
        console.log(`Bot ${this.config.minecraft.username} spawned!`);
        this.setupPathfinder();
        this.emit('botReady', this.bot);
        resolve(this.bot!);
      });

      this.bot.once('error', (err) => {
        console.error('Bot connection error:', err);
        reject(err);
      });

      this.bot.on('kicked', (reason) => {
        console.error('Bot kicked:', reason);
        this.scheduleReconnect();
      });

      this.bot.on('end', () => {
        console.log('Bot disconnected');
        this.scheduleReconnect();
      });

      this.bot.on('death', () => {
        console.log('Bot died, will respawn...');
      });
    });
  }

  private setupPathfinder(): void {
    if (!this.bot) return;

    const mcData = require('minecraft-data')(this.bot.version);
    const movements = new Movements(this.bot);

    movements.canDig = true;
    movements.allowParkour = true;
    movements.allowSprinting = true;

    // Avoid lava and other hazards
    movements.blocksCantBreak.add(mcData.blocksByName.lava?.id);
    movements.blocksToAvoid.add(mcData.blocksByName.lava?.id);
    movements.blocksToAvoid.add(mcData.blocksByName.fire?.id);
    movements.blocksToAvoid.add(mcData.blocksByName.cactus?.id);
    movements.blocksToAvoid.add(mcData.blocksByName.magma_block?.id);

    this.bot.pathfinder.setMovements(movements);
  }

  private scheduleReconnect(): void {
    if (this.reconnecting) return;
    this.reconnecting = true;

    console.log(`Reconnecting in ${this.config.grpc.reconnectIntervalMs}ms...`);

    setTimeout(async () => {
      this.reconnecting = false;
      try {
        await this.connect();
      } catch (err) {
        console.error('Reconnection failed:', err);
        this.scheduleReconnect();
      }
    }, this.config.grpc.reconnectIntervalMs);
  }

  disconnect(): void {
    if (this.bot) {
      this.bot.quit();
      this.bot = null;
    }
  }

  getBot(): Bot | null {
    return this.bot;
  }
}

import mineflayer, { Bot } from 'mineflayer';
import { pathfinder, Movements } from 'mineflayer-pathfinder';
import { EventEmitter } from 'events';
import { BodyConfig } from '../config';
import { logger } from '../logger';

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
      logger.info({ host: this.config.minecraft.host, port: this.config.minecraft.port }, 'Connecting to Minecraft server');

      this.bot = mineflayer.createBot({
        host: this.config.minecraft.host,
        port: this.config.minecraft.port,
        username: this.config.minecraft.username,
        version: this.config.minecraft.version,
        hideErrors: false,
        viewDistance: 'tiny', // 2 chunks - reduces CPU by loading less world data
      });

      this.bot.loadPlugin(pathfinder);

      this.bot.once('spawn', () => {
        logger.info({ username: this.config.minecraft.username }, 'Bot spawned');
        this.setupPathfinder();

        // Wait for chunks AND physics before signaling ready
        const checkReady = () => {
          // Check if blocks around the bot are loaded by sampling nearby positions
          const pos = this.bot!.entity.position;
          const offsets = [[0, 0], [16, 0], [-16, 0], [0, 16], [0, -16]];
          const chunksLoaded = offsets.every(([dx, dz]) => {
            const block = this.bot!.blockAt(pos.offset(dx, -1, dz));
            return block !== null;
          });

          if (!chunksLoaded) {
            setTimeout(checkReady, 100);
            return;
          }

          // Then wait for physics to process the chunks
          let physicsTicks = 0;
          const onPhysics = () => {
            if (++physicsTicks >= 5) { // ~250ms of physics
              this.bot!.off('physicsTick', onPhysics);
              logger.info('Bot ready (chunks loaded, physics initialized)');
              this.emit('botReady', this.bot);
              resolve(this.bot!);
            }
          };
          this.bot!.on('physicsTick', onPhysics);
        };

        checkReady();
      });

      this.bot.once('error', (err) => {
        logger.error({ err }, 'Bot connection error');
        reject(err);
      });

      this.bot.on('kicked', (reason) => {
        logger.error({ reason }, 'Bot kicked');
        this.scheduleReconnect();
      });

      this.bot.on('end', () => {
        logger.info('Bot disconnected');
        this.scheduleReconnect();
      });

      this.bot.on('death', () => {
        logger.info('Bot died, shutting down (no reconnect on death)');
        this.reconnecting = true; // Prevent scheduleReconnect from firing
        this.bot?.quit();
        process.exit(1);
      });
    });
  }

  private setupPathfinder(): void {
    if (!this.bot) return;

    const mcData = require('minecraft-data')(this.bot.version);
    const movements = new Movements(this.bot);

    movements.canDig = true;
    movements.allowParkour = false;
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

    logger.info({ delayMs: this.config.grpc.reconnectIntervalMs }, 'Scheduling reconnect');

    setTimeout(async () => {
      this.reconnecting = false;
      try {
        await this.connect();
      } catch (err) {
        logger.error({ err }, 'Reconnection failed');
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

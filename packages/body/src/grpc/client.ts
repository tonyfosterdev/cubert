import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { EventEmitter } from 'events';
import { BodyConfig } from '../config';
import { SensorData } from '../sensors';
import { Action } from '../actuators';
import { SvidWatcher } from '../spiffe/SvidWatcher';
import { createClientCredentials } from '../spiffe/credentials';
import { SvidData } from '../spiffe/types';
import { logger } from '../logger';

export interface ActionEvent {
  actionId: string;
  result: string;
  errorMessage?: string;
  eventType: string;
}

export interface ChatMessage {
  timestamp: number;
  sender: string;
  message: string;
}
import path from 'path';

const PROTO_PATH = process.env.PROTO_PATH || path.resolve(__dirname, '../../../../proto/cubert.proto');

export class BrainClient extends EventEmitter {
  private config: BodyConfig;
  private client: any;
  private stream: grpc.ClientDuplexStream<any, any> | null = null;
  private reconnectAttempts = 0;
  private connected = false;
  private supervisorMode: boolean;
  private svidWatcher: SvidWatcher | null = null;

  constructor(config: BodyConfig) {
    super();
    this.config = config;
    this.supervisorMode = !!config.supervisor;
  }

  async connect(): Promise<void> {
    const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });

    const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any;

    if (this.supervisorMode && this.config.supervisor && this.config.spiffe) {
      // Supervisor mode: connect via mTLS to SupervisorService
      if (!this.svidWatcher) {
        this.svidWatcher = new SvidWatcher(this.config.spiffe.agentSocket);
        this.svidWatcher.on('error', (err) => {
          logger.error({ err }, 'SvidWatcher error');
        });
        this.svidWatcher.on('rotated', (newSvid: SvidData) => {
          logger.info({ spiffeId: newSvid.spiffeId }, 'SVID rotated, reconnecting to supervisor');
          this.disconnect();
          this.connect().catch((err) => {
            logger.error({ err }, 'Failed to reconnect after SVID rotation');
          });
        });

        logger.info('Waiting for SVID from SPIRE agent...');
        const svid = await this.svidWatcher.start();
        logger.info({ spiffeId: svid.spiffeId }, 'Got initial SVID');
      }

      const svid = this.svidWatcher.getSvid();
      if (!svid) {
        throw new Error('No SVID available');
      }

      const SupervisorService = protoDescriptor.cubert.SupervisorService;
      const address = `${this.config.supervisor.host}:${this.config.supervisor.port}`;
      const credentials = createClientCredentials(svid);

      logger.info({ address, spiffeId: svid.spiffeId }, 'Connecting to supervisor');
      this.client = new SupervisorService(address, credentials);
    } else {
      // Direct mode: connect insecure to BrainService
      const BrainService = protoDescriptor.cubert.BrainService;
      const address = `${this.config.grpc.brainHost}:${this.config.grpc.brainPort}`;
      logger.info({ address }, 'Connecting to brain');
      this.client = new BrainService(address, grpc.credentials.createInsecure());
    }

    return new Promise((resolve, reject) => {
      // Wait for the connection to be ready
      const deadline = new Date();
      deadline.setSeconds(deadline.getSeconds() + 10);

      this.client.waitForReady(deadline, (err: Error | undefined) => {
        if (err) {
          logger.error({ err }, this.supervisorMode ? 'Failed to connect to supervisor' : 'Failed to connect to brain');
          this.scheduleReconnect();
          reject(err);
          return;
        }

        this.setupStream();
        this.connected = true;
        this.reconnectAttempts = 0;
        logger.info(this.supervisorMode ? 'Connected to supervisor!' : 'Connected to brain!');
        resolve();
      });
    });
  }

  private setupStream(): void {
    // BodyUplink in supervisor mode, Connect in direct mode
    this.stream = this.supervisorMode ? this.client.BodyUplink() : this.client.Connect();

    this.stream!.on('data', (action: any) => {
      this.emit('action', this.deserializeAction(action));
    });

    this.stream!.on('error', (err: Error) => {
      logger.error({ err }, 'Stream error');
      this.connected = false;
      this.scheduleReconnect();
    });

    this.stream!.on('end', () => {
      logger.info('Stream ended');
      this.connected = false;
      this.scheduleReconnect();
    });

    // Emit connected event for connection recovery handling
    this.emit('connected');
  }

  sendSensorData(data: SensorData): void {
    if (!this.stream || !this.connected) {
      return;
    }

    const message = {
      sensorData: this.serializeSensorData(data),
    };

    try {
      this.stream.write(message);
    } catch (err) {
      logger.error({ err }, 'Failed to send sensor data');
    }
  }

  sendActionEvent(event: ActionEvent): void {
    if (!this.stream || !this.connected) {
      return;
    }

    const message = {
      actionEvent: {
        timestamp: Date.now().toString(),
        actionId: event.actionId,
        result: event.result,
        errorMessage: event.errorMessage,
        eventType: event.eventType,
      },
    };

    try {
      this.stream.write(message);
    } catch (err) {
      logger.error({ err }, 'Failed to send action event');
    }
  }

  sendConnectEvent(sensorData: SensorData): void {
    if (!this.stream || !this.connected) {
      return;
    }

    const message = {
      connectEvent: {
        timestamp: Date.now().toString(),
        initialSensorData: this.serializeSensorData(sensorData),
      },
    };

    try {
      this.stream.write(message);
      logger.info('Sent connect event to brain');
    } catch (err) {
      logger.error({ err }, 'Failed to send connect event');
    }
  }

  sendChatMessage(chat: ChatMessage): void {
    if (!this.stream || !this.connected) {
      return;
    }

    const message = {
      chatMessage: {
        timestamp: chat.timestamp.toString(),
        sender: chat.sender,
        message: chat.message,
      },
    };

    try {
      this.stream.write(message);
      logger.debug({ message: chat.message }, 'Sent chat message to brain');
    } catch (err) {
      logger.error({ err }, 'Failed to send chat message');
    }
  }

  private serializeSensorData(data: SensorData): any {
    return {
      timestamp: data.timestamp,
      botId: data.botId,
      position: data.position,
      inventory: {
        slots: data.inventory.slots.map((s) => ({
          slotIndex: s.slotIndex,
          itemName: s.itemName,
          count: s.count,
        })),
        selectedSlot: data.inventory.selectedSlot,
      },
      health: data.health,
      nearbyBlocks: {
        goldBlocks: data.nearbyBlocks.goldBlocks,
        lavaBlocks: data.nearbyBlocks.lavaBlocks,
        chestBlocks: data.nearbyBlocks.chestBlocks,
        hazardBlocks: data.nearbyBlocks.hazardBlocks,
      },
      pathStatus: {
        state: data.pathStatus.state,
        isMoving: data.pathStatus.isMoving,
        isMining: data.pathStatus.isMining,
        targetBlock: data.pathStatus.targetBlock,
      },
      nearbyPlayers: (data.nearbyPlayers || []).map((p) => ({
        username: p.username,
        x: p.x,
        y: p.y,
        z: p.z,
        distance: p.distance,
      })),
    };
  }

  private deserializeAction(action: any): Action {
    return {
      actionId: action.actionId,
      timestamp: action.timestamp,
      type: action.type,
      moveTo: action.moveTo,
      mineBlock: action.mineBlock,
      depositItems: action.depositItems,
      withdrawItems: action.withdrawItems,
      speak: action.speak,
      idle: action.idle,
      cancel: action.cancel,
    };
  }

  private scheduleReconnect(): void {
    if (
      this.config.grpc.maxReconnectAttempts !== -1 &&
      this.reconnectAttempts >= this.config.grpc.maxReconnectAttempts
    ) {
      logger.error('Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.config.grpc.reconnectIntervalMs * Math.pow(1.5, this.reconnectAttempts),
      30000
    );

    logger.info({ delayMs: delay, attempt: this.reconnectAttempts }, 'Scheduling brain reconnect');

    setTimeout(async () => {
      try {
        await this.connect();
      } catch (err) {
        // Error already logged in connect()
      }
    }, delay);
  }

  disconnect(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
    if (this.svidWatcher) {
      this.svidWatcher.stop();
      this.svidWatcher = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }
}

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { EventEmitter } from 'events';
import { BodyConfig } from '../config';
import { SensorData } from '../sensors';
import { Action } from '../actuators';
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

  constructor(config: BodyConfig) {
    super();
    this.config = config;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
        keepCase: false,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      });

      const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any;
      const BrainService = protoDescriptor.cubert.BrainService;

      const address = `${this.config.grpc.brainHost}:${this.config.grpc.brainPort}`;
      logger.info({ address }, 'Connecting to brain');

      this.client = new BrainService(address, grpc.credentials.createInsecure());

      // Wait for the connection to be ready
      const deadline = new Date();
      deadline.setSeconds(deadline.getSeconds() + 10);

      this.client.waitForReady(deadline, (err: Error | undefined) => {
        if (err) {
          logger.error({ err }, 'Failed to connect to brain');
          this.scheduleReconnect();
          reject(err);
          return;
        }

        this.setupStream();
        this.connected = true;
        this.reconnectAttempts = 0;
        logger.info('Connected to brain!');
        resolve();
      });
    });
  }

  private setupStream(): void {
    this.stream = this.client.Connect();

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
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }
}

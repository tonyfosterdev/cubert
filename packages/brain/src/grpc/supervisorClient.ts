import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { BrainConfig } from '../config';
import { ThoughtBrain } from '../brains';
import { Action } from '../types';
import { SvidWatcher } from '../spiffe/SvidWatcher';
import { createClientCredentials } from '../spiffe/credentials';
import { SvidData } from '../spiffe/types';
import {
  deserializeSensorData,
  deserializeActionEvent,
  deserializeChatMessage,
  serializeAction,
} from './serialization';
import { logger } from '../logger';
import path from 'path';

const PROTO_PATH = process.env.PROTO_PATH || path.resolve(__dirname, '../../../../proto/cubert.proto');

/**
 * Brain client that connects to the supervisor via mTLS.
 * Opens a BrainUplink bidirectional stream: sends Actions, receives BodyMessages.
 */
export class BrainSupervisorClient {
  private config: BrainConfig;
  private thoughtBrain: ThoughtBrain;
  private svidWatcher: SvidWatcher;
  private client: any = null;
  private stream: grpc.ClientDuplexStream<any, any> | null = null;
  private reconnectAttempts = 0;
  private connected = false;

  constructor(config: BrainConfig, thoughtBrain: ThoughtBrain, svidWatcher: SvidWatcher) {
    this.config = config;
    this.thoughtBrain = thoughtBrain;
    this.svidWatcher = svidWatcher;

    // Handle SVID rotation: disconnect and reconnect with new credentials
    this.svidWatcher.on('rotated', (newSvid: SvidData) => {
      logger.info({ spiffeId: newSvid.spiffeId }, 'SVID rotated, reconnecting to supervisor');
      this.disconnect();
      this.connect().catch((err) => {
        logger.error({ err }, 'Failed to reconnect after SVID rotation');
      });
    });
  }

  async connect(): Promise<void> {
    if (!this.config.supervisor) {
      throw new Error('Supervisor config not set');
    }

    const svid = this.svidWatcher.getSvid();
    if (!svid) {
      throw new Error('No SVID available');
    }

    const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });

    const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any;
    const SupervisorService = protoDescriptor.cubert.SupervisorService;

    const address = `${this.config.supervisor.host}:${this.config.supervisor.port}`;
    const credentials = createClientCredentials(svid);

    logger.info({ address, spiffeId: svid.spiffeId }, 'Connecting to supervisor');

    this.client = new SupervisorService(address, credentials);

    return new Promise((resolve, reject) => {
      const deadline = new Date();
      deadline.setSeconds(deadline.getSeconds() + 10);

      this.client.waitForReady(deadline, (err: Error | undefined) => {
        if (err) {
          logger.error({ err }, 'Failed to connect to supervisor');
          this.scheduleReconnect();
          reject(err);
          return;
        }

        this.setupStream();
        this.connected = true;
        this.reconnectAttempts = 0;
        logger.info('Connected to supervisor!');
        resolve();
      });
    });
  }

  private setupStream(): void {
    // BrainUplink: brain sends Actions, receives BodyMessages
    this.stream = this.client.BrainUplink();

    this.stream!.on('data', async (bodyMessage: any) => {
      try {
        let actions: Action[] = [];

        if (bodyMessage.connectEvent) {
          logger.info('Body connected (via supervisor), resetting brain');
          this.thoughtBrain.reset();

          if (bodyMessage.connectEvent.initialSensorData) {
            const sensorData = deserializeSensorData(bodyMessage.connectEvent.initialSensorData);
            actions = await this.thoughtBrain.onConnect(sensorData);
          }
        } else if (bodyMessage.sensorData) {
          const sensorData = deserializeSensorData(bodyMessage.sensorData);
          actions = await this.thoughtBrain.onSensorUpdate(sensorData);
        } else if (bodyMessage.actionEvent) {
          const event = deserializeActionEvent(bodyMessage.actionEvent);
          logger.info({ eventType: event.eventType, actionId: event.actionId, result: event.result }, 'Action event');
          actions = await this.thoughtBrain.onActionComplete(event);
        } else if (bodyMessage.chatMessage) {
          const chat = deserializeChatMessage(bodyMessage.chatMessage);
          logger.info({ sender: chat.sender, message: chat.message }, 'Chat message');
          actions = await this.thoughtBrain.onChatMessage(chat);
        }

        // Send all actions back through the stream
        for (const action of actions) {
          const actionMsg = serializeAction(action);
          this.stream!.write(actionMsg);
        }
      } catch (err) {
        logger.error({ err }, 'Error processing message from supervisor');
      }
    });

    this.stream!.on('error', (err: Error) => {
      logger.error({ err }, 'Supervisor stream error');
      this.connected = false;
      this.scheduleReconnect();
    });

    this.stream!.on('end', () => {
      logger.info('Supervisor stream ended');
      this.connected = false;
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = Math.min(2000 * Math.pow(1.5, this.reconnectAttempts), 30000);

    logger.info({ delayMs: delay, attempt: this.reconnectAttempts }, 'Scheduling supervisor reconnect');

    setTimeout(async () => {
      try {
        await this.connect();
      } catch {
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
}

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { SensorData, Action, ActionEvent } from '../types';
import { ThoughtBrain } from '../brains';
import { ChatMessage } from '../thought';
import { BrainConfig } from '../config';
import path from 'path';
import { logger } from '../logger';
import {
  deserializeSensorData,
  deserializeActionEvent,
  deserializeChatMessage,
  serializeAction,
} from './serialization';

const PROTO_PATH = process.env.PROTO_PATH || path.resolve(__dirname, '../../../../proto/cubert.proto');

// Brain abstraction for different implementations
interface Brain {
  onConnect?(initialData: SensorData): Promise<Action[]>;
  onSensorUpdate?(data: SensorData): Promise<Action[]>;
  onActionComplete?(event: ActionEvent): Promise<Action[]>;
  onChatMessage?(chat: ChatMessage): Promise<Action[]>;
  reset?(): void;
}

export class BrainServer {
  private config: BrainConfig;
  private server: grpc.Server;
  private thoughtBrain: ThoughtBrain;
  private brain: Brain;

  constructor(config: BrainConfig, brainImpl: ThoughtBrain) {
    this.config = config;
    this.server = new grpc.Server();
    this.thoughtBrain = brainImpl;
    this.brain = {
      onConnect: (data) => this.thoughtBrain.onConnect(data),
      onSensorUpdate: (data) => this.thoughtBrain.onSensorUpdate(data),
      onActionComplete: (event) => this.thoughtBrain.onActionComplete(event),
      onChatMessage: (chat) => this.thoughtBrain.onChatMessage(chat),
      reset: () => this.thoughtBrain.reset(),
    };
  }

  async start(): Promise<void> {
    const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });

    const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any;

    this.server.addService(protoDescriptor.cubert.BrainService.service, {
      connect: this.handleConnect.bind(this),
      ping: this.handlePing.bind(this),
    });

    return new Promise((resolve, reject) => {
      this.server.bindAsync(
        `0.0.0.0:${this.config.grpc.port}`,
        grpc.ServerCredentials.createInsecure(),
        (err, port) => {
          if (err) {
            reject(err);
            return;
          }

          logger.info({ port }, 'Brain gRPC server listening');
          resolve();
        }
      );
    });
  }

  private handleConnect(stream: grpc.ServerDuplexStream<any, any>): void {
    logger.info('Bot connected to brain');

    stream.on('data', async (bodyMessage: any) => {
      try {
        let actions: Action[] = [];

        // Determine message type from the wrapper
        if (bodyMessage.connectEvent) {
          // Body connected/reconnected - reset state
          logger.info('Body connected, resetting brain');
          this.brain.reset?.();

          // Process initial sensor data if provided
          if (bodyMessage.connectEvent.initialSensorData) {
            const sensorData = deserializeSensorData(bodyMessage.connectEvent.initialSensorData);
            actions = (await this.brain.onConnect?.(sensorData)) || [];
          }
        } else if (bodyMessage.sensorData) {
          // Regular sensor update
          const sensorData = deserializeSensorData(bodyMessage.sensorData);
          actions = (await this.brain.onSensorUpdate?.(sensorData)) || [];
        } else if (bodyMessage.actionEvent) {
          // Immediate action event
          const event = deserializeActionEvent(bodyMessage.actionEvent);
          logger.info({ eventType: event.eventType, actionId: event.actionId, result: event.result }, 'Action event');
          actions = (await this.brain.onActionComplete?.(event)) || [];
        } else if (bodyMessage.chatMessage) {
          // Chat message from player
          const chat = deserializeChatMessage(bodyMessage.chatMessage);
          logger.info({ sender: chat.sender, message: chat.message }, 'Chat message');
          actions = (await this.brain.onChatMessage?.(chat)) || [];
        }

        // Send all actions
        for (const action of actions) {
          const actionMsg = serializeAction(action);
          stream.write(actionMsg);
        }
      } catch (err) {
        logger.error({ err }, 'Error processing message');
      }
    });

    stream.on('error', (err: Error) => {
      logger.error({ err }, 'Stream error');
    });

    stream.on('end', () => {
      logger.info('Bot disconnected from brain');
      stream.end();
    });
  }

  private handlePing(
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>
  ): void {
    const { botId } = call.request;
    logger.debug({ botId }, 'Ping received');

    callback(null, {
      ready: true,
      scenario: this.config.scenario,
    });
  }

  stop(): void {
    this.server.tryShutdown(() => {
      logger.info('Brain server stopped');
    });
  }
}

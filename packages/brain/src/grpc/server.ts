import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { StateMachine } from '../state-machine/StateMachine';
import { SensorData, Action, ActionEvent } from '../state-machine/State';
import { ThoughtBrain } from '../brains';
import { ChatMessage } from '../thought';
import { BrainConfig } from '../config';
import path from 'path';

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
  private stateMachine: StateMachine | null = null;
  private thoughtBrain: ThoughtBrain | null = null;
  private brain: Brain;

  constructor(config: BrainConfig, brainImpl: StateMachine | ThoughtBrain) {
    this.config = config;
    this.server = new grpc.Server();

    // Detect brain type
    if (brainImpl instanceof ThoughtBrain) {
      this.thoughtBrain = brainImpl;
      this.brain = {
        onConnect: (data) => this.thoughtBrain!.onConnect(data),
        onSensorUpdate: (data) => this.thoughtBrain!.onSensorUpdate(data),
        onActionComplete: (event) => this.thoughtBrain!.onActionComplete(event),
        onChatMessage: (chat) => this.thoughtBrain!.onChatMessage(chat),
        reset: () => this.thoughtBrain!.reset(),
      };
    } else {
      this.stateMachine = brainImpl;
      this.brain = {
        onConnect: async (data) => this.stateMachine!.update(data),
        onSensorUpdate: async (data) => this.stateMachine!.update(data),
        onActionComplete: async (event) => this.stateMachine!.handleEvent(event),
        reset: () => this.stateMachine!.resetToSafeState(),
      };
    }
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

          console.log(`Brain gRPC server listening on port ${port}`);
          resolve();
        }
      );
    });
  }

  private handleConnect(stream: grpc.ServerDuplexStream<any, any>): void {
    console.log('Bot connected to brain');

    stream.on('data', async (bodyMessage: any) => {
      try {
        let actions: Action[] = [];

        // Determine message type from the wrapper
        if (bodyMessage.connectEvent) {
          // Body connected/reconnected - reset state
          console.log('[CONNECT] Body connected, resetting brain');
          this.brain.reset?.();

          // Process initial sensor data if provided
          if (bodyMessage.connectEvent.initialSensorData) {
            const sensorData = this.deserializeSensorData(bodyMessage.connectEvent.initialSensorData);
            actions = (await this.brain.onConnect?.(sensorData)) || [];
          }
        } else if (bodyMessage.sensorData) {
          // Regular sensor update
          const sensorData = this.deserializeSensorData(bodyMessage.sensorData);
          actions = (await this.brain.onSensorUpdate?.(sensorData)) || [];
        } else if (bodyMessage.actionEvent) {
          // Immediate action event
          const event = this.deserializeActionEvent(bodyMessage.actionEvent);
          console.log(`[EVENT] ${event.eventType}: ${event.actionId} = ${event.result}`);
          actions = (await this.brain.onActionComplete?.(event)) || [];
        } else if (bodyMessage.chatMessage) {
          // Chat message from player
          const chat = this.deserializeChatMessage(bodyMessage.chatMessage);
          console.log(`[CHAT] ${chat.sender}: "${chat.message}"`);
          actions = (await this.brain.onChatMessage?.(chat)) || [];
        }

        // Send all actions
        for (const action of actions) {
          const actionMsg = this.serializeAction(action);
          stream.write(actionMsg);
        }
      } catch (err) {
        console.error('Error processing message:', err);
      }
    });

    stream.on('error', (err: Error) => {
      console.error('Stream error:', err);
    });

    stream.on('end', () => {
      console.log('Bot disconnected from brain');
      stream.end();
    });
  }

  private handlePing(
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>
  ): void {
    const { botId } = call.request;
    console.log(`Ping from ${botId}`);

    callback(null, {
      ready: true,
      scenario: this.config.scenario,
    });
  }

  private deserializeSensorData(msg: any): SensorData {
    return {
      timestamp: msg.timestamp,
      botId: msg.botId,
      position: {
        x: msg.position?.x || 0,
        y: msg.position?.y || 0,
        z: msg.position?.z || 0,
        yaw: msg.position?.yaw || 0,
        pitch: msg.position?.pitch || 0,
        onGround: msg.position?.onGround || false,
      },
      inventory: {
        slots: (msg.inventory?.slots || []).map((s: any) => ({
          slotIndex: s.slotIndex,
          itemName: s.itemName,
          count: s.count,
        })),
        selectedSlot: msg.inventory?.selectedSlot || 0,
      },
      health: {
        health: msg.health?.health || 20,
        food: msg.health?.food || 20,
        saturation: msg.health?.saturation || 5,
        oxygen: msg.health?.oxygen || 20,
      },
      nearbyBlocks: {
        goldBlocks: msg.nearbyBlocks?.goldBlocks || [],
        lavaBlocks: msg.nearbyBlocks?.lavaBlocks || [],
        chestBlocks: msg.nearbyBlocks?.chestBlocks || [],
        hazardBlocks: msg.nearbyBlocks?.hazardBlocks || [],
      },
      pathStatus: {
        state: msg.pathStatus?.state || 'PATH_STATE_IDLE',
        isMoving: msg.pathStatus?.isMoving || false,
        isMining: msg.pathStatus?.isMining || false,
        targetBlock: msg.pathStatus?.targetBlock || null,
      },
    };
  }

  private deserializeActionEvent(msg: any): ActionEvent {
    return {
      actionId: msg.actionId || msg.action_id,
      result: msg.result,
      errorMessage: msg.errorMessage || msg.error_message,
      eventType: msg.eventType || msg.event_type,
    };
  }

  private deserializeChatMessage(msg: any): ChatMessage {
    return {
      timestamp: parseInt(msg.timestamp) || Date.now(),
      sender: msg.sender || 'unknown',
      message: msg.message || '',
    };
  }

  private serializeAction(action: Action): any {
    return {
      actionId: action.actionId,
      timestamp: action.timestamp,
      type: action.type,
      moveTo: action.moveTo,
      mineBlock: action.mineBlock,
      depositItems: action.depositItems,
      speak: action.speak,
      idle: action.idle,
      cancel: action.cancel,
    };
  }

  stop(): void {
    this.server.tryShutdown(() => {
      console.log('Brain server stopped');
    });
  }
}

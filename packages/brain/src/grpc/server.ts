import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { StateMachine } from '../state-machine/StateMachine';
import { SensorData, Action } from '../state-machine/State';
import { BrainConfig } from '../config';
import path from 'path';

const PROTO_PATH = process.env.PROTO_PATH || path.resolve(__dirname, '../../../../proto/cubert.proto');

export class BrainServer {
  private config: BrainConfig;
  private server: grpc.Server;
  private stateMachine: StateMachine;

  constructor(config: BrainConfig, stateMachine: StateMachine) {
    this.config = config;
    this.stateMachine = stateMachine;
    this.server = new grpc.Server();
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

    stream.on('data', (sensorDataMsg: any) => {
      try {
        const sensorData = this.deserializeSensorData(sensorDataMsg);
        const actions = this.stateMachine.update(sensorData);

        for (const action of actions) {
          const actionMsg = this.serializeAction(action);
          stream.write(actionMsg);
        }
      } catch (err) {
        console.error('Error processing sensor data:', err);
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
      actionFeedback: msg.actionFeedback
        ? {
            actionId: msg.actionFeedback.actionId,
            result: msg.actionFeedback.result,
            errorMessage: msg.actionFeedback.errorMessage,
          }
        : null,
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

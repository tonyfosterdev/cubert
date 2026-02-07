import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { SupervisorConfig } from '../config';
import { SvidWatcher } from '../spiffe/SvidWatcher';
import { createServerCredentials } from '../spiffe/credentials';
import { SvidData } from '../spiffe/types';
import { logger } from '../logger';
import { activeConnections, messagesRelayed, authFailures } from '../metrics';
import path from 'path';

const PROTO_PATH = process.env.PROTO_PATH || path.resolve(__dirname, '../../../../../proto/cubert.proto');

/**
 * Extract SPIFFE ID from a gRPC call's peer certificate.
 * The SPIFFE ID is stored in the Subject Alternative Name (URI) field.
 */
function extractSpiffeId(call: grpc.ServerDuplexStream<any, any>): string | null {
  try {
    const peer = call.getPeer();
    // Access the underlying TLS socket through grpc-js internals
    const socket = (call as any)?.call?.stream?.session?.socket;
    if (!socket || !socket.getPeerCertificate) {
      logger.warn({ peer }, 'No TLS socket available for peer cert extraction');
      return null;
    }

    const peerCert = socket.getPeerCertificate();
    if (!peerCert || !peerCert.subjectaltname) {
      logger.warn({ peer }, 'No peer certificate or SAN found');
      return null;
    }

    // Parse "URI:spiffe://cubert.local/body, ..." format
    const sans = peerCert.subjectaltname.split(',').map((s: string) => s.trim());
    for (const san of sans) {
      if (san.startsWith('URI:spiffe://')) {
        return san.substring(4); // Remove "URI:" prefix
      }
    }

    logger.warn({ subjectaltname: peerCert.subjectaltname }, 'No SPIFFE URI SAN found');
    return null;
  } catch (err) {
    logger.error({ err }, 'Failed to extract SPIFFE ID from peer cert');
    return null;
  }
}

export class SupervisorServer {
  private config: SupervisorConfig;
  private server: grpc.Server;
  private svidWatcher: SvidWatcher;

  // Connected streams
  private bodyStream: grpc.ServerDuplexStream<any, any> | null = null;
  private brainStream: grpc.ServerDuplexStream<any, any> | null = null;

  constructor(config: SupervisorConfig, svidWatcher: SvidWatcher) {
    this.config = config;
    this.server = new grpc.Server();
    this.svidWatcher = svidWatcher;
  }

  async start(): Promise<void> {
    const svid = this.svidWatcher.getSvid();
    if (!svid) {
      throw new Error('No SVID available - cannot start server');
    }

    const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });

    const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any;

    this.server.addService(protoDescriptor.cubert.SupervisorService.service, {
      bodyUplink: this.handleBodyUplink.bind(this),
      brainUplink: this.handleBrainUplink.bind(this),
      ping: this.handlePing.bind(this),
    });

    const credentials = createServerCredentials(svid);

    // Listen for SVID rotation
    this.svidWatcher.on('rotated', (newSvid: SvidData) => {
      logger.warn(
        { spiffeId: newSvid.spiffeId },
        'SVID rotated - grpc-js does not support hot-swapping server credentials. Restart required for new certs.'
      );
    });

    return new Promise((resolve, reject) => {
      this.server.bindAsync(
        `0.0.0.0:${this.config.port}`,
        credentials,
        (err, port) => {
          if (err) {
            reject(err);
            return;
          }
          logger.info({ port, spiffeId: svid.spiffeId }, 'Supervisor gRPC server listening with mTLS');
          resolve();
        }
      );
    });
  }

  private handleBodyUplink(stream: grpc.ServerDuplexStream<any, any>): void {
    const spiffeId = extractSpiffeId(stream);
    const peer = stream.getPeer();

    if (spiffeId !== this.config.spiffe.expectedBodyId) {
      logger.warn(
        { spiffeId, expected: this.config.spiffe.expectedBodyId, peer },
        'Body uplink rejected: SPIFFE ID mismatch'
      );
      authFailures.inc({ reason: 'spiffe_id_mismatch' });
      stream.destroy(new Error(`Unauthorized: expected ${this.config.spiffe.expectedBodyId}, got ${spiffeId}`));
      return;
    }

    logger.info({ spiffeId, peer }, 'Body connected to supervisor');
    this.bodyStream = stream;
    activeConnections.inc({ role: 'body' });

    // Relay BodyMessages from body to brain
    stream.on('data', (bodyMessage: any) => {
      const relayLog = this.describeBodyMessage(bodyMessage);
      messagesRelayed.inc({ direction: 'body_to_brain' });

      if (this.brainStream) {
        logger.info({ direction: 'body_to_brain', ...relayLog }, 'Relaying body → brain');
        try {
          this.brainStream.write(bodyMessage);
        } catch (err) {
          logger.error({ err }, 'Failed to relay body message to brain');
        }
      } else {
        logger.info({ direction: 'body_to_brain', ...relayLog }, 'Relay skipped: brain stream not connected');
      }
    });

    stream.on('error', (err: Error) => {
      logger.error({ err, peer }, 'Body stream error');
      this.bodyStream = null;
      activeConnections.dec({ role: 'body' });
    });

    stream.on('end', () => {
      logger.info({ peer }, 'Body disconnected from supervisor');
      this.bodyStream = null;
      activeConnections.dec({ role: 'body' });
      stream.end();
    });
  }

  private handleBrainUplink(stream: grpc.ServerDuplexStream<any, any>): void {
    const spiffeId = extractSpiffeId(stream);
    const peer = stream.getPeer();

    if (spiffeId !== this.config.spiffe.expectedBrainId) {
      logger.warn(
        { spiffeId, expected: this.config.spiffe.expectedBrainId, peer },
        'Brain uplink rejected: SPIFFE ID mismatch'
      );
      authFailures.inc({ reason: 'spiffe_id_mismatch' });
      stream.destroy(new Error(`Unauthorized: expected ${this.config.spiffe.expectedBrainId}, got ${spiffeId}`));
      return;
    }

    logger.info({ spiffeId, peer }, 'Brain connected to supervisor');
    this.brainStream = stream;
    activeConnections.inc({ role: 'brain' });

    // Relay Actions from brain to body
    stream.on('data', (action: any) => {
      const relayLog = this.describeAction(action);
      messagesRelayed.inc({ direction: 'brain_to_body' });

      if (this.bodyStream) {
        logger.info({ direction: 'brain_to_body', ...relayLog }, 'Relaying brain → body');
        try {
          this.bodyStream.write(action);
        } catch (err) {
          logger.error({ err }, 'Failed to relay brain action to body');
        }
      } else {
        logger.info({ direction: 'brain_to_body', ...relayLog }, 'Relay skipped: body stream not connected');
      }
    });

    stream.on('error', (err: Error) => {
      logger.error({ err, peer }, 'Brain stream error');
      this.brainStream = null;
      activeConnections.dec({ role: 'brain' });
    });

    stream.on('end', () => {
      logger.info({ peer }, 'Brain disconnected from supervisor');
      this.brainStream = null;
      activeConnections.dec({ role: 'brain' });
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
      ready: this.bodyStream !== null && this.brainStream !== null,
      scenario: 'supervisor',
    });
  }

  private describeBodyMessage(msg: any): Record<string, unknown> {
    if (msg.sensorData) {
      const s = msg.sensorData;
      const pos = s.position;
      return {
        messageType: 'sensorData',
        botId: s.botId,
        position: pos ? `${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)}` : undefined,
        health: s.health?.health,
        food: s.health?.food,
        inventorySlots: s.inventory?.slots?.length,
        nearbyPlayers: s.nearbyPlayers?.length,
        pathState: s.pathStatus?.state,
        isMoving: s.pathStatus?.isMoving,
        isMining: s.pathStatus?.isMining,
      };
    }
    if (msg.actionEvent) {
      const e = msg.actionEvent;
      return {
        messageType: 'actionEvent',
        actionId: e.actionId,
        eventType: e.eventType,
        result: e.result,
        error: e.errorMessage || undefined,
      };
    }
    if (msg.connectEvent) {
      const c = msg.connectEvent;
      const pos = c.initialSensorData?.position;
      return {
        messageType: 'connectEvent',
        botId: c.initialSensorData?.botId,
        position: pos ? `${Math.round(pos.x)},${Math.round(pos.y)},${Math.round(pos.z)}` : undefined,
      };
    }
    if (msg.chatMessage) {
      return {
        messageType: 'chatMessage',
        sender: msg.chatMessage.sender,
        message: msg.chatMessage.message,
      };
    }
    return { messageType: 'unknown' };
  }

  private describeAction(action: any): Record<string, unknown> {
    const base: Record<string, unknown> = {
      actionId: action.actionId,
      actionType: action.type,
    };

    if (action.moveTo) {
      const m = action.moveTo;
      base.target = `${m.x},${m.y},${m.z}`;
      base.canDig = m.locomotion?.canDig;
    } else if (action.mineBlock) {
      const m = action.mineBlock;
      base.target = `${m.x},${m.y},${m.z}`;
    } else if (action.depositItems) {
      const d = action.depositItems;
      base.chest = `${d.chestX},${d.chestY},${d.chestZ}`;
      base.items = d.itemNames?.length ? d.itemNames : 'all';
    } else if (action.withdrawItems) {
      const w = action.withdrawItems;
      base.chest = `${w.chestX},${w.chestY},${w.chestZ}`;
      base.items = w.itemNames?.length ? w.itemNames : 'all';
      base.count = w.count || 'all';
    } else if (action.speak) {
      base.message = action.speak.message;
    } else if (action.idle) {
      base.durationMs = action.idle.durationMs;
    } else if (action.cancel) {
      base.targetActionId = action.cancel.targetActionId;
    }

    return base;
  }

  stop(): void {
    this.server.tryShutdown(() => {
      logger.info('Supervisor server stopped');
    });
  }
}

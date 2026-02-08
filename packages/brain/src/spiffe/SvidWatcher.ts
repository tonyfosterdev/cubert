import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { EventEmitter } from 'events';
import { SvidData } from './types';
import path from 'path';

const WORKLOAD_PROTO_PATH = process.env.WORKLOAD_PROTO_PATH ||
  path.resolve(__dirname, '../../../../../proto/workload.proto');

const MAX_RETRY_DELAY_MS = 30000;
const INITIAL_RETRY_DELAY_MS = 1000;

/**
 * Connects to the SPIRE agent's Workload API via Unix socket.
 * Streams X.509 SVIDs and emits 'svid' on initial fetch and 'rotated' on rotation.
 */
export class SvidWatcher extends EventEmitter {
  private agentSocket: string;
  private svid: SvidData | null = null;
  private stream: grpc.ClientReadableStream<any> | null = null;
  private retryDelay = INITIAL_RETRY_DELAY_MS;
  private stopped = false;

  constructor(agentSocket: string) {
    super();
    this.agentSocket = agentSocket;
  }

  /**
   * Start watching for SVIDs. Resolves when the first SVID is received.
   */
  async start(): Promise<SvidData> {
    return new Promise((resolve, reject) => {
      let resolved = false;

      const onFirstSvid = (svid: SvidData) => {
        if (!resolved) {
          resolved = true;
          resolve(svid);
        }
      };

      const onError = (err: Error) => {
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      };

      this.once('svid', onFirstSvid);
      this.once('error', onError);
      this.connect();
    });
  }

  private connect(): void {
    if (this.stopped) return;

    const packageDefinition = protoLoader.loadSync(WORKLOAD_PROTO_PATH, {
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });

    const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any;
    const WorkloadAPI = protoDescriptor.SpiffeWorkloadAPI;

    const client = new WorkloadAPI(
      this.agentSocket,
      grpc.credentials.createInsecure()
    );

    // SPIFFE Workload API requires this metadata header
    const metadata = new grpc.Metadata();
    metadata.add('workload.spiffe.io', 'true');

    // proto-loader generates method as FetchX509SVID (original casing)
    this.stream = client.FetchX509SVID({}, metadata);

    this.stream!.on('data', (response: any) => {
      if (!response.svids || response.svids.length === 0) {
        this.emit('error', new Error('No SVIDs in response'));
        return;
      }

      const rawSvid = response.svids[0];
      const svid: SvidData = {
        spiffeId: rawSvid.spiffeId,
        certificate: Buffer.isBuffer(rawSvid.x509Svid) ? rawSvid.x509Svid : Buffer.from(rawSvid.x509Svid),
        privateKey: Buffer.isBuffer(rawSvid.x509SvidKey) ? rawSvid.x509SvidKey : Buffer.from(rawSvid.x509SvidKey),
        bundle: Buffer.isBuffer(rawSvid.bundle) ? rawSvid.bundle : Buffer.from(rawSvid.bundle),
      };

      const isFirst = this.svid === null;
      this.svid = svid;
      this.retryDelay = INITIAL_RETRY_DELAY_MS;

      if (isFirst) {
        this.emit('svid', svid);
      } else {
        this.emit('rotated', svid);
      }
    });

    this.stream!.on('error', (err: Error) => {
      if (this.stopped) return;
      this.emit('error', err);
      this.scheduleReconnect();
    });

    this.stream!.on('end', () => {
      if (this.stopped) return;
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;

    setTimeout(() => {
      this.connect();
    }, this.retryDelay);

    this.retryDelay = Math.min(this.retryDelay * 1.5, MAX_RETRY_DELAY_MS);
  }

  getSvid(): SvidData | null {
    return this.svid;
  }

  stop(): void {
    this.stopped = true;
    if (this.stream) {
      this.stream.cancel();
      this.stream = null;
    }
  }
}

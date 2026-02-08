import logger from '../logger';

// opentimestamps has no type declarations
// eslint-disable-next-line @typescript-eslint/no-require-imports
const OpenTimestamps = require('opentimestamps');

export interface OtsVerified {
  status: 'verified';
  bitcoinHeight: number;
  bitcoinTimestamp: string;
  explorerUrl: string;
}

export interface OtsPending {
  status: 'pending';
}

export type OtsResult = OtsVerified | OtsPending;

export class TimestampService {
  private calendars: string[];

  constructor(calendars: string[]) {
    this.calendars = calendars;
  }

  /**
   * Submit a Merkle root to OTS calendar servers.
   * Returns serialized .ots proof bytes, or null on failure.
   */
  async stamp(merkleRootHex: string): Promise<Buffer | null> {
    try {
      const hashBytes = Buffer.from(merkleRootHex, 'hex');
      const detached = OpenTimestamps.DetachedTimestampFile.fromBytes(
        new OpenTimestamps.Ops.OpSHA256(),
        hashBytes,
      );

      await OpenTimestamps.stamp(detached, { calendars: this.calendars });

      const otsBytes = Buffer.from(detached.serializeToBytes());
      logger.info({ merkleRoot: merkleRootHex }, 'OTS stamp created');
      return otsBytes;
    } catch (err) {
      logger.warn({ err, merkleRoot: merkleRootHex }, 'OTS stamp failed (calendar error)');
      return null;
    }
  }

  /**
   * Attempt to upgrade a pending proof and inspect the result.
   * Returns { upgraded, bytes, result } where result is either pending or verified.
   */
  async upgradeAndVerify(
    otsBytes: Buffer,
    merkleRootHex: string,
  ): Promise<{ upgraded: boolean; bytes: Buffer; result: OtsResult }> {
    try {
      const detachedOts = OpenTimestamps.DetachedTimestampFile.deserialize(
        new Uint8Array(otsBytes),
      );

      const changed: boolean = await OpenTimestamps.upgrade(detachedOts, {
        calendars: this.calendars,
      });

      const newBytes = Buffer.from(detachedOts.serializeToBytes());

      // Build the original hash file for verify()
      const hashBytes = Buffer.from(merkleRootHex, 'hex');
      const detachedOriginal = OpenTimestamps.DetachedTimestampFile.fromBytes(
        new OpenTimestamps.Ops.OpSHA256(),
        hashBytes,
      );

      // verify() returns a map like { bitcoin: { timestamp, height } }
      const verifyResult = await OpenTimestamps.verify(detachedOts, detachedOriginal, {
        ignoreBitcoinNode: true,
      });

      if (verifyResult && verifyResult.bitcoin) {
        const { height, timestamp } = verifyResult.bitcoin;
        return {
          upgraded: changed,
          bytes: newBytes,
          result: {
            status: 'verified',
            bitcoinHeight: height,
            bitcoinTimestamp: new Date(timestamp * 1000).toISOString(),
            explorerUrl: `https://blockstream.info/block-height/${height}`,
          },
        };
      }

      return {
        upgraded: changed,
        bytes: newBytes,
        result: { status: 'pending' },
      };
    } catch (err) {
      logger.debug({ err }, 'OTS upgradeAndVerify: not yet confirmed');
      return {
        upgraded: false,
        bytes: otsBytes,
        result: { status: 'pending' },
      };
    }
  }
}

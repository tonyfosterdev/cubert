import * as grpc from '@grpc/grpc-js';
import * as tls from 'tls';
import { SvidData } from './types';

/**
 * Convert a single DER-encoded certificate/key to PEM format.
 */
function singleDerToPem(der: Buffer, type: string): string {
  const b64 = der.toString('base64');
  const lines = b64.match(/.{1,64}/g) || [];
  return `-----BEGIN ${type}-----\n${lines.join('\n')}\n-----END ${type}-----\n`;
}

/**
 * Split concatenated DER-encoded certificates into individual PEM blocks.
 * ASN.1 DER certificates start with a SEQUENCE tag (0x30) followed by length.
 */
function derChainToPem(der: Buffer, type: string): string {
  const pems: string[] = [];
  let offset = 0;

  while (offset < der.length) {
    if (der[offset] !== 0x30) {
      // Not a valid ASN.1 SEQUENCE; treat remaining as single block
      pems.push(singleDerToPem(der.subarray(offset), type));
      break;
    }

    // Parse ASN.1 length
    let lengthByte = der[offset + 1];
    let headerLen: number;
    let dataLen: number;

    if (lengthByte < 0x80) {
      // Short form
      headerLen = 2;
      dataLen = lengthByte;
    } else {
      // Long form: number of length bytes
      const numLenBytes = lengthByte & 0x7f;
      headerLen = 2 + numLenBytes;
      dataLen = 0;
      for (let i = 0; i < numLenBytes; i++) {
        dataLen = (dataLen << 8) | der[offset + 2 + i];
      }
    }

    const totalLen = headerLen + dataLen;
    const certDer = der.subarray(offset, offset + totalLen);
    pems.push(singleDerToPem(certDer, type));
    offset += totalLen;
  }

  return pems.join('');
}

/**
 * Custom server identity check for SPIFFE mTLS.
 * SPIFFE SVIDs use URI SANs (spiffe://...) instead of DNS names,
 * so the default hostname check fails. We skip hostname verification
 * and rely on the CA trust chain + application-level SPIFFE ID validation.
 */
function spiffeCheckServerIdentity(_hostname: string, _cert: tls.PeerCertificate): Error | undefined {
  // Trust is established by the CA chain (SPIRE trust bundle).
  // SPIFFE ID validation happens at the application layer.
  return undefined;
}

/**
 * Create mTLS server credentials from an SVID.
 * Requires client certificates and validates them against the trust bundle.
 */
export function createServerCredentials(svid: SvidData): grpc.ServerCredentials {
  const certPem = Buffer.from(derChainToPem(svid.certificate, 'CERTIFICATE'));
  const keyPem = Buffer.from(singleDerToPem(svid.privateKey, 'PRIVATE KEY'));
  const bundlePem = Buffer.from(derChainToPem(svid.bundle, 'CERTIFICATE'));

  return grpc.ServerCredentials.createSsl(
    bundlePem,
    [{
      cert_chain: certPem,
      private_key: keyPem,
    }],
    true
  );
}

/**
 * Create mTLS client credentials from an SVID.
 * Presents client certificate and validates server against trust bundle.
 * Uses custom identity check for SPIFFE URI SANs.
 */
export function createClientCredentials(svid: SvidData): grpc.ChannelCredentials {
  const certPem = Buffer.from(derChainToPem(svid.certificate, 'CERTIFICATE'));
  const keyPem = Buffer.from(singleDerToPem(svid.privateKey, 'PRIVATE KEY'));
  const bundlePem = Buffer.from(derChainToPem(svid.bundle, 'CERTIFICATE'));

  return grpc.credentials.createSsl(
    bundlePem,
    keyPem,
    certPem,
    { checkServerIdentity: spiffeCheckServerIdentity }
  );
}

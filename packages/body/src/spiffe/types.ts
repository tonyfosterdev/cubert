export interface SvidData {
  spiffeId: string;
  certificate: Buffer;  // DER-encoded X.509 cert chain
  privateKey: Buffer;    // DER-encoded PKCS#8 private key
  bundle: Buffer;        // DER-encoded trust bundle (CA certs)
}

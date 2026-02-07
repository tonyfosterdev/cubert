export interface MerkleProof {
  leaf: string;
  leafIndex: number;
  siblings: Array<{
    hash: string;
    position: 'left' | 'right';
  }>;
  root: string;
}

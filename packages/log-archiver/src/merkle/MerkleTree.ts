import { createHash } from 'crypto';
import { MerkleProof } from './types';

export class MerkleTree {
  private levels: Buffer[][];

  constructor(leaves: Buffer[]) {
    if (leaves.length === 0) {
      throw new Error('Cannot build Merkle tree with zero leaves');
    }

    this.levels = [leaves];
    let current = leaves;

    while (current.length > 1) {
      const next: Buffer[] = [];
      for (let i = 0; i < current.length; i += 2) {
        const left = current[i];
        const right = i + 1 < current.length ? current[i + 1] : current[i]; // duplicate odd leaf
        next.push(MerkleTree.hashPair(left, right));
      }
      this.levels.push(next);
      current = next;
    }
  }

  get root(): Buffer {
    return this.levels[this.levels.length - 1][0];
  }

  get rootHex(): string {
    return this.root.toString('hex');
  }

  get leafCount(): number {
    return this.levels[0].length;
  }

  getProof(leafIndex: number): MerkleProof {
    if (leafIndex < 0 || leafIndex >= this.levels[0].length) {
      throw new Error(`Leaf index ${leafIndex} out of range [0, ${this.levels[0].length - 1}]`);
    }

    const siblings: MerkleProof['siblings'] = [];
    let idx = leafIndex;

    for (let level = 0; level < this.levels.length - 1; level++) {
      const layer = this.levels[level];
      const isLeft = idx % 2 === 0;
      const siblingIdx = isLeft ? idx + 1 : idx - 1;

      // For odd-length layers, if we're the last element and it's odd, sibling is self
      const sibling = siblingIdx < layer.length ? layer[siblingIdx] : layer[idx];

      siblings.push({
        hash: sibling.toString('hex'),
        position: isLeft ? 'right' : 'left',
      });

      idx = Math.floor(idx / 2);
    }

    return {
      leaf: this.levels[0][leafIndex].toString('hex'),
      leafIndex,
      siblings,
      root: this.rootHex,
    };
  }

  static hashLeaf(data: string | Buffer): Buffer {
    return createHash('sha256').update(data).digest();
  }

  static hashPair(left: Buffer, right: Buffer): Buffer {
    return createHash('sha256').update(Buffer.concat([left, right])).digest();
  }

  static verify(leaf: Buffer, proof: MerkleProof, root: Buffer): boolean {
    let current = leaf;

    for (const sibling of proof.siblings) {
      const siblingBuf = Buffer.from(sibling.hash, 'hex');
      if (sibling.position === 'right') {
        current = MerkleTree.hashPair(current, siblingBuf);
      } else {
        current = MerkleTree.hashPair(siblingBuf, current);
      }
    }

    return current.equals(root);
  }
}

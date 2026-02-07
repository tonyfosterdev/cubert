import { promises as fs } from 'fs';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import path from 'path';
import { MerkleTree } from '../merkle/MerkleTree';
import { Manifest } from '../manifest/Manifest';
import logger from '../logger';

export class BatchProcessor {
  constructor(private manifest: Manifest) {}

  async process(filePath: string): Promise<void> {
    const filename = path.basename(filePath);

    if (await this.manifest.hasEntry(filename)) {
      logger.debug({ filename }, 'Already processed, skipping');
      return;
    }

    logger.info({ filename }, 'Processing log batch');

    // Read lines and compute leaf hashes
    const leafHashes: Buffer[] = [];
    const rl = createInterface({
      input: createReadStream(filePath, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (line.trim().length === 0) continue;
      leafHashes.push(MerkleTree.hashLeaf(line));
    }

    if (leafHashes.length === 0) {
      logger.warn({ filename }, 'Empty log file, skipping');
      return;
    }

    // Build Merkle tree
    const tree = new MerkleTree(leafHashes);

    // Save .tree file (one hex hash per line)
    const treeFilename = filename + '.tree';
    const treePath = path.join(path.dirname(filePath), treeFilename);
    const treeContent = leafHashes.map((h) => h.toString('hex')).join('\n') + '\n';
    await fs.writeFile(treePath, treeContent, 'utf-8');

    // Get file stats
    const stats = await fs.stat(filePath);

    // Add manifest entry
    await this.manifest.addEntry({
      filename,
      merkleRoot: tree.rootHex,
      leafCount: leafHashes.length,
      fileSize: stats.size,
      processedAt: new Date().toISOString(),
      treeFilename,
    });

    logger.info(
      { filename, merkleRoot: tree.rootHex, leafCount: leafHashes.length },
      'Batch processed successfully',
    );
  }
}

import { Router } from 'express';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { promises as fs } from 'fs';
import path from 'path';
import { MerkleTree } from '../../merkle/MerkleTree';
import { Manifest } from '../../manifest/Manifest';

export function verifyRouter(logDir: string, manifest: Manifest): Router {
  const router = Router();

  router.get('/api/batches/:filename/verify/:lineNum', async (req, res) => {
    try {
      const { filename } = req.params;
      const lineNum = parseInt(req.params.lineNum, 10);

      // Validate filename to prevent path traversal
      if (filename.includes('/') || filename.includes('..')) {
        res.status(400).json({ error: 'Invalid filename' });
        return;
      }

      if (isNaN(lineNum) || lineNum < 0) {
        res.status(400).json({ error: 'Invalid line number' });
        return;
      }

      // Load manifest to get stored Merkle root
      const entries = await manifest.load();
      const entry = entries.find((e) => e.filename === filename);
      if (!entry) {
        res.status(404).json({ error: 'Batch not found in manifest' });
        return;
      }

      // Read the specific log line
      const logPath = path.join(logDir, filename);
      let targetLine: string | null = null;
      const rl = createInterface({
        input: createReadStream(logPath, { encoding: 'utf-8' }),
        crlfDelay: Infinity,
      });

      let currentLine = 0;
      for await (const line of rl) {
        if (line.trim().length === 0) continue;
        if (currentLine === lineNum) {
          targetLine = line;
          break;
        }
        currentLine++;
      }

      if (targetLine === null) {
        res.status(404).json({ error: `Line ${lineNum} not found` });
        return;
      }

      // Read .tree file to get all leaf hashes
      const treePath = path.join(logDir, entry.treeFilename);
      const treeContent = await fs.readFile(treePath, 'utf-8');
      const leafHexes = treeContent.trim().split('\n');
      const leafHashes = leafHexes.map((hex) => Buffer.from(hex, 'hex'));

      // Rebuild Merkle tree and get proof
      const tree = new MerkleTree(leafHashes);
      const proof = tree.getProof(lineNum);

      // Verify
      const leafHash = MerkleTree.hashLeaf(targetLine);
      const rootBuf = Buffer.from(entry.merkleRoot, 'hex');
      const valid = MerkleTree.verify(leafHash, proof, rootBuf);

      res.json({
        logEntry: targetLine,
        leafHash: leafHash.toString('hex'),
        proof,
        storedMerkleRoot: entry.merkleRoot,
        computedMerkleRoot: proof.root,
        valid,
      });
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        res.status(404).json({ error: 'File not found' });
        return;
      }
      res.status(500).json({ error: 'Verification failed' });
    }
  });

  return router;
}

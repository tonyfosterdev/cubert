import { Router } from 'express';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { promises as fs } from 'fs';
import path from 'path';
import { MerkleTree } from '../../merkle/MerkleTree';
import { Manifest } from '../../manifest/Manifest';
import { TimestampService } from '../../ots/TimestampService';

export function verifyRouter(logDir: string, manifest: Manifest, timestampService?: TimestampService): Router {
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

      // Check OTS status
      let ots: any = null;
      if (timestampService) {
        const otsPath = path.join(logDir, filename + '.ots');
        try {
          const otsBytes = await fs.readFile(otsPath);
          const { upgraded, bytes, result } = await timestampService.upgradeAndVerify(
            otsBytes,
            entry.merkleRoot,
          );
          // If upgrade succeeded, persist the updated proof
          if (upgraded) {
            await fs.writeFile(otsPath, bytes);
          }
          ots = result;
        } catch {
          // No .ots file or read error — leave ots as null
        }
      }

      res.json({
        logEntry: targetLine,
        leafHash: leafHash.toString('hex'),
        proof,
        storedMerkleRoot: entry.merkleRoot,
        computedMerkleRoot: proof.root,
        valid,
        ots,
      });
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        res.status(404).json({ error: 'File not found' });
        return;
      }
      res.status(500).json({ error: 'Verification failed' });
    }
  });

  router.get('/api/batches/:filename/ots-info', async (req, res) => {
    try {
      const { filename } = req.params;

      if (filename.includes('/') || filename.includes('..')) {
        res.status(400).json({ error: 'Invalid filename' });
        return;
      }

      const otsPath = path.join(logDir, filename + '.ots');
      let otsBytes: Buffer;
      try {
        otsBytes = await fs.readFile(otsPath);
      } catch {
        res.status(404).json({ error: 'No .ots file found' });
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const OpenTimestamps = require('opentimestamps');
      const detached = OpenTimestamps.DetachedTimestampFile.deserialize(
        new Uint8Array(otsBytes),
      );
      const infoText: string = OpenTimestamps.info(detached);

      // Parse the info text into structured steps
      const lines = infoText.split('\n');
      let fileHash = '';
      const steps: Array<{ type: string; detail: string; indent: number; path?: number }> = [];
      let currentPath = 0;

      for (const line of lines) {
        const trimmed = line.trimStart();
        const indent = line.length - trimmed.length;

        // File hash header
        const hashMatch = trimmed.match(/^File sha256 hash:\s*(.+)/);
        if (hashMatch) {
          fileHash = hashMatch[1];
          continue;
        }

        if (trimmed === 'Timestamp:' || trimmed === '') continue;

        // Fork arrow: " -> operation"
        const arrowMatch = trimmed.match(/^->\s*(.*)/);
        if (arrowMatch) {
          currentPath++;
          const op = arrowMatch[1];
          const parsed = parseOp(op);
          steps.push({ ...parsed, indent, path: currentPath });
          continue;
        }

        const parsed = parseOp(trimmed);
        if (parsed.type !== 'unknown') {
          steps.push({ ...parsed, indent, path: currentPath || undefined });
        }
      }

      res.json({ fileHash, steps });
    } catch (err: any) {
      res.status(500).json({ error: 'Failed to read OTS info' });
    }
  });

  return router;
}

function parseOp(op: string): { type: string; detail: string } {
  if (op.startsWith('append ')) return { type: 'append', detail: op.substring(7) };
  if (op.startsWith('prepend ')) return { type: 'prepend', detail: op.substring(8) };
  if (op === 'sha256') return { type: 'sha256', detail: '' };
  if (op === 'ripemd160') return { type: 'ripemd160', detail: '' };
  if (op === 'sha1') return { type: 'sha1', detail: '' };

  const pendingMatch = op.match(/^verify PendingAttestation\('(.+)'\)/);
  if (pendingMatch) return { type: 'pending', detail: pendingMatch[1] };

  const bitcoinMatch = op.match(/^verify BitcoinBlockHeaderAttestation\((\d+)\)/);
  if (bitcoinMatch) return { type: 'bitcoin', detail: bitcoinMatch[1] };

  return { type: 'unknown', detail: op };
}

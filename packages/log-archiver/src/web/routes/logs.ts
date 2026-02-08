import { Router } from 'express';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import path from 'path';
import { MerkleTree } from '../../merkle/MerkleTree';

export function logsRouter(logDir: string): Router {
  const router = Router();

  router.get('/api/batches/:filename/lines', async (req, res) => {
    try {
      const { filename } = req.params;

      // Validate filename to prevent path traversal
      if (filename.includes('/') || filename.includes('..')) {
        res.status(400).json({ error: 'Invalid filename' });
        return;
      }

      const offset = parseInt(req.query.offset as string || '0', 10);
      const limit = parseInt(req.query.limit as string || '100', 10);

      const filePath = path.join(logDir, filename);
      const lines: Array<{ lineNum: number; content: string; leafHash: string }> = [];

      const rl = createInterface({
        input: createReadStream(filePath, { encoding: 'utf-8' }),
        crlfDelay: Infinity,
      });

      let lineNum = 0;
      for await (const line of rl) {
        if (line.trim().length === 0) continue;

        if (lineNum >= offset && lineNum < offset + limit) {
          const hash = MerkleTree.hashLeaf(line);
          lines.push({
            lineNum,
            content: line,
            leafHash: hash.toString('hex'),
          });
        }

        lineNum++;
        if (lineNum >= offset + limit) break;
      }

      res.json({ lines, total: lineNum >= offset + limit ? undefined : lineNum });
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        res.status(404).json({ error: 'Log file not found' });
        return;
      }
      res.status(500).json({ error: 'Failed to read log file' });
    }
  });

  return router;
}

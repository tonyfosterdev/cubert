import { Router } from 'express';
import path from 'path';
import { Manifest } from '../../manifest/Manifest';

export function downloadRouter(logDir: string, manifest: Manifest): Router {
  const router = Router();

  // Serve raw 32-byte Merkle root (for use with opentimestamps.org verifier)
  router.get('/api/download/:basename.root', async (req, res) => {
    const { basename } = req.params;

    if (basename.includes('/') || basename.includes('..')) {
      res.status(400).json({ error: 'Invalid filename' });
      return;
    }

    try {
      const entries = await manifest.load();
      const entry = entries.find((e) => e.filename === basename);
      if (!entry) {
        res.status(404).json({ error: 'Batch not found' });
        return;
      }

      const rootBytes = Buffer.from(entry.merkleRoot, 'hex');
      res.set('Content-Type', 'application/octet-stream');
      res.set('Content-Disposition', `attachment; filename="${basename}.root"`);
      res.send(rootBytes);
    } catch {
      res.status(500).json({ error: 'Failed to read manifest' });
    }
  });

  router.get('/api/download/:filename', (req, res) => {
    const { filename } = req.params;

    if (filename.includes('/') || filename.includes('..')) {
      res.status(400).json({ error: 'Invalid filename' });
      return;
    }

    const filePath = path.join(logDir, filename);
    res.download(filePath, filename, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ error: 'File not found' });
      }
    });
  });

  return router;
}

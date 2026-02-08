import { Router } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { Manifest } from '../../manifest/Manifest';

export function batchesRouter(logDir: string, manifest: Manifest): Router {
  const router = Router();

  router.get('/api/batches', async (_req, res) => {
    try {
      const entries = await manifest.load();
      // Newest first
      entries.sort((a, b) => new Date(b.processedAt).getTime() - new Date(a.processedAt).getTime());

      // Check which batches have .ots files
      const enriched = await Promise.all(
        entries.map(async (e) => {
          const otsPath = path.join(logDir, e.filename + '.ots');
          let otsAvailable = false;
          try {
            await fs.access(otsPath);
            otsAvailable = true;
          } catch {
            // file doesn't exist
          }
          return { ...e, otsAvailable };
        }),
      );

      res.json(enriched);
    } catch (err) {
      res.status(500).json({ error: 'Failed to load manifest' });
    }
  });

  return router;
}

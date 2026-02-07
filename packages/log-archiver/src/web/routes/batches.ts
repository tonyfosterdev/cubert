import { Router } from 'express';
import { Manifest } from '../../manifest/Manifest';

export function batchesRouter(manifest: Manifest): Router {
  const router = Router();

  router.get('/api/batches', async (_req, res) => {
    try {
      const entries = await manifest.load();
      // Newest first
      entries.sort((a, b) => new Date(b.processedAt).getTime() - new Date(a.processedAt).getTime());
      res.json(entries);
    } catch (err) {
      res.status(500).json({ error: 'Failed to load manifest' });
    }
  });

  return router;
}

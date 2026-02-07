import { Router } from 'express';
import path from 'path';

export function downloadRouter(logDir: string): Router {
  const router = Router();

  router.get('/api/download/log/:filename', (req, res) => {
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

  router.get('/api/download/tree/:filename', (req, res) => {
    const { filename } = req.params;

    if (filename.includes('/') || filename.includes('..')) {
      res.status(400).json({ error: 'Invalid filename' });
      return;
    }

    const treeFilename = filename.endsWith('.tree') ? filename : filename + '.tree';
    const filePath = path.join(logDir, treeFilename);
    res.download(filePath, treeFilename, (err) => {
      if (err && !res.headersSent) {
        res.status(404).json({ error: 'File not found' });
      }
    });
  });

  return router;
}

import express from 'express';
import path from 'path';
import { Manifest } from '../manifest/Manifest';
import { TimestampService } from '../ots/TimestampService';
import healthRouter from './routes/health';
import { batchesRouter } from './routes/batches';
import { logsRouter } from './routes/logs';
import { verifyRouter } from './routes/verify';
import { downloadRouter } from './routes/download';
import logger from '../logger';

export function createServer(logDir: string, manifest: Manifest, timestampService?: TimestampService) {
  const app = express();

  // Serve static UI files
  app.use(express.static(path.join(__dirname, 'views')));

  // API routes
  app.use(healthRouter);
  app.use(batchesRouter(logDir, manifest));
  app.use(logsRouter(logDir));
  app.use(verifyRouter(logDir, manifest, timestampService));
  app.use(downloadRouter(logDir, manifest));

  return app;
}

export function startServer(logDir: string, manifest: Manifest, port: number, timestampService?: TimestampService) {
  const app = createServer(logDir, manifest, timestampService);

  app.listen(port, () => {
    logger.info({ port }, 'Web server started');
  });

  return app;
}

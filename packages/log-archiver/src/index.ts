import { config } from './config';
import { FileWatcher } from './watcher/FileWatcher';
import { TimestampService } from './ots/TimestampService';
import { startServer } from './web/server';
import logger from './logger';

async function main() {
  logger.info({ logDir: config.logDir, webPort: config.webPort }, 'Starting log archiver');

  const timestampService = new TimestampService(config.otsCalendars);
  const watcher = new FileWatcher(config.logDir, timestampService);
  await watcher.start();

  startServer(config.logDir, watcher.getManifest(), config.webPort, timestampService);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    await watcher.stop();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start log archiver');
  process.exit(1);
});

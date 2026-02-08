import { defaultConfig } from './config';
import { SvidWatcher } from './spiffe/SvidWatcher';
import { SupervisorServer } from './grpc/server';
import { startMetricsServer } from './metrics';
import { logger } from './logger';

async function main() {
  logger.info('Cubert Supervisor starting...');
  logger.info({
    port: defaultConfig.port,
    agentSocket: defaultConfig.spiffe.agentSocket,
    expectedBody: defaultConfig.spiffe.expectedBodyId,
    expectedBrain: defaultConfig.spiffe.expectedBrainId,
  }, 'Configuration');

  // Start metrics server
  startMetricsServer(defaultConfig.metricsPort);

  // Start SVID watcher - blocks until first SVID is received
  logger.info('Waiting for SVID from SPIRE agent...');
  const svidWatcher = new SvidWatcher(defaultConfig.spiffe.agentSocket);

  svidWatcher.on('error', (err) => {
    logger.error({ err }, 'SvidWatcher error');
  });

  svidWatcher.on('rotated', (svid) => {
    logger.info({ spiffeId: svid.spiffeId }, 'SVID rotated');
  });

  const svid = await svidWatcher.start();
  logger.info({ spiffeId: svid.spiffeId }, 'Got initial SVID');

  // Create and start gRPC server with mTLS
  const server = new SupervisorServer(defaultConfig, svidWatcher);

  try {
    await server.start();
    logger.info('Cubert Supervisor ready!');
  } catch (err) {
    logger.fatal({ err }, 'Failed to start supervisor server');
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down...');
    svidWatcher.stop();
    server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal error');
  process.exit(1);
});

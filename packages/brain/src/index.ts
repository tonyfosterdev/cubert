import { defaultConfig } from './config';
import { BrainServer } from './grpc/server';
import { ThoughtBrain } from './brains';
import { startMetricsServer } from './metrics';
import { logger } from './logger';

async function main() {
  logger.info('Cubert Brain starting...');
  logger.info({ scenario: defaultConfig.scenario }, 'Scenario');

  // Start metrics server
  startMetricsServer(9092);

  if (defaultConfig.scenario !== 'thought' && defaultConfig.scenario !== 'semi-autonomous') {
    logger.fatal({ scenario: defaultConfig.scenario }, 'Unknown scenario');
    process.exit(1);
  }

  const brainImpl = new ThoughtBrain({
    llm: defaultConfig.llm,
  });
  logger.info({ model: defaultConfig.llm.model }, 'LLM Model');

  // Create and start gRPC server
  const server = new BrainServer(defaultConfig, brainImpl);

  try {
    await server.start();
    logger.info('Cubert Brain ready!');
  } catch (err) {
    logger.fatal({ err }, 'Failed to start brain server');
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down...');
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

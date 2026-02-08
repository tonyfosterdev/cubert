import { defaultConfig } from './config';
import { BrainServer } from './grpc/server';
import { BrainSupervisorClient } from './grpc/supervisorClient';
import { ThoughtBrain } from './brains';
import { SvidWatcher } from './spiffe/SvidWatcher';
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

  if (defaultConfig.supervisor && defaultConfig.spiffe) {
    // Supervisor mode: connect to supervisor via mTLS
    logger.info(
      { supervisorHost: defaultConfig.supervisor.host, supervisorPort: defaultConfig.supervisor.port },
      'Starting in SUPERVISOR mode'
    );

    const svidWatcher = new SvidWatcher(defaultConfig.spiffe.agentSocket);
    svidWatcher.on('error', (err) => {
      logger.error({ err }, 'SvidWatcher error');
    });

    logger.info('Waiting for SVID from SPIRE agent...');
    const svid = await svidWatcher.start();
    logger.info({ spiffeId: svid.spiffeId }, 'Got initial SVID');

    const supervisorClient = new BrainSupervisorClient(defaultConfig, brainImpl, svidWatcher);

    try {
      await supervisorClient.connect();
      logger.info('Cubert Brain ready (supervisor mode)!');
    } catch (err) {
      logger.warn('Initial supervisor connection failed, will retry...');
    }

    // Graceful shutdown
    const shutdown = () => {
      logger.info('Shutting down...');
      supervisorClient.disconnect();
      svidWatcher.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } else {
    // Direct mode: act as gRPC server (existing behavior)
    logger.info('Starting in DIRECT mode');

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
}

main().catch((err) => {
  logger.fatal({ err }, 'Fatal error');
  process.exit(1);
});

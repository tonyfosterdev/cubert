import { defaultConfig } from './config';
import { BrainServer } from './grpc/server';
import { ThoughtBrain } from './brains';
import { startMetricsServer } from './metrics';

async function main() {
  console.log('Cubert Brain starting...');
  console.log(`Scenario: ${defaultConfig.scenario}`);

  // Start metrics server
  startMetricsServer(9092);

  if (defaultConfig.scenario !== 'thought' && defaultConfig.scenario !== 'semi-autonomous') {
    console.error(`Unknown scenario: ${defaultConfig.scenario}`);
    process.exit(1);
  }

  const brainImpl = new ThoughtBrain({
    llm: defaultConfig.llm,
  });
  console.log(`LLM Model: ${defaultConfig.llm.model}`);

  // Create and start gRPC server
  const server = new BrainServer(defaultConfig, brainImpl);

  try {
    await server.start();
    console.log('Cubert Brain ready!');
  } catch (err) {
    console.error('Failed to start brain server:', err);
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = () => {
    console.log('Shutting down...');
    server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

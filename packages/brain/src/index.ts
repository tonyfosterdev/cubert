import { defaultConfig } from './config';
import { BrainServer } from './grpc/server';
import { createGoldMiningStateMachine } from './state-machine/scenarios/gold-mining';

async function main() {
  console.log('Cubert Brain starting...');
  console.log(`Scenario: ${defaultConfig.scenario}`);

  // Create state machine for the configured scenario
  let stateMachine;

  switch (defaultConfig.scenario) {
    case 'gold-mining':
      stateMachine = createGoldMiningStateMachine();
      break;
    default:
      console.error(`Unknown scenario: ${defaultConfig.scenario}`);
      process.exit(1);
  }

  // Log state changes
  stateMachine.on('stateChange', (newState: string) => {
    console.log(`[State] -> ${newState}`);
  });

  // Create and start gRPC server
  const server = new BrainServer(defaultConfig, stateMachine);

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

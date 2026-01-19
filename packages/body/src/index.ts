import { defaultConfig } from './config';
import { BotManager } from './bot/BotManager';
import { SensorAggregator } from './sensors';
import { ActuatorRegistry } from './actuators';
import { BrainClient } from './grpc/client';

async function main() {
  console.log('Cubert Body starting...');

  const config = defaultConfig;
  const botManager = new BotManager(config);
  const brainClient = new BrainClient(config);

  // Connect to Minecraft
  const bot = await botManager.connect();
  console.log('Connected to Minecraft!');

  // Initialize sensors and actuators
  const sensors = new SensorAggregator(bot, config);
  const actuators = new ActuatorRegistry(bot);

  // Connect to brain
  try {
    await brainClient.connect();
    console.log('Connected to brain!');
  } catch (err) {
    console.warn('Initial brain connection failed, will retry...');
  }

  // Handle incoming actions from brain
  brainClient.on('action', async (action) => {
    try {
      await actuators.execute(action);
    } catch (err) {
      console.error('Failed to execute action:', err);
    }
  });

  // Handle action completion feedback
  actuators.on('actionComplete', (result) => {
    sensors.setActionFeedback({
      actionId: result.actionId,
      result: result.success ? 'ACTION_RESULT_SUCCESS' : 'ACTION_RESULT_FAILED',
      errorMessage: result.errorMessage,
    });
  });

  // Sensor polling loop
  let lastSendTime = 0;

  bot.on('physicsTick', () => {
    const now = Date.now();

    if (now - lastSendTime >= config.sensors.sendIntervalMs) {
      try {
        const sensorData = sensors.collect();
        brainClient.sendSensorData(sensorData);
      } catch (err) {
        console.error('Failed to collect/send sensor data:', err);
      }
      lastSendTime = now;
    }
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('Shutting down...');
    brainClient.disconnect();
    botManager.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('Cubert Body ready!');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

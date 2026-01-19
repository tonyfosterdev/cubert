import { Bot } from 'mineflayer';
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

  let sensors: SensorAggregator | null = null;
  let actuators: ActuatorRegistry | null = null;
  let lastSendTime = 0;

  // Setup bot listeners - called on initial connect and reconnect
  function setupBotListeners(bot: Bot) {
    console.log('[SETUP] Attaching bot listeners');

    // Reinitialize sensors and actuators with new bot
    sensors = new SensorAggregator(bot, config);
    actuators = new ActuatorRegistry(bot);

    // Handle action completion
    actuators.on('actionComplete', (result) => {
      console.log(`[EVENT] Action ${result.actionId} completed: ${result.success ? 'SUCCESS' : 'FAILED'}`);
      // Send fresh sensor data immediately so brain has current inventory
      brainClient.sendSensorData(sensors!.collect());
      brainClient.sendActionEvent({
        actionId: result.actionId,
        result: result.success ? 'ACTION_RESULT_SUCCESS' : 'ACTION_RESULT_FAILED',
        errorMessage: result.errorMessage,
        eventType: 'ACTION_EVENT_COMPLETED',
      });
    });

    // Handle bot respawn (while gRPC is still connected)
    bot.on('spawn', () => {
      if (brainClient.isConnected()) {
        console.log('[SPAWN] Bot respawned, sending connect event');
        actuators?.cancelAll();
        brainClient.sendConnectEvent(sensors!.collect());
      }
    });

    // Sensor polling loop
    bot.on('physicsTick', () => {
      const now = Date.now();
      if (now - lastSendTime >= config.sensors.sendIntervalMs) {
        try {
          if (sensors && brainClient.isConnected()) {
            brainClient.sendSensorData(sensors.collect());
          }
        } catch (err) {
          console.error('Failed to collect/send sensor data:', err);
        }
        lastSendTime = now;
      }
    });

    // Send connect event if brain is already connected
    if (brainClient.isConnected() && sensors) {
      console.log('[SETUP] Brain already connected, sending connect event');
      actuators.cancelAll();
      brainClient.sendConnectEvent(sensors.collect());
    }
  }

  // Listen for bot ready events (initial + reconnects)
  botManager.on('botReady', (bot: Bot) => {
    console.log('[RECONNECT] Bot ready, setting up listeners');
    setupBotListeners(bot);
  });

  // Connect to Minecraft
  const bot = await botManager.connect();
  console.log('Connected to Minecraft!');

  // Handle brain connection/reconnection - reset state
  brainClient.on('connected', () => {
    console.log('[CONNECT] Brain connected, sending connect event');
    actuators?.cancelAll();
    if (sensors) {
      brainClient.sendConnectEvent(sensors.collect());
    }
  });

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
      await actuators?.execute(action);
    } catch (err) {
      console.error('Failed to execute action:', err);
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

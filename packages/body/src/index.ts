import { Bot } from 'mineflayer';
import { defaultConfig } from './config';
import { BotManager } from './bot/BotManager';
import { SensorAggregator } from './sensors';
import { ActuatorRegistry } from './actuators';
import { BrainClient } from './grpc/client';
import { startMetricsServer, botConnected, sensorGathersTotal, goldInventory, actionsTotal } from './metrics';

async function main() {
  console.log('Cubert Body starting...');

  startMetricsServer(9091);

  const config = defaultConfig;
  const botManager = new BotManager(config);
  const brainClient = new BrainClient(config);

  let sensors: SensorAggregator | null = null;
  let actuators: ActuatorRegistry | null = null;
  let lastGatherTime = 0;
  const actionTypes = new Map<string, string>();

  /**
   * Gathers and sends sensor data to the brain with throttling protection.
   *
   * CPU OPTIMIZATION: The expensive operation is sensors.collect(), specifically
   * BlockSensor.read() which calls bot.findBlocks() multiple times. Throttling
   * skips the entire gather operation when data was recently collected.
   *
   * @param force - If true, always gather (used for actionComplete where inventory is critical)
   * @param asConnectEvent - If true, send as ConnectEvent instead of SensorData
   */
  function gatherAndSendSensors(force: boolean = false, asConnectEvent: boolean = false): void {
    if (!sensors || !brainClient.isConnected()) return;

    const now = Date.now();
    const timeSinceLastGather = now - lastGatherTime;

    // Skip expensive sensors.collect() if data was recently gathered (unless forced)
    if (!force && timeSinceLastGather < config.sensors.sendIntervalMs) {
      return;
    }

    // This is the expensive operation - BlockSensor calls bot.findBlocks() multiple times
    const data = sensors.collect();
    sensorGathersTotal.inc();

    // Update gold inventory metric
    const goldSlot = data.inventory.slots.find(s => s.itemName === 'raw_gold');
    goldInventory.set(goldSlot?.count ?? 0);

    if (asConnectEvent) {
      brainClient.sendConnectEvent(data);
    } else {
      brainClient.sendSensorData(data);
    }

    lastGatherTime = now;
  }

  // Setup bot listeners - called on initial connect and reconnect
  function setupBotListeners(bot: Bot) {
    console.log('[SETUP] Attaching bot listeners');

    // Reinitialize sensors and actuators with new bot
    sensors = new SensorAggregator(bot, config);
    actuators = new ActuatorRegistry(bot);

    // Handle action completion
    actuators.on('actionComplete', (result) => {
      console.log(`[EVENT] Action ${result.actionId} completed: ${result.success ? 'SUCCESS' : 'FAILED'}`);

      // Track action metrics
      const actionType = actionTypes.get(result.actionId) ?? 'unknown';
      actionsTotal.inc({ type: actionType, result: result.success ? 'success' : 'failed' });
      actionTypes.delete(result.actionId);

      // Send fresh sensor data immediately so brain has current inventory (forced - CPU cost acceptable)
      gatherAndSendSensors(true);
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
        // Throttled - skip expensive gather if data was recently collected
        gatherAndSendSensors(false, true);
      }
    });

    // Sensor polling loop - throttling handled by gatherAndSendSensors
    bot.on('physicsTick', () => {
      try {
        gatherAndSendSensors();
      } catch (err) {
        console.error('Failed to collect/send sensor data:', err);
      }
    });

    // Send connect event if brain is already connected
    if (brainClient.isConnected()) {
      console.log('[SETUP] Brain already connected, sending connect event');
      actuators.cancelAll();
      // Forced - brain needs initial state on connection
      gatherAndSendSensors(true, true);
    }
  }

  // Listen for bot ready events (initial + reconnects)
  botManager.on('botReady', (bot: Bot) => {
    console.log('[RECONNECT] Bot ready, setting up listeners');
    botConnected.set(1);
    setupBotListeners(bot);
  });

  // Connect to Minecraft
  const bot = await botManager.connect();
  console.log('Connected to Minecraft!');

  // Handle brain connection/reconnection - reset state
  brainClient.on('connected', () => {
    console.log('[CONNECT] Brain connected, sending connect event');
    actuators?.cancelAll();
    // Throttled - skip expensive gather if data was recently collected
    gatherAndSendSensors(false, true);
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
      actionTypes.set(action.actionId, action.type);
      await actuators?.execute(action);
    } catch (err) {
      console.error('Failed to execute action:', err);
    }
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('Shutting down...');
    botConnected.set(0);
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

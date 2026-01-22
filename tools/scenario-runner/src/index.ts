import { Rcon } from 'rcon-client';
import * as fs from 'fs';
import * as path from 'path';

interface ScenarioConfig {
  name: string;
  description: string;
  version: string;
  minecraft: {
    gamemode: string;
    difficulty: string;
    time: number;
    weather: string;
  };
  spawn: {
    x: number;
    y: number;
    z: number;
  };
  setup: {
    commands: string;
  };
  spawner?: {
    commands: string;
    intervalMs: number;
  };
}

function timestamp(): string {
  return new Date().toISOString();
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectWithRetry(
  host: string,
  port: number,
  password: string,
  maxAttempts: number = 30
): Promise<Rcon> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[${timestamp()}] Connecting to RCON (${attempt}/${maxAttempts})...`);
      const rcon = await Rcon.connect({ host, port, password });
      console.log(`[${timestamp()}] RCON connected!`);
      return rcon;
    } catch (err) {
      if (attempt === maxAttempts) {
        throw new Error(`Failed to connect after ${maxAttempts} attempts`);
      }
      await sleep(2000);
    }
  }
  throw new Error('Unreachable');
}

async function executeCommands(rcon: Rcon, commands: string[], quiet = false): Promise<void> {
  for (const command of commands) {
    const trimmed = command.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    try {
      if (!quiet) console.log(`> ${trimmed}`);
      const response = await rcon.send(trimmed);
      if (response && !quiet) {
        console.log(`  ${response}`);
      }
      await sleep(100);
    } catch (err) {
      console.error(`[${timestamp()}] Error executing "${trimmed}": ${err}`);
    }
  }
}

async function ensureBotHasPickaxe(rcon: Rcon, botUsername: string): Promise<void> {
  try {
    // Check bot's inventory for any pickaxe
    const response = await rcon.send(`data get entity ${botUsername} Inventory`);

    // If bot doesn't exist or has no inventory data, skip
    if (!response || response.includes('No entity')) {
      return;
    }

    // Check if any pickaxe is in inventory
    const hasPickaxe = response.includes('pickaxe');

    if (!hasPickaxe) {
      console.log(`[${timestamp()}] Bot has no pickaxe, giving one...`);
      await rcon.send(`give ${botUsername} iron_pickaxe 1`);
    }
  } catch (err) {
    // Silently ignore errors (bot might be dead/respawning)
  }
}

async function main() {
  const scenario = process.env.SCENARIO || 'gold-mining';
  const mcHost = process.env.MC_HOST || 'localhost';
  const rconPort = parseInt(process.env.RCON_PORT || '25575');
  const rconPassword = process.env.RCON_PASSWORD || 'minecraft';
  const botUsername = process.env.BOT_USERNAME || 'Cubert';
  const spawnIntervalOverride = process.env.SPAWN_INTERVAL_MS ? parseInt(process.env.SPAWN_INTERVAL_MS) : null;

  console.log(`[${timestamp()}] === Cubert Scenario Runner ===`);
  console.log(`[${timestamp()}] Scenario: ${scenario}`);
  console.log(`[${timestamp()}] Minecraft: ${mcHost}:${rconPort}`);

  // Find scenario directory
  const scenarioPaths = [
    `/scenarios/${scenario}`,
    path.resolve(__dirname, `../../../scenarios/${scenario}`),
    path.resolve(__dirname, `../../scenarios/${scenario}`),
  ];

  let scenarioDir: string | null = null;
  for (const p of scenarioPaths) {
    if (fs.existsSync(path.join(p, 'scenario.json'))) {
      scenarioDir = p;
      break;
    }
  }

  if (!scenarioDir) {
    console.error(`[${timestamp()}] Scenario config not found. Tried:`);
    scenarioPaths.forEach((p) => console.error(`  - ${path.join(p, 'scenario.json')}`));
    process.exit(1);
  }

  const config: ScenarioConfig = JSON.parse(
    fs.readFileSync(path.join(scenarioDir, 'scenario.json'), 'utf-8')
  );
  console.log(`[${timestamp()}] Loaded: ${config.name} v${config.version}`);

  // Connect to RCON
  let rcon = await connectWithRetry(mcHost, rconPort, rconPassword);

  // Handle disconnection with auto-reconnect
  const setupReconnect = () => {
    rcon.on('end', async () => {
      console.log(`[${timestamp()}] RCON disconnected, reconnecting...`);
      await sleep(2000);
      rcon = await connectWithRetry(mcHost, rconPort, rconPassword);
      setupReconnect();
    });
  };
  setupReconnect();

  // ========== PHASE 1: One-time setup ==========
  console.log(`\n[${timestamp()}] --- Phase 1: World Setup ---`);

  // Game rules
  await executeCommands(rcon, [
    `gamemode ${config.minecraft.gamemode} ${botUsername}`,
    `difficulty ${config.minecraft.difficulty}`,
    `time set ${config.minecraft.time}`,
    `weather ${config.minecraft.weather}`,
    'gamerule doDaylightCycle false',
    'gamerule doWeatherCycle false',
  ]);

  // Setup commands (build arena, place chest, etc.)
  const setupPath = path.join(scenarioDir, config.setup.commands);
  if (fs.existsSync(setupPath)) {
    const setupCommands = fs.readFileSync(setupPath, 'utf-8').split('\n');
    await executeCommands(rcon, setupCommands);
  }

  // Wait for bot to join the game
  console.log(`\n[${timestamp()}] --- Phase 2: Waiting for Bot ---`);
  let botOnline = false;
  for (let attempt = 1; attempt <= 30; attempt++) {
    const response = await rcon.send(`data get entity ${botUsername}`);
    if (response && !response.includes('No entity')) {
      botOnline = true;
      console.log(`[${timestamp()}] Bot "${botUsername}" is online!`);
      break;
    }
    console.log(`[${timestamp()}] Waiting for bot to join (${attempt}/30)...`);
    await sleep(2000);
  }

  if (!botOnline) {
    console.error(`[${timestamp()}] Bot never joined, continuing anyway...`);
  }

  // Teleport and equip bot
  console.log(`\n[${timestamp()}] --- Phase 3: Bot Setup ---`);
  await executeCommands(rcon, [
    `tp ${botUsername} ${config.spawn.x} ${config.spawn.y} ${config.spawn.z}`,
    `give ${botUsername} iron_pickaxe 1`,
  ]);

  console.log(`\n[${timestamp()}] === Setup complete! ===`);

  // ========== PHASE 4: Bot equipment monitor ==========
  // Periodically check if bot has a pickaxe (handles respawn after death)
  const equipmentCheckIntervalMs = 5000;
  console.log(`[${timestamp()}] Starting equipment monitor (every ${equipmentCheckIntervalMs / 1000}s)`);

  setInterval(async () => {
    await ensureBotHasPickaxe(rcon, botUsername);
  }, equipmentCheckIntervalMs);

  // ========== PHASE 5: Continuous spawner ==========
  if (config.spawner) {
    const spawnerPath = path.join(scenarioDir, config.spawner.commands);
    if (!fs.existsSync(spawnerPath)) {
      console.error(`[${timestamp()}] Spawner commands not found: ${spawnerPath}`);
      process.exit(1);
    }

    const spawnCommands = fs.readFileSync(spawnerPath, 'utf-8').split('\n');
    const intervalMs = spawnIntervalOverride ?? config.spawner.intervalMs;

    console.log(`\n[${timestamp()}] --- Phase 5: Starting Spawner ---`);
    console.log(`[${timestamp()}] Interval: ${intervalMs}ms`);
    console.log(`[${timestamp()}] Press Ctrl+C to stop\n`);

    // Initial spawn
    console.log(`[${timestamp()}] Spawning resources...`);
    await executeCommands(rcon, spawnCommands, true);

    // Spawn loop
    while (true) {
      await sleep(intervalMs);
      console.log(`[${timestamp()}] Spawning resources...`);
      await executeCommands(rcon, spawnCommands, true);
    }
  } else {
    // Keep running for equipment monitor even without spawner
    console.log(`[${timestamp()}] No spawner configured, running equipment monitor only.`);
    // Keep process alive
    await new Promise(() => {});
  }
}

main().catch((err) => {
  console.error(`[${timestamp()}] Error:`, err);
  process.exit(1);
});

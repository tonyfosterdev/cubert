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
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForConnection(
  host: string,
  port: number,
  password: string,
  maxAttempts: number = 30
): Promise<Rcon> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`Attempting RCON connection (${attempt}/${maxAttempts})...`);
      const rcon = await Rcon.connect({
        host,
        port,
        password,
      });
      console.log('RCON connected!');
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

async function executeCommands(rcon: Rcon, commands: string[]): Promise<void> {
  for (const command of commands) {
    const trimmed = command.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    try {
      console.log(`> ${trimmed}`);
      const response = await rcon.send(trimmed);
      if (response) {
        console.log(`  ${response}`);
      }
      // Small delay between commands
      await sleep(100);
    } catch (err) {
      console.error(`  Error: ${err}`);
    }
  }
}

async function main() {
  const scenario = process.env.SCENARIO || 'gold-mining';
  const mcHost = process.env.MC_HOST || 'minecraft';
  const rconPort = parseInt(process.env.RCON_PORT || '25575');
  const rconPassword = process.env.RCON_PASSWORD || 'minecraft';
  const botUsername = process.env.BOT_USERNAME || 'Cubert';

  console.log(`=== Cubert Scenario Runner ===`);
  console.log(`Scenario: ${scenario}`);
  console.log(`Minecraft: ${mcHost}:${rconPort}`);

  // Load scenario config - try Docker path first, then local path
  const scenarioPaths = [
    `/scenarios/${scenario}`,  // Docker mount
    path.resolve(__dirname, `../../../scenarios/${scenario}`),  // Local (from src/)
    path.resolve(__dirname, `../../scenarios/${scenario}`),  // Local (from dist/)
  ];

  let scenarioDir: string | null = null;
  for (const p of scenarioPaths) {
    if (fs.existsSync(path.join(p, 'scenario.json'))) {
      scenarioDir = p;
      break;
    }
  }

  if (!scenarioDir) {
    console.error(`Scenario config not found. Tried:`);
    scenarioPaths.forEach(p => console.error(`  - ${path.join(p, 'scenario.json')}`));
    process.exit(1);
  }

  const configPath = path.join(scenarioDir, 'scenario.json');

  const config: ScenarioConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  console.log(`Loaded scenario: ${config.name} v${config.version}`);

  // Wait for bot to join (give it time to connect)
  console.log('Waiting for services to be ready...');
  await sleep(5000);

  // Connect to RCON
  const rcon = await waitForConnection(mcHost, rconPort, rconPassword);

  try {
    // Set game rules
    console.log('\n--- Setting up game rules ---');
    await executeCommands(rcon, [
      `gamemode ${config.minecraft.gamemode} ${botUsername}`,
      `difficulty ${config.minecraft.difficulty}`,
      `time set ${config.minecraft.time}`,
      `weather ${config.minecraft.weather}`,
      'gamerule doDaylightCycle false',
      'gamerule doWeatherCycle false',
    ]);

    // Load and execute setup commands
    const commandsPath = path.join(scenarioDir, config.setup.commands);
    if (fs.existsSync(commandsPath)) {
      console.log('\n--- Executing scenario setup ---');
      const commands = fs.readFileSync(commandsPath, 'utf-8').split('\n');
      await executeCommands(rcon, commands);
    }

    // Teleport bot to spawn
    console.log('\n--- Teleporting bot ---');
    await executeCommands(rcon, [
      `tp ${botUsername} ${config.spawn.x} ${config.spawn.y} ${config.spawn.z}`,
    ]);

    // Give bot a pickaxe for mining
    console.log('\n--- Equipping bot ---');
    await executeCommands(rcon, [
      `give ${botUsername} iron_pickaxe 1`,
    ]);

    console.log('\n=== Scenario setup complete! ===');
  } finally {
    rcon.end();
  }
}

main().catch((err) => {
  console.error('Scenario runner error:', err);
  process.exit(1);
});

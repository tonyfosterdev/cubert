export interface BodyConfig {
  minecraft: {
    host: string;
    port: number;
    username: string;
    version: string;
  };
  grpc: {
    brainHost: string;
    brainPort: number;
    reconnectIntervalMs: number;
    maxReconnectAttempts: number;
  };
  sensors: {
    pollIntervalMs: number;
    sendIntervalMs: number;
    blockSearchRadius: number;
    blockSearchCount: number;
  };
}

export const defaultConfig: BodyConfig = {
  minecraft: {
    host: process.env.MC_HOST || 'minecraft',
    port: parseInt(process.env.MC_PORT || '25565'),
    username: process.env.BOT_USERNAME || 'Cubert',
    version: process.env.MC_VERSION || '1.20.4',
  },
  grpc: {
    brainHost: process.env.BRAIN_HOST || 'brain',
    brainPort: parseInt(process.env.BRAIN_PORT || '5000'),
    reconnectIntervalMs: 2000,
    maxReconnectAttempts: -1, // Infinite
  },
  sensors: {
    pollIntervalMs: 50, // 20 ticks per second
    sendIntervalMs: 500, // 2 updates per second to brain
    blockSearchRadius: 32,
    blockSearchCount: 10,
  },
};

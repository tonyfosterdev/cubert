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
    playerSearchCount: number;
  };
  supervisor?: {
    host: string;
    port: number;
  };
  spiffe?: {
    agentSocket: string;
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
    sendIntervalMs: 2000, // 2 seconds between sensor updates (reduces CPU)
    blockSearchRadius: 12, // Reduced from 16 to lower CPU
    blockSearchCount: 5,
    playerSearchCount: 10, // Max nearby players to track
  },
  ...(process.env.SUPERVISOR_HOST ? {
    supervisor: {
      host: process.env.SUPERVISOR_HOST,
      port: parseInt(process.env.SUPERVISOR_PORT || '5100'),
    },
    spiffe: {
      agentSocket: process.env.SPIFFE_ENDPOINT_SOCKET || 'unix:///tmp/spire-agent/public/api.sock',
    },
  } : {}),
};

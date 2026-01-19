export interface BrainConfig {
  grpc: {
    port: number;
  };
  scenario: string;
}

export const defaultConfig: BrainConfig = {
  grpc: {
    port: parseInt(process.env.BRAIN_PORT || '5000'),
  },
  scenario: process.env.SCENARIO || 'gold-mining',
};

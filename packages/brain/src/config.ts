export interface LLMConfig {
  model: string;
  maxTokens: number;
}

export interface BrainConfig {
  grpc: {
    port: number;
  };
  scenario: string;
  llm: LLMConfig;
}

export const defaultConfig: BrainConfig = {
  grpc: {
    port: parseInt(process.env.BRAIN_PORT || '5000'),
  },
  scenario: process.env.SCENARIO || 'gold-mining',
  llm: {
    model: process.env.LLM_MODEL || 'claude-sonnet-4-20250514',
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS || '1024'),
  },
};

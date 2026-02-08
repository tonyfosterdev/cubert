export interface SupervisorConfig {
  port: number;
  metricsPort: number;
  spiffe: {
    agentSocket: string;
    expectedBodyId: string;
    expectedBrainId: string;
    supervisorId: string;
  };
}

export const defaultConfig: SupervisorConfig = {
  port: parseInt(process.env.SUPERVISOR_PORT || '5100'),
  metricsPort: parseInt(process.env.METRICS_PORT || '9093'),
  spiffe: {
    agentSocket: process.env.SPIFFE_ENDPOINT_SOCKET || 'unix:///tmp/spire-agent/public/api.sock',
    expectedBodyId: process.env.EXPECTED_BODY_SPIFFE_ID || 'spiffe://cubert.local/body',
    expectedBrainId: process.env.EXPECTED_BRAIN_SPIFFE_ID || 'spiffe://cubert.local/brain',
    supervisorId: process.env.SUPERVISOR_SPIFFE_ID || 'spiffe://cubert.local/supervisor',
  },
};

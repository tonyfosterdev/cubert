import { createServer, IncomingMessage, ServerResponse } from 'http';
import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';
import { logger } from './logger';

const register = new Registry();

collectDefaultMetrics({ register });

// LLM Metrics
export const llmCallsTotal = new Counter({
  name: 'cubert_llm_calls_total',
  help: 'LLM API calls by status',
  labelNames: ['status'],
  registers: [register],
});

export const llmLatency = new Histogram({
  name: 'cubert_llm_latency_seconds',
  help: 'LLM API response latency in seconds',
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [register],
});

// Thought Processing Metrics
export const thoughtsProcessedTotal = new Counter({
  name: 'cubert_thoughts_processed_total',
  help: 'Thoughts processed by source',
  labelNames: ['source'],
  registers: [register],
});

// Command Queue Metrics
export const commandsQueuedTotal = new Counter({
  name: 'cubert_commands_queued_total',
  help: 'Commands queued by tool type',
  labelNames: ['tool'],
  registers: [register],
});

export const commandQueueLength = new Gauge({
  name: 'cubert_command_queue_length',
  help: 'Current command queue depth',
  registers: [register],
});

// Brain State Metrics
export const brainConnected = new Gauge({
  name: 'cubert_brain_connected',
  help: '1 if body is connected to brain, 0 if not',
  registers: [register],
});

export function startMetricsServer(port: number = 9092): void {
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/metrics') {
      res.setHeader('Content-Type', register.contentType);
      res.end(await register.metrics());
    } else {
      res.statusCode = 404;
      res.end('Not found');
    }
  });

  server.listen(port, () => {
    logger.info({ port, endpoint: '/metrics' }, 'Prometheus metrics server started');
  });
}

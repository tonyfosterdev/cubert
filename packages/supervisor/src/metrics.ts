import { createServer, IncomingMessage, ServerResponse } from 'http';
import { Registry, Counter, Gauge, collectDefaultMetrics } from 'prom-client';
import { logger } from './logger';

const register = new Registry();

collectDefaultMetrics({ register });

export const activeConnections = new Gauge({
  name: 'cubert_supervisor_active_connections',
  help: 'Active gRPC connections by role',
  labelNames: ['role'],
  registers: [register],
});

export const messagesRelayed = new Counter({
  name: 'cubert_supervisor_messages_relayed_total',
  help: 'Messages relayed between brain and body',
  labelNames: ['direction'],
  registers: [register],
});

export const authFailures = new Counter({
  name: 'cubert_supervisor_auth_failures_total',
  help: 'Authentication failures by reason',
  labelNames: ['reason'],
  registers: [register],
});

export function startMetricsServer(port: number = 9093): void {
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

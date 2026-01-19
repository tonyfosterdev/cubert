import { createServer, IncomingMessage, ServerResponse } from 'http';
import { Registry, Counter, Gauge, collectDefaultMetrics } from 'prom-client';

const register = new Registry();

collectDefaultMetrics({ register });

export const goldMinedTotal = new Counter({
  name: 'cubert_gold_mined_total',
  help: 'Gold ore blocks mined',
  registers: [register],
});

export const goldInventory = new Gauge({
  name: 'cubert_gold_inventory',
  help: 'Raw gold in bot inventory',
  registers: [register],
});

export const goldChest = new Gauge({
  name: 'cubert_gold_chest',
  help: 'Raw gold in chest',
  registers: [register],
});

export const sensorGathersTotal = new Counter({
  name: 'cubert_sensor_gathers_total',
  help: 'Sensor collect() calls',
  registers: [register],
});

export const actionsTotal = new Counter({
  name: 'cubert_actions_total',
  help: 'Actions by type and outcome',
  labelNames: ['type', 'result'],
  registers: [register],
});

export const botConnected = new Gauge({
  name: 'cubert_bot_connected',
  help: '1 if connected, 0 if not',
  registers: [register],
});

export function startMetricsServer(port: number = 9091): void {
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
    console.log(`[METRICS] Prometheus metrics available at http://localhost:${port}/metrics`);
  });
}

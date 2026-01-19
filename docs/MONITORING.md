# Monitoring

Cubert uses Prometheus for metrics collection and Grafana for visualization. Container metrics are collected via cAdvisor.

## Access Points

| Service | URL | Description |
|---------|-----|-------------|
| Grafana | http://localhost:3000 | Dashboards (anonymous admin access) |
| Prometheus | http://localhost:9090 | Metrics query UI |
| Body Metrics | http://localhost:9091/metrics | Raw Prometheus metrics |
| cAdvisor | http://localhost:8080 | Container metrics UI |

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Grafana   │────▶│  Prometheus │────▶│  cAdvisor   │
│   :3000     │     │   :9090     │     │   :8080     │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │    Body     │
                    │   :9091     │
                    └─────────────┘
```

## Custom Cubert Metrics

These metrics are exposed by the body service at `/metrics`:

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `cubert_gold_mined_total` | Counter | - | Total gold ore blocks mined |
| `cubert_gold_inventory` | Gauge | - | Raw gold currently in bot inventory |
| `cubert_gold_chest` | Gauge | - | Raw gold in chest (updated on deposit) |
| `cubert_sensor_gathers_total` | Counter | - | Total sensor collect() calls |
| `cubert_actions_total` | Counter | `type`, `result` | Actions by type and outcome |
| `cubert_bot_connected` | Gauge | - | 1 if bot connected, 0 if not |

### Action Types

The `cubert_actions_total` metric tracks these action types:
- `ACTION_TYPE_MOVE_TO` - Pathfinding movement
- `ACTION_TYPE_MINE_BLOCK` - Mining a block
- `ACTION_TYPE_DEPOSIT_ITEMS` - Depositing to chest
- `ACTION_TYPE_SPEAK` - Chat messages
- `ACTION_TYPE_IDLE` - Idle/wait actions

Results are labeled as `success` or `failed`.

### Example Queries

```promql
# Gold mining rate (per minute)
rate(cubert_gold_mined_total[1m]) * 60

# Total gold (inventory + chest)
cubert_gold_inventory + cubert_gold_chest

# Action success rate
sum(cubert_actions_total{result="success"}) / sum(cubert_actions_total)

# Failed actions by type
cubert_actions_total{result="failed"}
```

## cAdvisor Container Metrics

cAdvisor automatically collects metrics for all Docker containers. Key metrics:

### CPU Metrics

| Metric | Description |
|--------|-------------|
| `container_cpu_usage_seconds_total` | Cumulative CPU time consumed |
| `container_cpu_user_seconds_total` | User CPU time |
| `container_cpu_system_seconds_total` | System CPU time |

```promql
# CPU usage percentage for body container
rate(container_cpu_usage_seconds_total{name="cubert-body-1"}[1m]) * 100
```

### Memory Metrics

| Metric | Description |
|--------|-------------|
| `container_memory_usage_bytes` | Current memory usage |
| `container_memory_max_usage_bytes` | Maximum memory usage |
| `container_memory_working_set_bytes` | Working set memory |
| `container_memory_cache` | Page cache memory |

```promql
# Memory usage in MB for all cubert containers
container_memory_usage_bytes{name=~"cubert-.*"} / 1024 / 1024
```

### Network Metrics

| Metric | Description |
|--------|-------------|
| `container_network_receive_bytes_total` | Bytes received |
| `container_network_transmit_bytes_total` | Bytes transmitted |

```promql
# Network throughput for body container
rate(container_network_receive_bytes_total{name="cubert-body-1"}[1m])
```

### Filesystem Metrics

| Metric | Description |
|--------|-------------|
| `container_fs_usage_bytes` | Filesystem usage |
| `container_fs_limit_bytes` | Filesystem limit |

## Node.js Process Metrics

The body service also exposes default Node.js metrics via prom-client:

| Metric | Description |
|--------|-------------|
| `process_cpu_user_seconds_total` | User CPU time |
| `process_cpu_system_seconds_total` | System CPU time |
| `process_resident_memory_bytes` | Resident memory size |
| `process_heap_bytes` | Process heap size |
| `nodejs_eventloop_lag_seconds` | Event loop lag |
| `nodejs_active_handles_total` | Active handles |
| `nodejs_active_requests_total` | Active requests |

## Grafana Dashboard

A pre-configured dashboard is available at `grafana/dashboards/cubert.json` and is automatically provisioned when Grafana starts.

The dashboard includes:
- Bot connection status
- Gold mining statistics (mined, inventory, chest)
- Action breakdown by type
- Container CPU and memory usage
- Sensor gather rate

## Adding New Metrics

To add new metrics to the body service:

1. Define the metric in `packages/body/src/metrics.ts`:
```typescript
export const myNewMetric = new Counter({
  name: 'cubert_my_metric_total',
  help: 'Description of the metric',
  labelNames: ['label1', 'label2'], // optional
  registers: [register],
});
```

2. Import and use in the relevant code:
```typescript
import { myNewMetric } from '../metrics';

// Increment counter
myNewMetric.inc();
myNewMetric.inc({ label1: 'value1', label2: 'value2' });

// Set gauge
myGauge.set(42);
```

3. Restart the body service to pick up changes.

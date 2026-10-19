# Observability

The API and the worker export traces and metrics with OpenTelemetry (OTLP over HTTP). Telemetry
is off unless `OTEL_EXPORTER_OTLP_ENDPOINT` is set.

![DataCollab Grafana dashboard](../screenshots/grafana-dashboard.png)

*Screenshot from the local stack below, taken while a script sent synthetic traffic: queries
(some repeated, so they hit the cache), rejected `DELETE` statements, uploads, and agent
questions answered by the scripted test model, some with deliberately broken SQL. The numbers
show the dashboard working; they are not a benchmark.*

## What is collected

| Signal | Source |
|---|---|
| HTTP spans | `@opentelemetry/instrumentation-http` and `-express` |
| PostgreSQL spans and `db_client_operation_duration` | `@opentelemetry/instrumentation-pg` (statement text, no parameter values) |
| Redis spans | `@opentelemetry/instrumentation-ioredis` |
| `agent.run` span with one child span per step (`agent.step.plan`, `agent.step.run_sql`, ...) carrying run id, tool and token counts | `agent/service.ts` |
| `datacollab.http.server.duration` histogram by method, route pattern and status | `observability/metrics.ts` middleware |
| `datacollab.agent.run.duration` histogram by mode and status | agent service |
| `datacollab.agent.tool.calls` counter by tool and outcome | agent service |
| `datacollab.query_cache.lookups` counter by hit or miss | query cache |

## Dashboard panels

Request rate, 5xx and 4xx rates, p95 latency per endpoint, agent run duration (p50/p95), tool error
rate, cache hit rate, PostgreSQL p95, and a table of recent agent traces from Tempo. The dashboard
JSON is `observability/grafana/datacollab-dashboard.json`.

## Run it locally

```bash
docker compose -f docker-compose.yml -f docker-compose.observability.yml up --build
```

Grafana: http://localhost:3001 (admin / admin) → Dashboards → DataCollab. The `grafana/otel-lgtm`
image bundles the OpenTelemetry Collector, Prometheus, Tempo and Loki.

Without Docker Compose, run the API with:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 npm run dev
```

## Grafana Cloud (free tier)

Create a stack, open **Connections → OpenTelemetry (OTLP)**, and set:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-<region>.grafana.net/otlp
OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic <base64 of instanceId:token>"
```

Then import `observability/grafana/datacollab-dashboard.json`. It uses datasource UIDs
`prometheus` and `tempo`, so pick your stack's Prometheus and Tempo datasources when importing.

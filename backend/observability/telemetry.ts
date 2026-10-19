// OpenTelemetry setup. Load this before anything else (server.js and worker.js require it first)
// so the HTTP, Express, pg and ioredis modules are instrumented when they are first required.
//
// Enabled when OTEL_EXPORTER_OTLP_ENDPOINT is set, e.g.
//   http://localhost:4318                                (local grafana/otel-lgtm container)
//   https://otlp-gateway-prod-<region>.grafana.net/otlp  (Grafana Cloud free tier, plus
//   OTEL_EXPORTER_OTLP_HEADERS="Authorization=Basic <base64 instanceId:token>")
// The OTLP exporters read the endpoint and headers from the standard OTEL_* variables.
import { NodeSDK } from '@opentelemetry/sdk-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';

let sdk: NodeSDK | null = null;

export function startTelemetry(serviceName: string): boolean {
  if (sdk || !process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.NODE_ENV === 'test')
    return false;
  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || serviceName,
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version || '1.0.0',
      'deployment.environment.name': process.env.NODE_ENV || 'development',
    }),
    traceExporter: new OTLPTraceExporter(),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        exportIntervalMillis: Number(process.env.OTEL_METRIC_EXPORT_INTERVAL || 15000),
      }),
    ],
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (req) => req.url === '/health',
      }),
      new ExpressInstrumentation(),
      // Statement text is recorded; parameter values are not (they can contain user data).
      new PgInstrumentation({ enhancedDatabaseReporting: false }),
      new IORedisInstrumentation(),
    ],
  });
  sdk.start();
  const shutdown = () => {
    sdk
      ?.shutdown()
      .catch(() => {})
      .finally(() => process.exit(0));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  return true;
}

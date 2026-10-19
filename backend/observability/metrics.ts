// Application metrics and spans. With no SDK registered (tests, telemetry off) the OpenTelemetry
// API returns no-op implementations, so this costs nothing when unused.
import { metrics, trace, SpanStatusCode, type Span } from '@opentelemetry/api';
import type { Request, Response, NextFunction } from 'express';

const meter = metrics.getMeter('datacollab');
export const tracer = trace.getTracer('datacollab');

const httpDuration = meter.createHistogram('datacollab.http.server.duration', {
  description: 'HTTP request duration by route',
  unit: 'ms',
  advice: {
    explicitBucketBoundaries: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000],
  },
});
const agentRunDuration = meter.createHistogram('datacollab.agent.run.duration', {
  description: 'End-to-end agent run duration',
  unit: 'ms',
  advice: { explicitBucketBoundaries: [100, 500, 1000, 2500, 5000, 10000, 20000, 40000, 80000] },
});
const agentToolCalls = meter.createCounter('datacollab.agent.tool.calls', {
  description: 'Agent tool calls by tool and outcome',
});
const cacheLookups = meter.createCounter('datacollab.query_cache.lookups', {
  description: 'Query cache lookups by result (hit or miss)',
});

/** Express middleware: one histogram sample per request, labelled with the route pattern. */
export function httpMetrics(req: Request, res: Response, next: NextFunction) {
  // Health checks come every few seconds from load balancers and would drown the real traffic.
  if (req.path === '/health') return next();
  const start = performance.now();
  res.on('finish', () => {
    // Route patterns (/api/files/:id) keep the number of label values small.
    const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.baseUrl || 'unmatched';
    httpDuration.record(performance.now() - start, {
      'http.request.method': req.method,
      'http.route': route,
      'http.response.status_code': res.statusCode,
    });
  });
  next();
}

export function recordAgentRun(ms: number, attrs: { mode: string; status: string }) {
  agentRunDuration.record(ms, attrs);
}

export function recordToolCall(tool: string, ok: boolean) {
  agentToolCalls.add(1, { tool, outcome: ok ? 'ok' : 'error' });
}

export function recordCacheLookup(hit: boolean) {
  cacheLookups.add(1, { result: hit ? 'hit' : 'miss' });
}

/**
 * Record an agent step as a child span of the current run. Steps report their latency after
 * they finish, so the span is created with a start time in the past.
 */
export function recordStepSpan(
  name: string,
  latencyMs: number,
  attrs: Record<string, string | number | boolean | undefined>,
  error?: string
) {
  const end = Date.now();
  const span: Span = tracer.startSpan(name, { startTime: end - latencyMs });
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) span.setAttribute(k, v);
  if (error) span.setStatus({ code: SpanStatusCode.ERROR, message: error.slice(0, 200) });
  span.end(end);
}

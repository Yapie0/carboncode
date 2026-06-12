import {
  type SpanRecord,
  type TraceContext,
  createChildTraceContext,
  createRootTraceContext,
  endSpan,
  parseTraceparent,
  startSpan,
} from "../request-trace-context/core.js";

export interface ExpressRequestTrace {
  context: TraceContext;
  span: SpanRecord;
  responseHeaders: Record<string, string>;
}

export interface ExpressRequestSpanInput {
  method: string;
  route: string;
  traceparent?: string;
  nowMs: number;
  idFactory?: (bytes: number) => string;
  attributes?: Record<string, string | number | boolean>;
}

export function startExpressRequestSpan(input: ExpressRequestSpanInput): ExpressRequestTrace {
  assertNonEmpty(input.method, "method");
  assertNonEmpty(input.route, "route");
  const parent = parseTraceparent(input.traceparent);
  const context = parent
    ? createChildTraceContext({
        parent,
        sampled: parent.sampled,
        idFactory: input.idFactory,
      })
    : createRootTraceContext({ sampled: true, idFactory: input.idFactory });
  const method = input.method.trim().toUpperCase();
  const route = normalizeRoute(input.route);
  const span = startSpan({
    context,
    name: `${method} ${route}`,
    startedAtMs: input.nowMs,
    attributes: {
      "http.method": method,
      "http.route": route,
      "span.kind": "server",
      ...(input.attributes ?? {}),
    },
  });
  return {
    context,
    span,
    responseHeaders: { traceparent: formatOutgoingTraceparent(context) },
  };
}

export function finishExpressRequestSpan(
  span: SpanRecord,
  input: {
    statusCode: number;
    endedAtMs: number;
    error?: Error | string;
    attributes?: Record<string, string | number | boolean>;
  },
): SpanRecord {
  assertStatusCode(input.statusCode);
  const status = input.error || input.statusCode >= 500 ? "error" : "ok";
  const errorAttributes: Record<string, string | number | boolean> = {};
  if (input.error !== undefined) {
    errorAttributes["error.type"] = typeof input.error === "string" ? "Error" : input.error.name;
    errorAttributes["error.message"] =
      typeof input.error === "string" ? input.error : input.error.message;
  }
  return endSpan(span, {
    endedAtMs: input.endedAtMs,
    status,
    attributes: {
      "http.status_code": input.statusCode,
      ...errorAttributes,
      ...(input.attributes ?? {}),
    },
  });
}

export function shouldSampleRequest(input: {
  route: string;
  method: string;
  sampleRate: number;
  hash: number;
}): boolean {
  assertNonEmpty(input.route, "route");
  assertNonEmpty(input.method, "method");
  if (!Number.isFinite(input.sampleRate) || input.sampleRate < 0 || input.sampleRate > 1) {
    throw new Error("sampleRate must be between 0 and 1");
  }
  if (!Number.isInteger(input.hash) || input.hash < 0) {
    throw new Error("hash must be a non-negative integer");
  }
  if (input.sampleRate === 0) return false;
  if (input.sampleRate === 1) return true;
  return input.hash % 10_000 < Math.round(input.sampleRate * 10_000);
}

export function normalizeRoute(route: string): string {
  const trimmed = route.trim();
  if (!trimmed) throw new Error("route is required");
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function formatOutgoingTraceparent(context: TraceContext): string {
  return `00-${context.traceId}-${context.spanId}-${context.sampled ? "01" : "00"}`;
}

function assertStatusCode(statusCode: number): void {
  if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
    throw new Error("statusCode must be an integer between 100 and 599");
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

import { randomBytes } from "node:crypto";

export interface TraceContext {
  traceId: string;
  parentId?: string;
  spanId: string;
  sampled: boolean;
  baggage?: Record<string, string>;
}

export interface SpanRecord {
  traceId: string;
  spanId: string;
  parentId?: string;
  name: string;
  startedAtMs: number;
  endedAtMs?: number;
  durationMs?: number;
  status: "ok" | "error" | "unset";
  attributes: Record<string, string | number | boolean>;
}

export function parseTraceparent(header: string | undefined): TraceContext | undefined {
  if (!header) return undefined;
  const parts = header.trim().split("-");
  if (parts.length !== 4) return undefined;
  const version = parts[0]!;
  const traceId = parts[1]!;
  const parentId = parts[2]!;
  const flags = parts[3]!;
  if (version !== "00") return undefined;
  if (!isHex(traceId, 32) || /^0+$/.test(traceId)) return undefined;
  if (!isHex(parentId, 16) || /^0+$/.test(parentId)) return undefined;
  if (!isHex(flags, 2)) return undefined;
  return {
    traceId,
    parentId,
    spanId: parentId,
    sampled: (Number.parseInt(flags, 16) & 1) === 1,
  };
}

export function parseBaggage(
  header: string | undefined,
  allowedKeys?: readonly string[],
): Record<string, string> {
  if (!header) return {};
  const allowed = allowedKeys ? new Set(allowedKeys.map((key) => key.toLowerCase())) : undefined;
  const baggage: Record<string, string> = {};
  for (const item of header.split(",")) {
    const [rawKey, ...rawValue] = item.trim().split("=");
    const key = rawKey?.trim().toLowerCase();
    const value = rawValue.join("=").trim();
    if (!key || !/^[a-z0-9_.-]+$/.test(key)) continue;
    if (allowed && !allowed.has(key)) continue;
    if (!value) continue;
    baggage[key] = decodeURIComponent(value);
  }
  return baggage;
}

export function formatBaggage(baggage: Record<string, string> | undefined): string | undefined {
  if (!baggage) return undefined;
  const entries = Object.entries(baggage)
    .filter(([key, value]) => /^[a-z0-9_.-]+$/.test(key) && value.length > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`);
  return entries.length > 0 ? entries.join(",") : undefined;
}

export function formatTraceparent(context: TraceContext): string {
  validateTraceContext(context);
  return `00-${context.traceId}-${context.spanId}-${context.sampled ? "01" : "00"}`;
}

export function createRootTraceContext(
  input: { sampled?: boolean; idFactory?: (bytes: number) => string } = {},
): TraceContext {
  const idFactory = input.idFactory ?? randomHex;
  return {
    traceId: idFactory(16),
    spanId: idFactory(8),
    sampled: input.sampled ?? true,
  };
}

export function createChildTraceContext(input: {
  parent?: TraceContext;
  sampled?: boolean;
  idFactory?: (bytes: number) => string;
  baggage?: Record<string, string>;
}): TraceContext {
  const idFactory = input.idFactory ?? randomHex;
  const parent = input.parent ?? createRootTraceContext({ sampled: input.sampled, idFactory });
  validateTraceContext(parent);
  return {
    traceId: parent.traceId,
    parentId: parent.spanId,
    spanId: idFactory(8),
    sampled: input.sampled ?? parent.sampled,
    baggage: cloneStringRecord(input.baggage ?? parent.baggage),
  };
}

export function extractOrCreateTraceContext(input: {
  traceparent?: string;
  baggage?: string;
  sampled?: boolean;
  idFactory?: (bytes: number) => string;
  allowedBaggageKeys?: readonly string[];
}): TraceContext {
  const baggage = parseBaggage(input.baggage, input.allowedBaggageKeys);
  const parent = parseTraceparent(input.traceparent);
  if (!parent) {
    const root = createRootTraceContext({ sampled: input.sampled, idFactory: input.idFactory });
    return Object.keys(baggage).length > 0 ? { ...root, baggage } : root;
  }
  return createChildTraceContext({
    parent: { ...parent, baggage },
    sampled: input.sampled,
    idFactory: input.idFactory,
  });
}

export function startSpan(input: {
  context: TraceContext;
  name: string;
  startedAtMs: number;
  attributes?: Record<string, string | number | boolean>;
}): SpanRecord {
  validateTraceContext(input.context);
  assertNonEmpty(input.name, "name");
  assertNonNegativeInteger(input.startedAtMs, "startedAtMs");
  return {
    traceId: input.context.traceId,
    spanId: input.context.spanId,
    parentId: input.context.parentId,
    name: input.name,
    startedAtMs: input.startedAtMs,
    status: "unset",
    attributes: { ...(input.attributes ?? {}) },
  };
}

export function endSpan(
  span: SpanRecord,
  input: {
    endedAtMs: number;
    status?: "ok" | "error";
    attributes?: Record<string, string | number | boolean>;
  },
): SpanRecord {
  assertNonNegativeInteger(input.endedAtMs, "endedAtMs");
  if (input.endedAtMs < span.startedAtMs) throw new Error("endedAtMs must be >= startedAtMs");
  return {
    ...span,
    endedAtMs: input.endedAtMs,
    durationMs: input.endedAtMs - span.startedAtMs,
    status: input.status ?? "ok",
    attributes: { ...span.attributes, ...(input.attributes ?? {}) },
  };
}

export function injectTraceHeaders(context: TraceContext): Record<string, string> {
  const baggage = formatBaggage(context.baggage);
  return baggage
    ? { traceparent: formatTraceparent(context), baggage }
    : { traceparent: formatTraceparent(context) };
}

export function cloneTraceContext(context: TraceContext): TraceContext {
  return {
    ...context,
    baggage: cloneStringRecord(context.baggage),
  };
}

export function cloneSpanRecord(span: SpanRecord): SpanRecord {
  return {
    ...span,
    attributes: { ...span.attributes },
  };
}

function validateTraceContext(context: TraceContext): void {
  if (!isHex(context.traceId, 32) || /^0+$/.test(context.traceId)) {
    throw new Error("traceId must be 32 non-zero hex characters");
  }
  if (!isHex(context.spanId, 16) || /^0+$/.test(context.spanId)) {
    throw new Error("spanId must be 16 non-zero hex characters");
  }
  if (
    context.parentId !== undefined &&
    (!isHex(context.parentId, 16) || /^0+$/.test(context.parentId))
  ) {
    throw new Error("parentId must be 16 non-zero hex characters");
  }
}

function cloneStringRecord(
  value: Record<string, string> | undefined,
): Record<string, string> | undefined {
  return value ? { ...value } : undefined;
}

function randomHex(bytes: number): string {
  return randomBytes(bytes).toString("hex");
}

function isHex(value: string, length: number): boolean {
  return value.length === length && /^[a-f0-9]+$/i.test(value);
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative integer`);
}

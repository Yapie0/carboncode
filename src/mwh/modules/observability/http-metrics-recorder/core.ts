export interface HttpMetricSample {
  route: string;
  method: string;
  statusCode: number;
  durationMs: number;
  recordedAtMs: number;
  error?: boolean;
}

export interface HttpMetricKey {
  route: string;
  method: string;
  statusClass: "1xx" | "2xx" | "3xx" | "4xx" | "5xx";
}

export interface HttpMetricBucket {
  key: HttpMetricKey;
  count: number;
  errorCount: number;
  totalDurationMs: number;
  minDurationMs: number;
  maxDurationMs: number;
  p50DurationMs: number;
  p95DurationMs: number;
}

export interface PendingHttpMetricRequest {
  route: string;
  method: string;
  startedAtMs: number;
}

export function createHttpMetricSample(input: {
  route: string;
  method: string;
  statusCode: number;
  durationMs: number;
  recordedAtMs: number;
  error?: boolean;
}): HttpMetricSample {
  assertNonEmpty(input.route, "route");
  assertNonEmpty(input.method, "method");
  assertStatusCode(input.statusCode);
  assertNonNegativeInteger(input.durationMs, "durationMs");
  assertNonNegativeInteger(input.recordedAtMs, "recordedAtMs");
  return {
    route: normalizeRoute(input.route),
    method: input.method.trim().toUpperCase(),
    statusCode: input.statusCode,
    durationMs: input.durationMs,
    recordedAtMs: input.recordedAtMs,
    error: input.error ?? input.statusCode >= 500,
  };
}

export function startHttpMetricRequest(input: {
  route: string;
  method: string;
  startedAtMs: number;
}): PendingHttpMetricRequest {
  assertNonEmpty(input.route, "route");
  assertNonEmpty(input.method, "method");
  assertNonNegativeInteger(input.startedAtMs, "startedAtMs");
  return {
    route: normalizeRoute(input.route),
    method: input.method.trim().toUpperCase(),
    startedAtMs: input.startedAtMs,
  };
}

export function finishHttpMetricRequest(
  pending: PendingHttpMetricRequest,
  input: {
    statusCode: number;
    endedAtMs: number;
    error?: boolean;
  },
): HttpMetricSample {
  assertNonNegativeInteger(input.endedAtMs, "endedAtMs");
  if (input.endedAtMs < pending.startedAtMs) {
    throw new Error("endedAtMs must be >= startedAtMs");
  }
  return createHttpMetricSample({
    route: pending.route,
    method: pending.method,
    statusCode: input.statusCode,
    durationMs: input.endedAtMs - pending.startedAtMs,
    recordedAtMs: input.endedAtMs,
    error: input.error,
  });
}

export function metricKey(sample: HttpMetricSample): HttpMetricKey {
  return {
    route: sample.route,
    method: sample.method,
    statusClass: statusClass(sample.statusCode),
  };
}

export function metricKeyString(key: HttpMetricKey): string {
  return `${key.method} ${key.route} ${key.statusClass}`;
}

export function statusClass(statusCode: number): HttpMetricKey["statusClass"] {
  assertStatusCode(statusCode);
  if (statusCode < 200) return "1xx";
  if (statusCode < 300) return "2xx";
  if (statusCode < 400) return "3xx";
  if (statusCode < 500) return "4xx";
  return "5xx";
}

export function aggregateHttpMetricBucket(
  key: HttpMetricKey,
  samples: readonly HttpMetricSample[],
): HttpMetricBucket | undefined {
  const matching = samples
    .filter((sample) => metricKeyString(metricKey(sample)) === metricKeyString(key))
    .sort((a, b) => a.durationMs - b.durationMs);
  if (matching.length === 0) return undefined;
  const durations = matching.map((sample) => sample.durationMs);
  return {
    key,
    count: matching.length,
    errorCount: matching.filter((sample) => sample.error).length,
    totalDurationMs: durations.reduce((sum, duration) => sum + duration, 0),
    minDurationMs: durations[0]!,
    maxDurationMs: durations[durations.length - 1]!,
    p50DurationMs: percentile(durations, 0.5),
    p95DurationMs: percentile(durations, 0.95),
  };
}

export function aggregateHttpMetrics(samples: readonly HttpMetricSample[]): HttpMetricBucket[] {
  const keys = new Map<string, HttpMetricKey>();
  for (const sample of samples) {
    const key = metricKey(sample);
    keys.set(metricKeyString(key), key);
  }
  return [...keys.values()]
    .map((key) => aggregateHttpMetricBucket(key, samples))
    .filter((bucket): bucket is HttpMetricBucket => bucket !== undefined)
    .sort((a, b) => metricKeyString(a.key).localeCompare(metricKeyString(b.key)));
}

export function percentile(sortedValues: readonly number[], ratio: number): number {
  if (sortedValues.length === 0) throw new Error("percentile requires at least one value");
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new Error("ratio must be between 0 and 1");
  }
  const index = Math.ceil(sortedValues.length * ratio) - 1;
  return sortedValues[Math.max(0, Math.min(sortedValues.length - 1, index))]!;
}

function normalizeRoute(route: string): string {
  const trimmed = route.trim();
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function assertStatusCode(statusCode: number): void {
  if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599) {
    throw new Error("statusCode must be an integer between 100 and 599");
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

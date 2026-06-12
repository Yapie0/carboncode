export type LogLevel = "debug" | "info" | "warn" | "error";

export interface RedactionPolicy {
  redactedKeys: readonly string[];
  redactedPaths?: readonly string[];
  redactedPatterns?: readonly RegExp[];
  replacement?: string;
  maxDepth?: number;
}

export interface StructuredLogEvent {
  id: string;
  level: LogLevel;
  message: string;
  timestampMs: number;
  context: Record<string, unknown>;
}

export interface LogRedactionResult {
  event: StructuredLogEvent;
  redactedPaths: readonly string[];
}

export interface LogSnapshot {
  total: number;
  debug: number;
  info: number;
  warn: number;
  error: number;
  redacted: number;
}

export function createStructuredLogEvent(input: {
  id: string;
  level: LogLevel;
  message: string;
  timestampMs: number;
  context?: Record<string, unknown>;
  policy: RedactionPolicy;
}): LogRedactionResult {
  assertText(input.id, "id");
  assertText(input.message, "message");
  assertNonNegativeInteger(input.timestampMs, "timestampMs");
  assertPolicy(input.policy);
  const messageRedactedPaths: string[] = [];
  const message = redactString(input.message, input.policy, "message", messageRedactedPaths);
  const redacted = redactValue(input.context ?? {}, input.policy, []);
  return {
    event: {
      id: input.id,
      level: input.level,
      message,
      timestampMs: input.timestampMs,
      context: redacted.value as Record<string, unknown>,
    },
    redactedPaths: [...messageRedactedPaths, ...redacted.paths],
  };
}

export function redactLogContext(
  context: Record<string, unknown>,
  policy: RedactionPolicy,
): LogRedactionResult {
  assertPolicy(policy);
  const redacted = redactValue(context, policy, []);
  return {
    event: {
      id: "redacted-context",
      level: "info",
      message: "",
      timestampMs: 0,
      context: redacted.value as Record<string, unknown>,
    },
    redactedPaths: redacted.paths,
  };
}

export function logSnapshot(
  entries: readonly { event: StructuredLogEvent; redactedPaths: readonly string[] }[],
): LogSnapshot {
  return {
    total: entries.length,
    debug: entries.filter((entry) => entry.event.level === "debug").length,
    info: entries.filter((entry) => entry.event.level === "info").length,
    warn: entries.filter((entry) => entry.event.level === "warn").length,
    error: entries.filter((entry) => entry.event.level === "error").length,
    redacted: entries.filter((entry) => entry.redactedPaths.length > 0).length,
  };
}

export function stableLogJson(event: StructuredLogEvent): string {
  return stableStringify(event);
}

export function cloneStructuredLogEvent(event: StructuredLogEvent): StructuredLogEvent {
  return {
    ...event,
    context: cloneJson(event.context) as Record<string, unknown>,
  };
}

function redactValue(
  value: unknown,
  policy: RedactionPolicy,
  path: readonly string[],
): { value: unknown; paths: string[] } {
  const pathString = path.join(".");
  const replacement = policy.replacement ?? "[REDACTED]";
  if (policy.redactedPaths?.includes(pathString))
    return { value: replacement, paths: [pathString] };
  if ((policy.maxDepth ?? Number.POSITIVE_INFINITY) < path.length) {
    return { value: "[TRUNCATED]", paths: [pathString] };
  }
  if (typeof value === "string") {
    const paths: string[] = [];
    return { value: redactString(value, policy, pathString, paths), paths };
  }
  if (Array.isArray(value)) {
    const output: unknown[] = [];
    const paths: string[] = [];
    value.forEach((item, index) => {
      const redacted = redactValue(item, policy, [...path, String(index)]);
      output.push(redacted.value);
      paths.push(...redacted.paths);
    });
    return { value: output, paths };
  }
  if (!value || typeof value !== "object") return { value, paths: [] };

  const keys = new Set(policy.redactedKeys.map((key) => key.toLowerCase()));
  const output: Record<string, unknown> = {};
  const paths: string[] = [];
  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = [...path, key];
    const nestedPathString = nestedPath.join(".");
    if (keys.has(key.toLowerCase()) || policy.redactedPaths?.includes(nestedPathString)) {
      output[key] = replacement;
      paths.push(nestedPathString);
      continue;
    }
    const redacted = redactValue(nested, policy, nestedPath);
    output[key] = redacted.value;
    paths.push(...redacted.paths);
  }
  return { value: output, paths };
}

function redactString(
  value: string,
  policy: RedactionPolicy,
  path: string,
  paths: string[],
): string {
  let output = value;
  for (const pattern of policy.redactedPatterns ?? []) {
    pattern.lastIndex = 0;
    if (pattern.test(output)) {
      pattern.lastIndex = 0;
      output = output.replace(pattern, policy.replacement ?? "[REDACTED]");
      paths.push(path);
    }
  }
  return output;
}

function assertPolicy(policy: RedactionPolicy): void {
  if (
    policy.redactedKeys.length === 0 &&
    !policy.redactedPaths?.length &&
    !policy.redactedPatterns?.length
  ) {
    throw new Error("redaction policy must contain at least one rule");
  }
  if (
    policy.maxDepth !== undefined &&
    (!Number.isInteger(policy.maxDepth) || policy.maxDepth < 0)
  ) {
    throw new Error("maxDepth must be a non-negative integer");
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function cloneJson(value: unknown): unknown {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function assertText(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

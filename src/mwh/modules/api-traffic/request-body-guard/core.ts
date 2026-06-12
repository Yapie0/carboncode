export type BodyGuardDecisionKind = "allow" | "reject";
export type BodyGuardRejectReason =
  | "body-too-large"
  | "content-type-not-allowed"
  | "json-depth-exceeded"
  | "json-field-count-exceeded"
  | "json-invalid";

export interface BodyGuardPolicy {
  routeId: string;
  maxBytes: number;
  allowedContentTypes: readonly string[];
  maxJsonDepth?: number;
  maxJsonFields?: number;
}

export interface BodyGuardRequest {
  routeId: string;
  contentType?: string;
  contentLengthBytes?: number;
  body?: string;
}

export interface BodyGuardDecision {
  kind: BodyGuardDecisionKind;
  routeId: string;
  statusCode: number;
  reason?: BodyGuardRejectReason;
  detail?: string;
}

export interface JsonShapeStats {
  depth: number;
  fields: number;
}

export interface BodyGuardStreamState {
  routeId: string;
  contentType?: string;
  receivedBytes: number;
  body: string;
  rejected?: BodyGuardDecision;
}

export interface BodyGuardChunkResult {
  state: BodyGuardStreamState;
  decision?: BodyGuardDecision;
}

export function evaluateRequestBody(
  policy: BodyGuardPolicy,
  request: BodyGuardRequest,
): BodyGuardDecision {
  assertPolicy(policy);
  assertNonEmpty(request.routeId, "routeId");
  if (policy.routeId !== request.routeId) {
    throw new Error("route policy mismatch");
  }

  const contentType = normalizeContentType(request.contentType);
  if (!contentType || !policy.allowedContentTypes.includes(contentType)) {
    return reject(policy.routeId, 415, "content-type-not-allowed", "content type is not allowed");
  }

  const size = request.contentLengthBytes ?? byteLength(request.body ?? "");
  if (size > policy.maxBytes) {
    return reject(policy.routeId, 413, "body-too-large", "body exceeds maxBytes");
  }

  if (contentType === "application/json" && request.body !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(request.body);
    } catch {
      return reject(policy.routeId, 400, "json-invalid", "body is not valid JSON");
    }
    const stats = analyzeJsonShape(parsed);
    if (policy.maxJsonDepth !== undefined && stats.depth > policy.maxJsonDepth) {
      return reject(policy.routeId, 400, "json-depth-exceeded", "JSON depth exceeds limit");
    }
    if (policy.maxJsonFields !== undefined && stats.fields > policy.maxJsonFields) {
      return reject(
        policy.routeId,
        400,
        "json-field-count-exceeded",
        "JSON field count exceeds limit",
      );
    }
  }

  return { kind: "allow", routeId: policy.routeId, statusCode: 200 };
}

export function analyzeJsonShape(value: unknown): JsonShapeStats {
  return walkJson(value, 1);
}

export function createBodyStreamState(request: {
  routeId: string;
  contentType?: string;
}): BodyGuardStreamState {
  assertNonEmpty(request.routeId, "routeId");
  return {
    routeId: request.routeId,
    contentType: request.contentType,
    receivedBytes: 0,
    body: "",
  };
}

export function appendBodyChunk(
  policy: BodyGuardPolicy,
  state: BodyGuardStreamState,
  chunk: string,
): BodyGuardChunkResult {
  assertPolicy(policy);
  if (policy.routeId !== state.routeId) throw new Error("route policy mismatch");
  if (state.rejected) return { state: cloneStreamState(state), decision: state.rejected };

  const contentType = normalizeContentType(state.contentType);
  if (!contentType || !policy.allowedContentTypes.includes(contentType)) {
    const rejected = reject(
      policy.routeId,
      415,
      "content-type-not-allowed",
      "content type is not allowed",
    );
    return { state: { ...cloneStreamState(state), rejected }, decision: rejected };
  }

  const receivedBytes = state.receivedBytes + byteLength(chunk);
  const next = { ...cloneStreamState(state), receivedBytes, body: `${state.body}${chunk}` };
  if (receivedBytes > policy.maxBytes) {
    const rejected = reject(policy.routeId, 413, "body-too-large", "body exceeds maxBytes");
    return { state: { ...next, rejected }, decision: rejected };
  }
  return { state: next };
}

export function finalizeBodyStream(
  policy: BodyGuardPolicy,
  state: BodyGuardStreamState,
): BodyGuardDecision {
  assertPolicy(policy);
  if (policy.routeId !== state.routeId) throw new Error("route policy mismatch");
  if (state.rejected) return { ...state.rejected };
  return evaluateRequestBody(policy, {
    routeId: state.routeId,
    contentType: state.contentType,
    contentLengthBytes: state.receivedBytes,
    body: state.body,
  });
}

export function normalizeContentType(contentType?: string): string | undefined {
  if (!contentType) return undefined;
  return contentType.split(";")[0]?.trim().toLowerCase();
}

export function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function walkJson(value: unknown, depth: number): JsonShapeStats {
  if (Array.isArray(value)) {
    return value.reduce<JsonShapeStats>(
      (acc, item) => combineStats(acc, walkJson(item, depth + 1)),
      { depth, fields: 0 },
    );
  }
  if (value && typeof value === "object") {
    return Object.values(value).reduce<JsonShapeStats>(
      (acc, nested) => combineStats(acc, walkJson(nested, depth + 1)),
      { depth, fields: Object.keys(value).length },
    );
  }
  return { depth, fields: 0 };
}

function combineStats(left: JsonShapeStats, right: JsonShapeStats): JsonShapeStats {
  return {
    depth: Math.max(left.depth, right.depth),
    fields: left.fields + right.fields,
  };
}

function cloneStreamState(state: BodyGuardStreamState): BodyGuardStreamState {
  return {
    ...state,
    rejected: state.rejected ? { ...state.rejected } : undefined,
  };
}

function reject(
  routeId: string,
  statusCode: number,
  reason: BodyGuardRejectReason,
  detail: string,
): BodyGuardDecision {
  return { kind: "reject", routeId, statusCode, reason, detail };
}

function assertPolicy(policy: BodyGuardPolicy): void {
  assertNonEmpty(policy.routeId, "routeId");
  assertPositiveInteger(policy.maxBytes, "maxBytes");
  if (!Array.isArray(policy.allowedContentTypes) || policy.allowedContentTypes.length === 0) {
    throw new Error("allowedContentTypes are required");
  }
  for (const contentType of policy.allowedContentTypes) {
    assertNonEmpty(contentType, "contentType");
  }
  if (policy.maxJsonDepth !== undefined) assertPositiveInteger(policy.maxJsonDepth, "maxJsonDepth");
  if (policy.maxJsonFields !== undefined)
    assertPositiveInteger(policy.maxJsonFields, "maxJsonFields");
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

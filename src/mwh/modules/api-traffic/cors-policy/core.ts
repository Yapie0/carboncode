export interface CorsPolicy {
  routeId: string;
  allowedOrigins: readonly string[];
  allowedMethods: readonly string[];
  allowedHeaders: readonly string[];
  exposedHeaders?: readonly string[];
  allowCredentials?: boolean;
  maxAgeSeconds?: number;
}

export interface CorsRequest {
  routeId: string;
  origin?: string;
  method: string;
  requestHeaders?: readonly string[];
  preflight?: boolean;
}

export interface CorsHttpRequestLike {
  routeId: string;
  method: string;
  headers: Record<string, string | undefined>;
}

export interface CorsDecision {
  kind: "allow" | "reject";
  routeId: string;
  statusCode: number;
  headers: Record<string, string>;
  reason?: "origin-not-allowed" | "method-not-allowed" | "headers-not-allowed" | "route-mismatch";
}

export function normalizeCorsPolicy(policy: CorsPolicy): CorsPolicy {
  assertNonEmpty(policy.routeId, "routeId");
  if (policy.allowedOrigins.length === 0) throw new Error("allowedOrigins are required");
  if (policy.allowedMethods.length === 0) throw new Error("allowedMethods are required");
  if (policy.allowedHeaders.length === 0) throw new Error("allowedHeaders are required");
  if (policy.allowCredentials && policy.allowedOrigins.includes("*")) {
    throw new Error("wildcard origin cannot be used with credentials");
  }
  if (policy.maxAgeSeconds !== undefined)
    assertNonNegativeInteger(policy.maxAgeSeconds, "maxAgeSeconds");
  return {
    routeId: policy.routeId,
    allowedOrigins: [...new Set(policy.allowedOrigins.map(normalizeOrigin))],
    allowedMethods: [
      ...new Set(policy.allowedMethods.map((method) => method.trim().toUpperCase())),
    ],
    allowedHeaders: [...new Set(policy.allowedHeaders.map(normalizeHeader))],
    exposedHeaders: policy.exposedHeaders
      ? [...new Set(policy.exposedHeaders.map(normalizeHeader))]
      : undefined,
    allowCredentials: policy.allowCredentials,
    maxAgeSeconds: policy.maxAgeSeconds,
  };
}

export function evaluateCorsRequest(policy: CorsPolicy, request: CorsRequest): CorsDecision {
  const normalized = normalizeCorsPolicy(policy);
  assertNonEmpty(request.routeId, "routeId");
  assertNonEmpty(request.method, "method");
  if (normalized.routeId !== request.routeId) {
    return reject(normalized.routeId, 404, "route-mismatch");
  }

  if (!request.origin) return allow(normalized, undefined, request.preflight ?? false);
  const origin = normalizeOrigin(request.origin);
  if (!isOriginAllowed(normalized, origin)) {
    return reject(normalized.routeId, 403, "origin-not-allowed");
  }

  const method = request.method.trim().toUpperCase();
  if (!normalized.allowedMethods.includes(method)) {
    return reject(normalized.routeId, 405, "method-not-allowed");
  }

  const requestedHeaders = (request.requestHeaders ?? []).map(normalizeHeader);
  const deniedHeaders = requestedHeaders.filter(
    (header) =>
      !normalized.allowedHeaders.includes("*") && !normalized.allowedHeaders.includes(header),
  );
  if (deniedHeaders.length > 0) {
    return reject(normalized.routeId, 400, "headers-not-allowed");
  }

  return allow(normalized, origin, request.preflight ?? false);
}

export function corsRequestFromHttp(input: CorsHttpRequestLike): CorsRequest {
  assertNonEmpty(input.routeId, "routeId");
  assertNonEmpty(input.method, "method");
  const headers = normalizeHeaderMap(input.headers);
  const preflight =
    input.method.trim().toUpperCase() === "OPTIONS" &&
    headers["access-control-request-method"] !== undefined;
  return {
    routeId: input.routeId,
    origin: headers.origin,
    method: preflight ? headers["access-control-request-method"]! : input.method,
    requestHeaders: parseAccessControlRequestHeaders(headers["access-control-request-headers"]),
    preflight,
  };
}

export function mergeCorsPolicies(base: CorsPolicy, override: Partial<CorsPolicy>): CorsPolicy {
  return normalizeCorsPolicy({
    routeId: override.routeId ?? base.routeId,
    allowedOrigins: override.allowedOrigins ?? base.allowedOrigins,
    allowedMethods: override.allowedMethods ?? base.allowedMethods,
    allowedHeaders: override.allowedHeaders ?? base.allowedHeaders,
    exposedHeaders: override.exposedHeaders ?? base.exposedHeaders,
    allowCredentials: override.allowCredentials ?? base.allowCredentials,
    maxAgeSeconds: override.maxAgeSeconds ?? base.maxAgeSeconds,
  });
}

export function parseAccessControlRequestHeaders(value?: string): string[] {
  if (!value) return [];
  return value.split(",").map(normalizeHeader).filter(Boolean);
}

function normalizeHeaderMap(headers: Record<string, string | undefined>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    normalized[normalizeHeader(key)] = value.trim();
  }
  return normalized;
}

function allow(policy: CorsPolicy, origin: string | undefined, preflight: boolean): CorsDecision {
  const headers: Record<string, string> = {};
  if (origin) {
    headers["access-control-allow-origin"] = policy.allowedOrigins.includes("*") ? "*" : origin;
    headers.vary = "Origin";
  }
  if (policy.allowCredentials) headers["access-control-allow-credentials"] = "true";
  if (preflight) {
    headers["access-control-allow-methods"] = policy.allowedMethods.join(", ");
    headers["access-control-allow-headers"] = policy.allowedHeaders.join(", ");
    if (policy.maxAgeSeconds !== undefined) {
      headers["access-control-max-age"] = String(policy.maxAgeSeconds);
    }
  } else if (policy.exposedHeaders && policy.exposedHeaders.length > 0) {
    headers["access-control-expose-headers"] = policy.exposedHeaders.join(", ");
  }
  return { kind: "allow", routeId: policy.routeId, statusCode: preflight ? 204 : 200, headers };
}

function reject(routeId: string, statusCode: number, reason: CorsDecision["reason"]): CorsDecision {
  return { kind: "reject", routeId, statusCode, reason, headers: { vary: "Origin" } };
}

function isOriginAllowed(policy: CorsPolicy, origin: string): boolean {
  return policy.allowedOrigins.includes("*") || policy.allowedOrigins.includes(origin);
}

function normalizeOrigin(origin: string): string {
  assertNonEmpty(origin, "origin");
  return origin.trim().replace(/\/$/, "").toLowerCase();
}

function normalizeHeader(header: string): string {
  assertNonEmpty(header, "header");
  return header.trim().toLowerCase();
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

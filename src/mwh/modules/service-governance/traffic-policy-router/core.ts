export type TrafficEndpointStatus = "healthy" | "degraded" | "unhealthy";

export interface TrafficEndpoint {
  id: string;
  url: string;
  weight: number;
  status: TrafficEndpointStatus;
  metadata: Record<string, string>;
}

export interface TrafficRouteRule {
  id: string;
  priority: number;
  match: Record<string, string>;
  endpointIds: string[];
}

export interface TrafficPolicy {
  serviceName: string;
  endpoints: TrafficEndpoint[];
  rules: TrafficRouteRule[];
  fallbackEndpointIds: string[];
  includeDegraded: boolean;
}

export interface TrafficRouteRequest {
  serviceName: string;
  key: string;
  attributes?: Record<string, string>;
}

export interface TrafficRouteDecision {
  serviceName: string;
  endpoint: TrafficEndpoint | null;
  ruleId?: string;
  reason: "rule" | "fallback" | "no-endpoint";
  hash: number;
  decidedAtMs: number;
}

export function createTrafficEndpoint(input: {
  id: string;
  url: string;
  weight?: number;
  status?: TrafficEndpointStatus;
  metadata?: Record<string, string>;
}): TrafficEndpoint {
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.url, "url");
  assertWeight(input.weight ?? 1);
  return {
    id: input.id,
    url: input.url,
    weight: input.weight ?? 1,
    status: input.status ?? "healthy",
    metadata: { ...(input.metadata ?? {}) },
  };
}

export function createTrafficPolicy(input: {
  serviceName: string;
  endpoints: readonly TrafficEndpoint[];
  rules?: readonly TrafficRouteRule[];
  fallbackEndpointIds?: readonly string[];
  includeDegraded?: boolean;
}): TrafficPolicy {
  assertNonEmpty(input.serviceName, "serviceName");
  const endpoints = input.endpoints
    .map(cloneTrafficEndpoint)
    .sort((a, b) => a.id.localeCompare(b.id));
  const endpointIds = new Set(endpoints.map((endpoint) => endpoint.id));
  const rules = (input.rules ?? []).map((rule) => normalizeRule(rule, endpointIds));
  const fallbackEndpointIds =
    input.fallbackEndpointIds && input.fallbackEndpointIds.length > 0
      ? [...input.fallbackEndpointIds]
      : endpoints.map((endpoint) => endpoint.id);
  for (const endpointId of fallbackEndpointIds) {
    if (!endpointIds.has(endpointId)) throw new Error(`unknown fallback endpoint: ${endpointId}`);
  }
  return {
    serviceName: input.serviceName,
    endpoints,
    rules: rules.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id)),
    fallbackEndpointIds,
    includeDegraded: input.includeDegraded ?? false,
  };
}

export function matchTrafficRule(
  rule: TrafficRouteRule,
  attributes: Record<string, string> = {},
): boolean {
  return Object.entries(rule.match).every(([key, value]) => attributes[key] === value);
}

export function routeTraffic(
  policy: TrafficPolicy,
  request: TrafficRouteRequest,
  input: { nowMs: number },
): TrafficRouteDecision {
  assertNonEmpty(request.serviceName, "serviceName");
  assertNonEmpty(request.key, "key");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (request.serviceName !== policy.serviceName) {
    throw new Error("request serviceName does not match policy serviceName");
  }
  const hash = stableHash(`${request.serviceName}:${request.key}`);
  const rule = policy.rules.find((candidate) => matchTrafficRule(candidate, request.attributes));
  const candidateIds = rule?.endpointIds ?? policy.fallbackEndpointIds;
  const endpoint = selectWeightedEndpoint(policy, candidateIds, hash);
  return {
    serviceName: request.serviceName,
    endpoint,
    ruleId: rule?.id,
    reason: endpoint ? (rule ? "rule" : "fallback") : "no-endpoint",
    hash,
    decidedAtMs: input.nowMs,
  };
}

export function selectWeightedEndpoint(
  policy: TrafficPolicy,
  endpointIds: readonly string[],
  hash: number,
): TrafficEndpoint | null {
  const endpoints = endpointIds
    .map((id) => policy.endpoints.find((endpoint) => endpoint.id === id))
    .filter((endpoint): endpoint is TrafficEndpoint => Boolean(endpoint))
    .filter(
      (endpoint) =>
        endpoint.status === "healthy" || (policy.includeDegraded && endpoint.status === "degraded"),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  const totalWeight = endpoints.reduce((sum, endpoint) => sum + endpoint.weight, 0);
  if (totalWeight <= 0) return null;
  let slot = hash % totalWeight;
  for (const endpoint of endpoints) {
    if (slot < endpoint.weight) return cloneTrafficEndpoint(endpoint);
    slot -= endpoint.weight;
  }
  return endpoints.length > 0
    ? cloneTrafficEndpoint(endpoints[endpoints.length - 1] as TrafficEndpoint)
    : null;
}

export function updateTrafficEndpointStatus(
  policy: TrafficPolicy,
  input: { endpointId: string; status: TrafficEndpointStatus },
): TrafficPolicy {
  if (!policy.endpoints.some((endpoint) => endpoint.id === input.endpointId)) {
    throw new Error(`unknown endpoint: ${input.endpointId}`);
  }
  return {
    ...policy,
    endpoints: policy.endpoints.map((endpoint) =>
      endpoint.id === input.endpointId
        ? { ...endpoint, status: input.status }
        : cloneTrafficEndpoint(endpoint),
    ),
    rules: policy.rules.map(cloneTrafficRule),
    fallbackEndpointIds: [...policy.fallbackEndpointIds],
  };
}

export function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

export function cloneTrafficPolicy(policy: TrafficPolicy): TrafficPolicy {
  return {
    ...policy,
    endpoints: policy.endpoints.map(cloneTrafficEndpoint),
    rules: policy.rules.map(cloneTrafficRule),
    fallbackEndpointIds: [...policy.fallbackEndpointIds],
  };
}

export function cloneTrafficEndpoint(endpoint: TrafficEndpoint): TrafficEndpoint {
  return { ...endpoint, metadata: { ...endpoint.metadata } };
}

function cloneTrafficRule(rule: TrafficRouteRule): TrafficRouteRule {
  return {
    ...rule,
    match: { ...rule.match },
    endpointIds: [...rule.endpointIds],
  };
}

function normalizeRule(rule: TrafficRouteRule, endpointIds: ReadonlySet<string>): TrafficRouteRule {
  assertNonEmpty(rule.id, "rule.id");
  assertNonNegativeInteger(rule.priority, "rule.priority");
  if (Object.keys(rule.match).length === 0) throw new Error("rule.match is required");
  if (rule.endpointIds.length === 0) throw new Error("rule.endpointIds is required");
  for (const endpointId of rule.endpointIds) {
    if (!endpointIds.has(endpointId)) throw new Error(`unknown rule endpoint: ${endpointId}`);
  }
  return cloneTrafficRule(rule);
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertWeight(value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("weight must be a non-negative integer");
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

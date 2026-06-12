export type ServiceInstanceStatus = "passing" | "warning" | "critical";

export interface ServiceInstance {
  serviceName: string;
  instanceId: string;
  address: string;
  port: number;
  protocol: "http" | "https" | "grpc" | "tcp";
  status: ServiceInstanceStatus;
  metadata: Record<string, string>;
  registeredAtMs: number;
  lastHeartbeatAtMs: number;
  ttlMs: number;
  load: number;
}

export interface ServiceEndpoint {
  serviceName: string;
  instanceId: string;
  url: string;
  metadata: Record<string, string>;
  load: number;
}

export interface ServiceDiscoveryResult {
  serviceName: string;
  endpoints: ServiceEndpoint[];
  generatedAtMs: number;
}

export interface ServiceRegistrySnapshot {
  services: Record<string, ServiceEndpoint[]>;
  generatedAtMs: number;
}

export interface ServiceSelectionResult {
  endpoint: ServiceEndpoint | null;
  nextCursor: number;
}

export function createServiceInstance(input: {
  serviceName: string;
  instanceId: string;
  address: string;
  port: number;
  nowMs: number;
  ttlMs: number;
  protocol?: ServiceInstance["protocol"];
  status?: ServiceInstanceStatus;
  metadata?: Record<string, string>;
  load?: number;
}): ServiceInstance {
  assertNonEmpty(input.serviceName, "serviceName");
  assertNonEmpty(input.instanceId, "instanceId");
  assertNonEmpty(input.address, "address");
  assertPort(input.port);
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.ttlMs, "ttlMs");
  assertLoad(input.load ?? 0);
  return {
    serviceName: input.serviceName,
    instanceId: input.instanceId,
    address: input.address,
    port: input.port,
    protocol: input.protocol ?? "http",
    status: input.status ?? "passing",
    metadata: { ...(input.metadata ?? {}) },
    registeredAtMs: input.nowMs,
    lastHeartbeatAtMs: input.nowMs,
    ttlMs: input.ttlMs,
    load: input.load ?? 0,
  };
}

export function refreshServiceInstance(
  instance: ServiceInstance,
  input: {
    nowMs: number;
    status?: ServiceInstanceStatus;
    metadata?: Record<string, string>;
    load?: number;
  },
): ServiceInstance {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (input.nowMs < instance.registeredAtMs) {
    throw new Error("nowMs must not be earlier than registeredAtMs");
  }
  if (input.load !== undefined) assertLoad(input.load);
  return {
    ...instance,
    status: input.status ?? instance.status,
    metadata: input.metadata ? { ...input.metadata } : { ...instance.metadata },
    lastHeartbeatAtMs: input.nowMs,
    load: input.load ?? instance.load,
  };
}

export function isServiceInstanceExpired(
  instance: ServiceInstance,
  input: { nowMs: number },
): boolean {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  return input.nowMs - instance.lastHeartbeatAtMs >= instance.ttlMs;
}

export function serviceInstanceKey(input: {
  serviceName: string;
  instanceId: string;
}): string {
  assertNonEmpty(input.serviceName, "serviceName");
  assertNonEmpty(input.instanceId, "instanceId");
  return `${input.serviceName}\0${input.instanceId}`;
}

export function serviceEndpoint(instance: ServiceInstance): ServiceEndpoint {
  return {
    serviceName: instance.serviceName,
    instanceId: instance.instanceId,
    url: `${instance.protocol}://${instance.address}:${instance.port}`,
    metadata: { ...instance.metadata },
    load: instance.load,
  };
}

export function discoverServiceInstances(
  instances: readonly ServiceInstance[],
  input: { serviceName: string; nowMs: number; includeWarning?: boolean },
): ServiceDiscoveryResult {
  assertNonEmpty(input.serviceName, "serviceName");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const endpoints = instances
    .filter((instance) => instance.serviceName === input.serviceName)
    .filter((instance) => !isServiceInstanceExpired(instance, { nowMs: input.nowMs }))
    .filter(
      (instance) =>
        instance.status === "passing" || (input.includeWarning && instance.status === "warning"),
    )
    .map(serviceEndpoint)
    .sort((a, b) => a.instanceId.localeCompare(b.instanceId));
  return { serviceName: input.serviceName, endpoints, generatedAtMs: input.nowMs };
}

export function selectServiceEndpoint(
  discovery: ServiceDiscoveryResult,
  input: { cursor?: number; strategy?: "round-robin" | "least-load" },
): ServiceSelectionResult {
  if (discovery.endpoints.length === 0) return { endpoint: null, nextCursor: input.cursor ?? 0 };
  const strategy = input.strategy ?? "round-robin";
  if (strategy === "least-load") {
    const sorted = [...discovery.endpoints].sort(
      (a, b) => a.load - b.load || a.instanceId.localeCompare(b.instanceId),
    );
    const endpoint = sorted[0];
    if (!endpoint) return { endpoint: null, nextCursor: input.cursor ?? 0 };
    return { endpoint, nextCursor: input.cursor ?? 0 };
  }
  const cursor = input.cursor ?? 0;
  const index = positiveModulo(cursor, discovery.endpoints.length);
  const endpoint = discovery.endpoints[index];
  if (!endpoint) return { endpoint: null, nextCursor: 0 };
  return {
    endpoint,
    nextCursor: positiveModulo(index + 1, discovery.endpoints.length),
  };
}

export function createServiceRegistrySnapshot(
  instances: readonly ServiceInstance[],
  input: { nowMs: number; includeWarning?: boolean },
): ServiceRegistrySnapshot {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const serviceNames = [...new Set(instances.map((instance) => instance.serviceName))].sort();
  const services: Record<string, ServiceEndpoint[]> = {};
  for (const serviceName of serviceNames) {
    services[serviceName] = discoverServiceInstances(instances, {
      serviceName,
      nowMs: input.nowMs,
      includeWarning: input.includeWarning,
    }).endpoints;
  }
  return { services, generatedAtMs: input.nowMs };
}

export function cloneServiceInstance(instance: ServiceInstance): ServiceInstance {
  return { ...instance, metadata: { ...instance.metadata } };
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertPort(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error("port must be an integer between 1 and 65535");
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertLoad(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error("load must be a non-negative finite number");
  }
}

function positiveModulo(value: number, size: number): number {
  return ((value % size) + size) % size;
}

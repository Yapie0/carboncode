import {
  type ServiceDiscoveryResult,
  type ServiceEndpoint,
  type ServiceInstance,
  type ServiceInstanceStatus,
  type ServiceRegistrySnapshot,
  cloneServiceInstance,
  createServiceInstance,
  createServiceRegistrySnapshot,
  discoverServiceInstances,
  isServiceInstanceExpired,
  refreshServiceInstance,
  selectServiceEndpoint,
  serviceInstanceKey,
} from "./core.js";

export interface MemoryServiceRegistryOptions {
  now?: () => number;
  defaultTtlMs?: number;
}

export class MemoryServiceRegistry {
  private readonly now: () => number;
  private readonly defaultTtlMs: number;
  private readonly instances = new Map<string, ServiceInstance>();
  private readonly cursors = new Map<string, number>();

  constructor(opts: MemoryServiceRegistryOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.defaultTtlMs = opts.defaultTtlMs ?? 30_000;
    if (!Number.isInteger(this.defaultTtlMs) || this.defaultTtlMs <= 0) {
      throw new Error("defaultTtlMs must be a positive integer");
    }
  }

  register(input: {
    serviceName: string;
    instanceId: string;
    address: string;
    port: number;
    protocol?: ServiceInstance["protocol"];
    status?: ServiceInstanceStatus;
    metadata?: Record<string, string>;
    ttlMs?: number;
    load?: number;
  }): ServiceInstance {
    const instance = createServiceInstance({
      ...input,
      nowMs: this.now(),
      ttlMs: input.ttlMs ?? this.defaultTtlMs,
    });
    this.instances.set(serviceInstanceKey(instance), instance);
    return cloneServiceInstance(instance);
  }

  heartbeat(input: {
    serviceName: string;
    instanceId: string;
    status?: ServiceInstanceStatus;
    metadata?: Record<string, string>;
    load?: number;
  }): ServiceInstance | null {
    const key = serviceInstanceKey(input);
    const current = this.instances.get(key);
    if (!current) return null;
    const next = refreshServiceInstance(current, { ...input, nowMs: this.now() });
    this.instances.set(key, next);
    return cloneServiceInstance(next);
  }

  deregister(input: { serviceName: string; instanceId: string }): boolean {
    return this.instances.delete(serviceInstanceKey(input));
  }

  discover(input: {
    serviceName: string;
    includeWarning?: boolean;
  }): ServiceDiscoveryResult {
    return discoverServiceInstances([...this.instances.values()], {
      serviceName: input.serviceName,
      nowMs: this.now(),
      includeWarning: input.includeWarning,
    });
  }

  resolve(input: {
    serviceName: string;
    includeWarning?: boolean;
    strategy?: "round-robin" | "least-load";
  }): ServiceEndpoint | null {
    const discovery = this.discover(input);
    const cursorKey = `${input.serviceName}\0${input.strategy ?? "round-robin"}`;
    const selected = selectServiceEndpoint(discovery, {
      cursor: this.cursors.get(cursorKey) ?? 0,
      strategy: input.strategy,
    });
    this.cursors.set(cursorKey, selected.nextCursor);
    return selected.endpoint
      ? { ...selected.endpoint, metadata: { ...selected.endpoint.metadata } }
      : null;
  }

  pruneExpired(): ServiceInstance[] {
    const nowMs = this.now();
    const expired: ServiceInstance[] = [];
    for (const [key, instance] of this.instances) {
      if (!isServiceInstanceExpired(instance, { nowMs })) continue;
      this.instances.delete(key);
      expired.push(cloneServiceInstance(instance));
    }
    return expired.sort(
      (a, b) =>
        a.serviceName.localeCompare(b.serviceName) || a.instanceId.localeCompare(b.instanceId),
    );
  }

  snapshot(input: { includeWarning?: boolean } = {}): ServiceRegistrySnapshot {
    return createServiceRegistrySnapshot([...this.instances.values()], {
      nowMs: this.now(),
      includeWarning: input.includeWarning,
    });
  }

  list(): ServiceInstance[] {
    return [...this.instances.values()]
      .map(cloneServiceInstance)
      .sort(
        (a, b) =>
          a.serviceName.localeCompare(b.serviceName) || a.instanceId.localeCompare(b.instanceId),
      );
  }
}

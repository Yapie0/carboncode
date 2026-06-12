import { describe, expect, it } from "vitest";
import {
  createServiceInstance,
  createServiceRegistrySnapshot,
  discoverServiceInstances,
  isServiceInstanceExpired,
  refreshServiceInstance,
  selectServiceEndpoint,
  serviceEndpoint,
  serviceInstanceKey,
} from "../src/mwh/modules/service-governance/service-registry/core.js";
import { MemoryServiceRegistry } from "../src/mwh/modules/service-governance/service-registry/memory-registry.js";

describe("MWH service-registry middleware", () => {
  it("creates instances, refreshes heartbeat state, and maps endpoints", () => {
    const instance = createServiceInstance({
      serviceName: "api",
      instanceId: "api-1",
      address: "127.0.0.1",
      port: 3000,
      protocol: "http",
      nowMs: 1_000,
      ttlMs: 500,
      metadata: { zone: "local" },
    });

    expect(instance).toEqual({
      serviceName: "api",
      instanceId: "api-1",
      address: "127.0.0.1",
      port: 3000,
      protocol: "http",
      status: "passing",
      metadata: { zone: "local" },
      registeredAtMs: 1_000,
      lastHeartbeatAtMs: 1_000,
      ttlMs: 500,
      load: 0,
    });
    expect(serviceInstanceKey(instance)).toBe("api\0api-1");
    expect(serviceEndpoint(instance)).toEqual({
      serviceName: "api",
      instanceId: "api-1",
      url: "http://127.0.0.1:3000",
      metadata: { zone: "local" },
      load: 0,
    });

    const refreshed = refreshServiceInstance(instance, {
      nowMs: 1_250,
      status: "warning",
      metadata: { zone: "local", draining: "true" },
      load: 0.9,
    });
    expect(refreshed).toEqual({
      ...instance,
      status: "warning",
      metadata: { zone: "local", draining: "true" },
      lastHeartbeatAtMs: 1_250,
      load: 0.9,
    });
  });

  it("filters expired and unhealthy instances during discovery", () => {
    const passing = createServiceInstance({
      serviceName: "api",
      instanceId: "api-1",
      address: "10.0.0.1",
      port: 3000,
      nowMs: 1_000,
      ttlMs: 1_000,
    });
    const warning = createServiceInstance({
      serviceName: "api",
      instanceId: "api-2",
      address: "10.0.0.2",
      port: 3000,
      status: "warning",
      nowMs: 1_500,
      ttlMs: 1_000,
    });
    const critical = createServiceInstance({
      serviceName: "api",
      instanceId: "api-3",
      address: "10.0.0.3",
      port: 3000,
      status: "critical",
      nowMs: 1_500,
      ttlMs: 1_000,
    });
    const expired = createServiceInstance({
      serviceName: "api",
      instanceId: "api-0",
      address: "10.0.0.0",
      port: 3000,
      nowMs: 500,
      ttlMs: 1_000,
    });

    expect(isServiceInstanceExpired(expired, { nowMs: 1_500 })).toBe(true);
    expect(
      discoverServiceInstances([passing, warning, critical, expired], {
        serviceName: "api",
        nowMs: 1_500,
      }).endpoints.map((endpoint) => endpoint.instanceId),
    ).toEqual(["api-1"]);
    expect(
      discoverServiceInstances([passing, warning, critical, expired], {
        serviceName: "api",
        nowMs: 1_500,
        includeWarning: true,
      }).endpoints.map((endpoint) => endpoint.instanceId),
    ).toEqual(["api-1", "api-2"]);
  });

  it("selects endpoints by round-robin or least-load with deterministic snapshots", () => {
    const instances = [
      createServiceInstance({
        serviceName: "api",
        instanceId: "api-b",
        address: "10.0.0.2",
        port: 3000,
        nowMs: 1_000,
        ttlMs: 1_000,
        load: 0.1,
      }),
      createServiceInstance({
        serviceName: "api",
        instanceId: "api-a",
        address: "10.0.0.1",
        port: 3000,
        nowMs: 1_000,
        ttlMs: 1_000,
        load: 0.7,
      }),
    ];
    const discovery = discoverServiceInstances(instances, { serviceName: "api", nowMs: 1_100 });

    expect(discovery.endpoints.map((endpoint) => endpoint.instanceId)).toEqual(["api-a", "api-b"]);
    expect(selectServiceEndpoint(discovery, { cursor: 0 })).toEqual({
      endpoint: expect.objectContaining({ instanceId: "api-a" }),
      nextCursor: 1,
    });
    expect(selectServiceEndpoint(discovery, { cursor: 1 })).toEqual({
      endpoint: expect.objectContaining({ instanceId: "api-b" }),
      nextCursor: 0,
    });
    expect(selectServiceEndpoint(discovery, { strategy: "least-load" })).toEqual({
      endpoint: expect.objectContaining({ instanceId: "api-b" }),
      nextCursor: 0,
    });
    expect(createServiceRegistrySnapshot(instances, { nowMs: 1_100 })).toEqual({
      generatedAtMs: 1_100,
      services: {
        api: [
          expect.objectContaining({ instanceId: "api-a" }),
          expect.objectContaining({ instanceId: "api-b" }),
        ],
      },
    });
  });

  it("runs a stateful register, heartbeat, resolve, deregister, and prune flow", () => {
    let now = 1_000;
    const registry = new MemoryServiceRegistry({ now: () => now, defaultTtlMs: 500 });

    registry.register({
      serviceName: "api",
      instanceId: "api-1",
      address: "10.0.0.1",
      port: 3000,
      load: 0.8,
    });
    registry.register({
      serviceName: "api",
      instanceId: "api-2",
      address: "10.0.0.2",
      port: 3000,
      load: 0.2,
    });

    expect(registry.resolve({ serviceName: "api" })).toEqual(
      expect.objectContaining({ instanceId: "api-1" }),
    );
    expect(registry.resolve({ serviceName: "api" })).toEqual(
      expect.objectContaining({ instanceId: "api-2" }),
    );
    expect(registry.resolve({ serviceName: "api", strategy: "least-load" })).toEqual(
      expect.objectContaining({ instanceId: "api-2" }),
    );

    now = 1_200;
    expect(
      registry.heartbeat({
        serviceName: "api",
        instanceId: "api-1",
        status: "warning",
        load: 0.1,
      }),
    ).toEqual(expect.objectContaining({ status: "warning", lastHeartbeatAtMs: 1_200 }));
    expect(
      registry.discover({ serviceName: "api" }).endpoints.map((item) => item.instanceId),
    ).toEqual(["api-2"]);
    expect(
      registry
        .discover({ serviceName: "api", includeWarning: true })
        .endpoints.map((item) => item.instanceId),
    ).toEqual(["api-1", "api-2"]);

    now = 1_600;
    expect(registry.pruneExpired().map((instance) => instance.instanceId)).toEqual(["api-2"]);
    expect(registry.deregister({ serviceName: "api", instanceId: "api-1" })).toBe(true);
    expect(registry.resolve({ serviceName: "api", includeWarning: true })).toBeNull();
  });

  it("keeps returned state clone-safe", () => {
    const registry = new MemoryServiceRegistry({ now: () => 1_000 });
    const registered = registry.register({
      serviceName: "api",
      instanceId: "api-1",
      address: "10.0.0.1",
      port: 3000,
      metadata: { zone: "a" },
    });
    registered.metadata.zone = "mutated";

    expect(registry.list()[0]?.metadata).toEqual({ zone: "a" });
    expect(registry.snapshot()).toEqual({
      generatedAtMs: 1_000,
      services: {
        api: [expect.objectContaining({ metadata: { zone: "a" } })],
      },
    });
  });
});

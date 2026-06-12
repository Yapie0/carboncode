import { describe, expect, it } from "vitest";
import {
  createEventEnvelope,
  createEventSubscription,
  createPublishRecord,
  createTopicBinding,
  patternMatches,
  planEventBusDeliveries,
  planEventBusDeliveryRecords,
  resolveEventTopic,
} from "../src/mwh/modules/eventing/event-bus-adapter/core.js";
import { MemoryEventBusBroker } from "../src/mwh/modules/eventing/event-bus-adapter/memory-broker.js";

describe("MWH event-bus-adapter stateless core", () => {
  it("creates envelopes and clones payload/header state", () => {
    const payload = { userId: "u1" };
    const envelope = createEventEnvelope({
      id: "evt-1",
      type: "user.created",
      source: "accounts",
      subject: "user:u1",
      payload,
      occurredAtMs: 1_000,
      headers: { traceId: "t1" },
    });
    payload.userId = "mutated";

    expect(envelope).toEqual({
      id: "evt-1",
      type: "user.created",
      source: "accounts",
      subject: "user:u1",
      payload: { userId: "u1" },
      occurredAtMs: 1_000,
      headers: { traceId: "t1" },
    });
  });

  it("matches wildcard event patterns and resolves topics", () => {
    expect(patternMatches("user.*", "user.created")).toBe(true);
    expect(patternMatches("billing.#", "billing.invoice.failed")).toBe(true);
    expect(patternMatches("user.deleted", "user.created")).toBe(false);
    const envelope = createEventEnvelope({
      id: "evt-1",
      type: "billing.invoice.failed",
      source: "billing",
      subject: "invoice:1",
      payload: {},
      occurredAtMs: 1_000,
    });
    expect(
      resolveEventTopic(envelope, [
        createTopicBinding({ eventTypePattern: "user.#", topic: "users" }),
        createTopicBinding({ eventTypePattern: "billing.#", topic: "billing-events" }),
      ]),
    ).toBe("billing-events");
  });

  it("plans subscription deliveries and publish audit records", () => {
    const envelope = createEventEnvelope({
      id: "evt-1",
      type: "user.created",
      source: "accounts",
      subject: "user:u1",
      payload: {},
      occurredAtMs: 1_000,
    });
    const subscriptions = [
      createEventSubscription({ id: "sub-b", topic: "users", consumerGroup: "emails" }),
      createEventSubscription({
        id: "sub-a",
        topic: "users",
        consumerGroup: "audit",
        eventTypePattern: "user.*",
      }),
      createEventSubscription({ id: "sub-c", topic: "billing", consumerGroup: "billing" }),
    ];

    expect(planEventBusDeliveries({ envelope, topic: "users", subscriptions })).toEqual([
      "sub-a",
      "sub-b",
    ]);
    expect(
      createPublishRecord({
        envelope,
        topic: "users",
        subscriptionIds: ["sub-b", "sub-a"],
        nowMs: 1_010,
      }),
    ).toEqual({
      envelopeId: "evt-1",
      topic: "users",
      publishedAtMs: 1_010,
      subscriptionIds: ["sub-a", "sub-b"],
    });
    expect(
      planEventBusDeliveryRecords({
        envelope,
        topic: "users",
        offset: 3,
        subscriptions,
      }),
    ).toEqual([
      expect.objectContaining({
        subscriptionId: "sub-a",
        consumerGroup: "audit",
        offset: 3,
        envelope: expect.objectContaining({ id: "evt-1" }),
      }),
      expect.objectContaining({
        subscriptionId: "sub-b",
        consumerGroup: "emails",
        offset: 3,
      }),
    ]);
  });
});

describe("MWH event-bus-adapter stateful memory broker", () => {
  it("binds, subscribes, publishes, audits, and preserves clone safety", () => {
    let now = 1_000;
    const broker = new MemoryEventBusBroker({ now: () => now });
    broker.bind({ eventTypePattern: "user.#", topic: "users" });
    broker.subscribe({ id: "sub-1", topic: "users", consumerGroup: "audit" });
    broker.subscribe({
      id: "sub-2",
      topic: "users",
      consumerGroup: "emails",
      eventTypePattern: "user.created",
    });

    const result = broker.publish({
      id: "evt-1",
      type: "user.created",
      source: "accounts",
      subject: "user:u1",
      payload: { userId: "u1" },
    });
    result.envelope.payload = { userId: "mutated" };
    expect(result).toEqual(
      expect.objectContaining({ topic: "users", subscriptionIds: ["sub-1", "sub-2"] }),
    );
    expect(broker.readTopic("users")[0]?.payload).toEqual({ userId: "u1" });
    const deliveries = broker.readSubscription("sub-2");
    deliveries[0]!.envelope.payload = { userId: "mutated-again" };
    expect(deliveries).toEqual([
      expect.objectContaining({
        subscriptionId: "sub-2",
        consumerGroup: "emails",
        topic: "users",
        offset: 0,
        envelope: expect.objectContaining({ id: "evt-1" }),
      }),
    ]);
    expect(broker.readSubscription("sub-2")[0]?.envelope.payload).toEqual({ userId: "u1" });
    expect(broker.ack("sub-2", 0)).toBe(1);
    expect(broker.readSubscription("sub-2")).toEqual([]);

    now = 1_100;
    broker.publish({
      id: "evt-2",
      type: "billing.invoice.failed",
      source: "billing",
      subject: "invoice:1",
      payload: {},
    });
    expect(broker.readTopic("billing.invoice.failed")).toHaveLength(1);
    expect(broker.readSubscription("sub-1").map((delivery) => delivery.envelope.id)).toEqual([
      "evt-1",
    ]);
    expect(broker.listPublishRecords().map((record) => record.envelopeId)).toEqual([
      "evt-1",
      "evt-2",
    ]);
  });

  it("rejects duplicate subscriptions and supports unsubscribe", () => {
    const broker = new MemoryEventBusBroker({ now: () => 1_000 });
    broker.subscribe({ id: "sub-1", topic: "users", consumerGroup: "audit" });
    expect(() => broker.subscribe({ id: "sub-1", topic: "users", consumerGroup: "audit" })).toThrow(
      "subscription already exists",
    );
    expect(broker.unsubscribe("sub-1")).toBe(true);
    expect(() => broker.readSubscription("sub-1")).toThrow("subscription not found");
    expect(
      broker.publish({
        id: "evt-1",
        type: "users",
        source: "test",
        subject: "s1",
        payload: {},
      }).subscriptionIds,
    ).toEqual([]);
  });

  it("supports inactive subscriptions, filtered reads, limits, and offset validation", () => {
    const broker = new MemoryEventBusBroker({ now: () => 1_000 });
    broker.bind({ eventTypePattern: "user.#", topic: "users" });
    broker.subscribe({
      id: "sub-1",
      topic: "users",
      consumerGroup: "audit",
      eventTypePattern: "user.created",
    });
    broker.publish({
      id: "evt-1",
      type: "user.created",
      source: "accounts",
      subject: "user:u1",
      payload: {},
    });
    broker.publish({
      id: "evt-2",
      type: "user.deleted",
      source: "accounts",
      subject: "user:u1",
      payload: {},
    });
    broker.publish({
      id: "evt-3",
      type: "user.created",
      source: "accounts",
      subject: "user:u2",
      payload: {},
    });

    expect(broker.readSubscription("sub-1", 1).map((delivery) => delivery.envelope.id)).toEqual([
      "evt-1",
    ]);
    expect(broker.ack("sub-1", 0)).toBe(1);
    expect(broker.readSubscription("sub-1").map((delivery) => delivery.envelope.id)).toEqual([
      "evt-3",
    ]);
    expect(() => broker.ack("sub-1", 99)).toThrow("offset is outside topic range");
    expect(broker.setSubscriptionActive("sub-1", false).active).toBe(false);
    expect(broker.readSubscription("sub-1")).toEqual([]);
    expect(broker.subscriptionOffset("sub-1")).toBe(1);
  });
});

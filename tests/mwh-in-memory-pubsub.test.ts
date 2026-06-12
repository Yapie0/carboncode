import { describe, expect, it } from "vitest";
import {
  clonePubSubEvent,
  createPubSubEvent,
  createSubscription,
  deactivateSubscription,
  planDeliveries,
  topicMatches,
} from "../src/mwh/modules/eventing/in-memory-pubsub/core.js";
import { MemoryPubSubBus } from "../src/mwh/modules/eventing/in-memory-pubsub/memory-bus.js";

describe("MWH in-memory-pubsub middleware", () => {
  it("creates event envelopes and subscriptions", () => {
    expect(
      createPubSubEvent({
        id: "evt-1",
        topic: "user.created",
        payload: { userId: "u1" },
        nowMs: 1_000,
        metadata: { source: "test" },
      }),
    ).toEqual({
      id: "evt-1",
      topic: "user.created",
      payload: { userId: "u1" },
      createdAtMs: 1_000,
      metadata: { source: "test" },
    });
    expect(createSubscription({ id: "sub-1", topicPattern: "user.*", once: true })).toEqual({
      id: "sub-1",
      topicPattern: "user.*",
      once: true,
      active: true,
    });
  });

  it("matches exact, single-segment, and multi-segment topic patterns", () => {
    expect(topicMatches("user.created", "user.created")).toBe(true);
    expect(topicMatches("user.*", "user.created")).toBe(true);
    expect(topicMatches("user.*", "user.profile.updated")).toBe(false);
    expect(topicMatches("user.#", "user.profile.updated")).toBe(true);
    expect(topicMatches("*", "anything.deep")).toBe(true);
    expect(() => topicMatches("user.#.updated", "user.profile.updated")).toThrow(
      "topicPattern # wildcard must be the final segment",
    );
  });

  it("clones event payload and metadata for safe handoff", () => {
    const original = createPubSubEvent({
      id: "evt-1",
      topic: "user.created",
      payload: { nested: { userId: "u1" } },
      nowMs: 1_000,
      metadata: { source: "test" },
    });
    const cloned = clonePubSubEvent(original);
    cloned.payload.nested.userId = "mutated";
    cloned.metadata!.source = "mutated";

    expect(original.payload.nested.userId).toBe("u1");
    expect(original.metadata?.source).toBe("test");
  });

  it("plans deliveries only for active matching subscriptions", () => {
    const event = createPubSubEvent({
      id: "evt-1",
      topic: "user.created",
      payload: {},
      nowMs: 1_000,
    });
    const active = createSubscription({ id: "sub-1", topicPattern: "user.*" });
    const once = createSubscription({ id: "sub-2", topicPattern: "user.created", once: true });
    const inactive = deactivateSubscription(
      createSubscription({ id: "sub-3", topicPattern: "user.#" }),
    );

    expect(planDeliveries(event, [active, once, inactive])).toEqual([
      {
        eventId: "evt-1",
        subscriptionId: "sub-1",
        topic: "user.created",
        removeAfterDelivery: false,
      },
      {
        eventId: "evt-1",
        subscriptionId: "sub-2",
        topic: "user.created",
        removeAfterDelivery: true,
      },
    ]);
  });

  it("publishes to matching subscribers, removes once subscribers, and records history", () => {
    let now = 1_000;
    const bus = new MemoryPubSubBus({ now: () => now, idFactory: () => "generated" });
    const received: string[] = [];

    bus.subscribe({ id: "sub-1", topicPattern: "user.*" }, (event) => {
      received.push(`regular:${event.topic}`);
    });
    bus.subscribe({ id: "sub-2", topicPattern: "user.created", once: true }, (event) => {
      received.push(`once:${event.topic}`);
    });

    expect(bus.publish({ id: "evt-1", topic: "user.created", payload: { userId: "u1" } })).toEqual(
      expect.objectContaining({ delivered: 2, errors: [] }),
    );
    now = 1_001;
    expect(bus.publish({ id: "evt-2", topic: "user.created", payload: {} })).toEqual(
      expect.objectContaining({ delivered: 1, errors: [] }),
    );
    expect(received).toEqual(["regular:user.created", "once:user.created", "regular:user.created"]);
    expect(bus.listSubscriptions().map((subscription) => subscription.id)).toEqual(["sub-1"]);
    expect(bus.listHistory().map((event) => event.id)).toEqual(["evt-1", "evt-2"]);
    expect(bus.listDeliveries().map((entry) => entry.subscriptionId)).toEqual([
      "sub-1",
      "sub-2",
      "sub-1",
    ]);
  });

  it("isolates handler errors and continues delivering to other subscribers", () => {
    const bus = new MemoryPubSubBus({ now: () => 1_000 });
    const received: string[] = [];
    bus.subscribe({ id: "bad", topicPattern: "user.#" }, () => {
      throw new Error("handler failed");
    });
    bus.subscribe({ id: "good", topicPattern: "user.#" }, (event) => {
      received.push(event.topic);
    });

    const result = bus.publish({ id: "evt-1", topic: "user.created", payload: {} });
    expect(result.delivered).toBe(1);
    expect(result.errors).toEqual([
      expect.objectContaining({ subscriptionId: "bad", error: expect.any(Error) }),
    ]);
    expect(bus.listDeliveries()).toEqual([
      expect.objectContaining({
        subscriptionId: "bad",
        status: "failed",
        errorMessage: "handler failed",
      }),
      expect.objectContaining({ subscriptionId: "good", status: "delivered" }),
    ]);
    expect(received).toEqual(["user.created"]);
  });

  it("unsubscribes stateful subscribers", () => {
    const bus = new MemoryPubSubBus({ now: () => 1_000 });
    const received: string[] = [];
    bus.subscribe({ id: "sub-1", topicPattern: "system.*" }, (event) => {
      received.push(event.topic);
    });
    expect(bus.unsubscribe("sub-1")).toBe(true);
    expect(bus.publish({ id: "evt-1", topic: "system.ready", payload: {} }).delivered).toBe(0);
    expect(received).toEqual([]);
  });

  it("keeps history clone-safe across publish results and list calls", () => {
    const bus = new MemoryPubSubBus({ now: () => 1_000 });
    bus.publish({
      id: "evt-1",
      topic: "system.ready",
      payload: { state: { ready: true } },
      metadata: { source: "system" },
    });

    const history = bus.listHistory();
    history[0]!.payload.state.ready = false;
    history[0]!.metadata!.source = "mutated";

    expect(bus.listHistory()[0]).toEqual(
      expect.objectContaining({
        payload: { state: { ready: true } },
        metadata: { source: "system" },
      }),
    );
  });
});

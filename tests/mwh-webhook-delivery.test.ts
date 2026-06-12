import { describe, expect, it } from "vitest";
import {
  type WebhookEndpointPolicy,
  classifyWebhookAttempt,
  computeRetryDelayMs,
  createWebhookDelivery,
  createWebhookDeliveryState,
  dueWebhookDeliveries,
  recordWebhookAttempt,
  webhookDeliverySnapshot,
} from "../src/mwh/modules/notification/webhook-delivery/core.js";
import { MemoryWebhookDelivery } from "../src/mwh/modules/notification/webhook-delivery/memory-delivery.js";

const endpoint: WebhookEndpointPolicy = {
  endpointId: "ep-1",
  url: "https://example.com/webhook",
  maxAttempts: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 5_000,
  retryableStatusCodes: [408, 429, 500, 502, 503, 504],
};

describe("MWH webhook-delivery stateless core", () => {
  it("creates deliveries, selects due work, and classifies HTTP results", () => {
    let state = createWebhookDeliveryState();
    const created = createWebhookDelivery(state, {
      id: "delivery-1",
      endpointId: "ep-1",
      eventType: "invoice.paid",
      payload: { invoiceId: "inv-1" },
      nowMs: 1_000,
    });
    state = created.state;

    expect(dueWebhookDeliveries(state, 999)).toEqual([]);
    expect(dueWebhookDeliveries(state, 1_000).map((delivery) => delivery.id)).toEqual([
      "delivery-1",
    ]);
    expect(classifyWebhookAttempt({ statusCode: 204, attempt: 1, policy: endpoint })).toBe(
      "success",
    );
    expect(classifyWebhookAttempt({ statusCode: 500, attempt: 1, policy: endpoint })).toBe("retry");
    expect(classifyWebhookAttempt({ statusCode: 400, attempt: 1, policy: endpoint })).toBe(
      "dead-letter",
    );
    expect(computeRetryDelayMs(endpoint, 3)).toBe(4_000);
  });

  it("records retry attempts, success, and snapshots", () => {
    let state = createWebhookDeliveryState();
    state = createWebhookDelivery(state, {
      id: "delivery-1",
      endpointId: "ep-1",
      eventType: "invoice.paid",
      payload: {},
      nowMs: 1_000,
    }).state;

    const retry = recordWebhookAttempt(state, {
      deliveryId: "delivery-1",
      policy: endpoint,
      nowMs: 1_010,
      statusCode: 500,
    });
    expect(retry.delivery).toEqual(
      expect.objectContaining({
        status: "scheduled",
        attempts: 1,
        nextAttemptAtMs: 2_010,
      }),
    );

    const success = recordWebhookAttempt(retry.state, {
      deliveryId: "delivery-1",
      policy: endpoint,
      nowMs: 2_010,
      statusCode: 200,
    });
    expect(success.delivery.status).toBe("delivered");
    expect(webhookDeliverySnapshot(success.state)).toEqual({
      pending: 0,
      scheduled: 0,
      delivered: 1,
      deadLettered: 0,
      attempts: 2,
    });
  });

  it("dead-letters after max attempts", () => {
    let state = createWebhookDeliveryState();
    state = createWebhookDelivery(state, {
      id: "delivery-1",
      endpointId: "ep-1",
      eventType: "invoice.paid",
      payload: {},
      nowMs: 1_000,
    }).state;
    state = recordWebhookAttempt(state, {
      deliveryId: "delivery-1",
      policy: endpoint,
      nowMs: 1_000,
      error: "timeout",
    }).state;
    state = recordWebhookAttempt(state, {
      deliveryId: "delivery-1",
      policy: endpoint,
      nowMs: 2_000,
      error: "timeout",
    }).state;
    const failed = recordWebhookAttempt(state, {
      deliveryId: "delivery-1",
      policy: endpoint,
      nowMs: 4_000,
      error: "timeout",
    });

    expect(failed.delivery).toEqual(
      expect.objectContaining({
        status: "dead-lettered",
        deadLetterReason: "timeout",
        attempts: 3,
      }),
    );
  });
});

describe("MWH webhook-delivery stateful memory workflow", () => {
  it("enqueues, retries after time advances, succeeds, and keeps clone-safe reads", () => {
    let now = 1_000;
    const workflow = new MemoryWebhookDelivery({ endpoints: [endpoint], now: () => now });
    workflow.enqueue({
      id: "delivery-1",
      endpointId: "ep-1",
      eventType: "invoice.paid",
      payload: { invoiceId: "inv-1" },
    });

    const listed = workflow.listDeliveries();
    listed[0]!.payload = { mutated: true };
    expect(workflow.listDeliveries()[0]?.payload).toEqual({ invoiceId: "inv-1" });

    expect(workflow.due().map((delivery) => delivery.id)).toEqual(["delivery-1"]);
    expect(workflow.record({ deliveryId: "delivery-1", statusCode: 503 }).delivery.status).toBe(
      "scheduled",
    );
    expect(workflow.due()).toEqual([]);
    now = 2_000;
    expect(workflow.due().map((delivery) => delivery.id)).toEqual(["delivery-1"]);
    expect(workflow.record({ deliveryId: "delivery-1", statusCode: 200 }).delivery.status).toBe(
      "delivered",
    );
    expect(workflow.snapshot().delivered).toBe(1);
  });

  it("dead-letters permanent failures and rejects unknown endpoints", () => {
    const workflow = new MemoryWebhookDelivery({ endpoints: [endpoint], now: () => 1_000 });
    expect(() =>
      workflow.enqueue({
        id: "delivery-x",
        endpointId: "missing",
        eventType: "invoice.paid",
        payload: {},
      }),
    ).toThrow("endpoint not found");

    workflow.enqueue({
      id: "delivery-1",
      endpointId: "ep-1",
      eventType: "invoice.paid",
      payload: {},
    });
    expect(workflow.record({ deliveryId: "delivery-1", statusCode: 404 }).delivery.status).toBe(
      "dead-lettered",
    );
    expect(workflow.listAttempts()).toHaveLength(1);
  });

  it("dispatches due deliveries through an injected sender with retries, limit, and clone-safe payloads", async () => {
    let now = 1_000;
    const sent: string[] = [];
    const workflow = new MemoryWebhookDelivery({
      endpoints: [endpoint],
      now: () => now,
      sender: (delivery, endpointPolicy) => {
        sent.push(`${endpointPolicy.url}:${delivery.id}`);
        if (delivery.id === "delivery-1" && delivery.attempts === 0) {
          (delivery.payload as { mutated?: boolean }).mutated = true;
          return { statusCode: 503 };
        }
        return { statusCode: 204 };
      },
    });

    workflow.enqueue({
      id: "delivery-1",
      endpointId: "ep-1",
      eventType: "invoice.paid",
      payload: { invoiceId: "inv-1" },
    });
    workflow.enqueue({
      id: "delivery-2",
      endpointId: "ep-1",
      eventType: "invoice.failed",
      payload: { invoiceId: "inv-2" },
    });

    expect(await workflow.dispatchDue(1)).toEqual([
      expect.objectContaining({
        delivery: expect.objectContaining({ id: "delivery-1", status: "scheduled" }),
        attempt: expect.objectContaining({ outcome: "retry" }),
      }),
    ]);
    expect(
      workflow.listDeliveries().find((delivery) => delivery.id === "delivery-1")?.payload,
    ).toEqual({ invoiceId: "inv-1" });
    expect(await workflow.dispatch("delivery-2")).toEqual(
      expect.objectContaining({
        delivery: expect.objectContaining({ status: "delivered" }),
        attempt: expect.objectContaining({ outcome: "success" }),
      }),
    );
    await expect(workflow.dispatch("delivery-1")).rejects.toThrow("webhook delivery is not due");

    now = 2_010;
    expect(await workflow.dispatchDue()).toEqual([
      expect.objectContaining({
        delivery: expect.objectContaining({ id: "delivery-1", status: "delivered" }),
      }),
    ]);
    expect(sent).toEqual([
      "https://example.com/webhook:delivery-1",
      "https://example.com/webhook:delivery-2",
      "https://example.com/webhook:delivery-1",
    ]);
  });

  it("requires a sender for dispatch and validates dispatch limits", async () => {
    const workflow = new MemoryWebhookDelivery({ endpoints: [endpoint], now: () => 1_000 });
    workflow.enqueue({
      id: "delivery-1",
      endpointId: "ep-1",
      eventType: "invoice.paid",
      payload: {},
    });

    await expect(workflow.dispatch("delivery-1")).rejects.toThrow(
      "webhook sender is not configured",
    );
    await expect(workflow.dispatchDue(0)).rejects.toThrow("limit must be a positive integer");
  });
});

import {
  type WebhookBackoffPolicy,
  type WebhookDelivery,
  claimWebhookDelivery,
  cloneWebhookDelivery,
  createWebhookDelivery,
  markWebhookDelivered,
  markWebhookFailed,
  releaseExpiredWebhookClaim,
} from "./core.js";

export interface MemoryWebhookDispatcherOptions {
  now?: () => number;
  defaultMaxAttempts?: number;
  defaultLeaseMs?: number;
  backoff?: WebhookBackoffPolicy;
}

export class MemoryWebhookDispatcher {
  private readonly now: () => number;
  private readonly defaultMaxAttempts: number;
  private readonly defaultLeaseMs: number;
  private readonly backoff: WebhookBackoffPolicy;
  private readonly deliveries = new Map<string, WebhookDelivery>();

  constructor(opts: MemoryWebhookDispatcherOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.defaultMaxAttempts = opts.defaultMaxAttempts ?? 5;
    this.defaultLeaseMs = opts.defaultLeaseMs ?? 30_000;
    this.backoff = opts.backoff ?? { baseDelayMs: 1_000, maxDelayMs: 60_000 };
  }

  enqueue(input: {
    id: string;
    endpointId: string;
    url: string;
    eventType: string;
    payload: unknown;
    maxAttempts?: number;
  }): WebhookDelivery {
    if (this.deliveries.has(input.id)) throw new Error(`delivery already exists: ${input.id}`);
    const delivery = createWebhookDelivery({
      ...input,
      nowMs: this.now(),
      maxAttempts: input.maxAttempts ?? this.defaultMaxAttempts,
    });
    this.deliveries.set(delivery.id, delivery);
    return cloneWebhookDelivery(delivery);
  }

  claimNext(workerId: string, opts: { leaseMs?: number } = {}): WebhookDelivery | undefined {
    const nowMs = this.now();
    const due = [...this.deliveries.values()]
      .map((delivery) => releaseExpiredWebhookClaim(delivery, nowMs))
      .sort(
        (left, right) =>
          left.availableAtMs - right.availableAtMs || left.createdAtMs - right.createdAtMs,
      );

    for (const delivery of due) {
      this.deliveries.set(delivery.id, delivery);
      const claimed = claimWebhookDelivery(delivery, {
        nowMs,
        workerId,
        leaseMs: opts.leaseMs ?? this.defaultLeaseMs,
      });
      if (claimed) {
        this.deliveries.set(claimed.id, claimed);
        return cloneWebhookDelivery(claimed);
      }
    }
    return undefined;
  }

  complete(id: string, workerId: string): WebhookDelivery {
    const delivery = this.require(id);
    const next = markWebhookDelivered(delivery, { nowMs: this.now(), workerId });
    this.deliveries.set(id, next);
    return cloneWebhookDelivery(next);
  }

  fail(id: string, workerId: string, error: string): WebhookDelivery {
    const delivery = this.require(id);
    const next = markWebhookFailed(delivery, {
      nowMs: this.now(),
      workerId,
      error,
      backoff: this.backoff,
    });
    this.deliveries.set(id, next);
    return cloneWebhookDelivery(next);
  }

  get(id: string): WebhookDelivery | undefined {
    const delivery = this.deliveries.get(id);
    return delivery ? cloneWebhookDelivery(delivery) : undefined;
  }

  list(): WebhookDelivery[] {
    return [...this.deliveries.values()].map(cloneWebhookDelivery);
  }

  private require(id: string): WebhookDelivery {
    const delivery = this.deliveries.get(id);
    if (!delivery) throw new Error(`unknown delivery: ${id}`);
    return delivery;
  }
}

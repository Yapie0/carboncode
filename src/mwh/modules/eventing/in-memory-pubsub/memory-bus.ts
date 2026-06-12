import {
  type PubSubEvent,
  type PubSubSubscription,
  clonePubSubEvent,
  createPubSubEvent,
  createSubscription,
  deactivateSubscription,
  planDeliveries,
} from "./core.js";

export interface PublishResult {
  event: PubSubEvent;
  delivered: number;
  errors: Array<{ subscriptionId: string; error: Error }>;
}

export interface MemoryPubSubBusOptions {
  now?: () => number;
  idFactory?: () => string;
}

export interface PubSubDeliveryAuditEntry {
  atMs: number;
  eventId: string;
  subscriptionId: string;
  topic: string;
  status: "delivered" | "failed";
  errorMessage?: string;
}

export class MemoryPubSubBus {
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private readonly subscriptions = new Map<
    string,
    {
      subscription: PubSubSubscription;
      handler: (event: PubSubEvent) => void;
    }
  >();
  private readonly history: PubSubEvent[] = [];
  private readonly deliveries: PubSubDeliveryAuditEntry[] = [];

  constructor(opts: MemoryPubSubBusOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.idFactory = opts.idFactory ?? (() => crypto.randomUUID());
  }

  subscribe(
    input: { id?: string; topicPattern: string; once?: boolean },
    handler: (event: PubSubEvent) => void,
  ): PubSubSubscription {
    const subscription = createSubscription({
      id: input.id ?? this.idFactory(),
      topicPattern: input.topicPattern,
      once: input.once,
    });
    if (this.subscriptions.has(subscription.id)) {
      throw new Error(`subscription already exists: ${subscription.id}`);
    }
    this.subscriptions.set(subscription.id, { subscription, handler });
    return { ...subscription };
  }

  unsubscribe(id: string): boolean {
    return this.subscriptions.delete(id);
  }

  publish<TPayload>(input: {
    id?: string;
    topic: string;
    payload: TPayload;
    metadata?: Record<string, string>;
  }): PublishResult {
    const event = createPubSubEvent({
      id: input.id ?? this.idFactory(),
      topic: input.topic,
      payload: input.payload,
      metadata: input.metadata,
      nowMs: this.now(),
    });
    this.history.push(event);

    const plans = planDeliveries(
      event,
      [...this.subscriptions.values()].map((entry) => entry.subscription),
    );
    const errors: PublishResult["errors"] = [];
    let delivered = 0;
    for (const plan of plans) {
      const entry = this.subscriptions.get(plan.subscriptionId);
      if (!entry) continue;
      try {
        entry.handler(event);
        delivered += 1;
        this.deliveries.push({
          atMs: this.now(),
          eventId: event.id,
          subscriptionId: plan.subscriptionId,
          topic: event.topic,
          status: "delivered",
        });
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        errors.push({
          subscriptionId: plan.subscriptionId,
          error: normalized,
        });
        this.deliveries.push({
          atMs: this.now(),
          eventId: event.id,
          subscriptionId: plan.subscriptionId,
          topic: event.topic,
          status: "failed",
          errorMessage: normalized.message,
        });
      }
      if (plan.removeAfterDelivery) {
        this.subscriptions.set(plan.subscriptionId, {
          ...entry,
          subscription: deactivateSubscription(entry.subscription),
        });
        this.subscriptions.delete(plan.subscriptionId);
      }
    }

    return { event: clonePubSubEvent(event), delivered, errors };
  }

  listSubscriptions(): PubSubSubscription[] {
    return [...this.subscriptions.values()].map((entry) => ({ ...entry.subscription }));
  }

  listHistory(): PubSubEvent[] {
    return this.history.map(clonePubSubEvent);
  }

  listDeliveries(): PubSubDeliveryAuditEntry[] {
    return this.deliveries.map((entry) => ({ ...entry }));
  }
}

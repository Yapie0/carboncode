import {
  type EventBusDelivery,
  type EventEnvelope,
  type EventPublishRecord,
  type EventSubscription,
  type TopicBinding,
  createEventEnvelope,
  createEventSubscription,
  createPublishRecord,
  createTopicBinding,
  planEventBusDeliveries,
  planEventBusDeliveryRecords,
  resolveEventTopic,
} from "./core.js";

export interface MemoryEventBusBrokerOptions {
  now?: () => number;
}

export interface PublishEventBusResult {
  envelope: EventEnvelope;
  topic: string;
  subscriptionIds: string[];
}

export class MemoryEventBusBroker {
  private readonly now: () => number;
  private readonly bindings: TopicBinding[] = [];
  private readonly subscriptions = new Map<string, EventSubscription>();
  private readonly topics = new Map<string, EventEnvelope[]>();
  private readonly publishRecords: EventPublishRecord[] = [];
  private readonly subscriptionOffsets = new Map<string, number>();

  constructor(options: MemoryEventBusBrokerOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  bind(input: { eventTypePattern: string; topic: string }): TopicBinding {
    const binding = createTopicBinding(input);
    this.bindings.push(binding);
    return { ...binding };
  }

  subscribe(input: {
    id: string;
    topic: string;
    consumerGroup: string;
    eventTypePattern?: string;
  }): EventSubscription {
    const subscription = createEventSubscription(input);
    if (this.subscriptions.has(subscription.id)) {
      throw new Error(`subscription already exists: ${subscription.id}`);
    }
    this.subscriptions.set(subscription.id, subscription);
    this.subscriptionOffsets.set(subscription.id, 0);
    return { ...subscription };
  }

  unsubscribe(id: string): boolean {
    this.subscriptionOffsets.delete(id);
    return this.subscriptions.delete(id);
  }

  setSubscriptionActive(id: string, active: boolean): EventSubscription {
    const subscription = this.subscriptions.get(id);
    if (!subscription) throw new Error(`subscription not found: ${id}`);
    const next = { ...subscription, active };
    this.subscriptions.set(id, next);
    return { ...next };
  }

  publish<TPayload>(input: {
    id: string;
    type: string;
    source: string;
    subject: string;
    payload: TPayload;
    headers?: Record<string, string>;
  }): PublishEventBusResult {
    const envelope = createEventEnvelope({
      ...input,
      occurredAtMs: this.now(),
    });
    const topic = resolveEventTopic(envelope, this.bindings);
    const subscriptionIds = planEventBusDeliveries({
      envelope,
      topic,
      subscriptions: [...this.subscriptions.values()],
    });
    const events = this.topics.get(topic) ?? [];
    events.push(envelope);
    this.topics.set(topic, events);
    this.publishRecords.push(
      createPublishRecord({ envelope, topic, subscriptionIds, nowMs: envelope.occurredAtMs }),
    );
    return { envelope: cloneEnvelope(envelope), topic, subscriptionIds };
  }

  readTopic(topic: string): EventEnvelope[] {
    return (this.topics.get(topic) ?? []).map(cloneEnvelope);
  }

  readSubscription(subscriptionId: string, limit = Number.MAX_SAFE_INTEGER): EventBusDelivery[] {
    if (!Number.isInteger(limit) || limit <= 0) throw new Error("limit must be a positive integer");
    const subscription = this.requireSubscription(subscriptionId);
    if (!subscription.active) return [];
    const startOffset = this.subscriptionOffsets.get(subscriptionId) ?? 0;
    const events = this.topics.get(subscription.topic) ?? [];
    const deliveries: EventBusDelivery[] = [];
    for (
      let offset = startOffset;
      offset < events.length && deliveries.length < limit;
      offset += 1
    ) {
      const envelope = events[offset]!;
      const planned = planEventBusDeliveryRecords({
        envelope,
        topic: subscription.topic,
        offset,
        subscriptions: [subscription],
      });
      deliveries.push(...planned);
    }
    return deliveries.map(cloneDelivery);
  }

  ack(subscriptionId: string, offset: number): number {
    const subscription = this.requireSubscription(subscriptionId);
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error("offset must be a non-negative integer");
    }
    const topicLength = this.topics.get(subscription.topic)?.length ?? 0;
    if (offset >= topicLength) throw new Error("offset is outside topic range");
    const nextOffset = Math.max(this.subscriptionOffsets.get(subscriptionId) ?? 0, offset + 1);
    this.subscriptionOffsets.set(subscriptionId, nextOffset);
    return nextOffset;
  }

  subscriptionOffset(subscriptionId: string): number {
    this.requireSubscription(subscriptionId);
    return this.subscriptionOffsets.get(subscriptionId) ?? 0;
  }

  listSubscriptions(): EventSubscription[] {
    return [...this.subscriptions.values()].map((subscription) => ({ ...subscription }));
  }

  listPublishRecords(): EventPublishRecord[] {
    return this.publishRecords.map((record) => ({
      ...record,
      subscriptionIds: [...record.subscriptionIds],
    }));
  }

  private requireSubscription(id: string): EventSubscription {
    const subscription = this.subscriptions.get(id);
    if (!subscription) throw new Error(`subscription not found: ${id}`);
    return subscription;
  }
}

function cloneEnvelope(envelope: EventEnvelope): EventEnvelope {
  return JSON.parse(JSON.stringify(envelope)) as EventEnvelope;
}

function cloneDelivery(delivery: EventBusDelivery): EventBusDelivery {
  return {
    ...delivery,
    envelope: cloneEnvelope(delivery.envelope),
  };
}

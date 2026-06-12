export interface PubSubEvent<TPayload = unknown> {
  id: string;
  topic: string;
  payload: TPayload;
  createdAtMs: number;
  metadata?: Record<string, string>;
}

export interface PubSubSubscription {
  id: string;
  topicPattern: string;
  once?: boolean;
  active: boolean;
}

export interface DeliveryPlan {
  eventId: string;
  subscriptionId: string;
  topic: string;
  removeAfterDelivery: boolean;
}

export function createPubSubEvent<TPayload>(input: {
  id: string;
  topic: string;
  payload: TPayload;
  nowMs: number;
  metadata?: Record<string, string>;
}): PubSubEvent<TPayload> {
  assertNonEmpty(input.id, "id");
  assertTopic(input.topic);
  assertNonNegativeInteger(input.nowMs, "nowMs");
  return {
    id: input.id,
    topic: input.topic,
    payload: input.payload,
    createdAtMs: input.nowMs,
    metadata: input.metadata,
  };
}

export function createSubscription(input: {
  id: string;
  topicPattern: string;
  once?: boolean;
}): PubSubSubscription {
  assertNonEmpty(input.id, "id");
  assertTopicPattern(input.topicPattern);
  return {
    id: input.id,
    topicPattern: input.topicPattern,
    once: input.once,
    active: true,
  };
}

export function topicMatches(pattern: string, topic: string): boolean {
  assertTopicPattern(pattern);
  assertTopic(topic);
  if (pattern === "*") return true;
  const patternParts = pattern.split(".");
  const topicParts = topic.split(".");
  for (let index = 0; index < patternParts.length; index += 1) {
    const patternPart = patternParts[index]!;
    if (patternPart === "#") return true;
    const topicPart = topicParts[index];
    if (topicPart === undefined) return false;
    if (patternPart !== "*" && patternPart !== topicPart) return false;
  }
  return patternParts.length === topicParts.length;
}

export function planDeliveries(
  event: PubSubEvent,
  subscriptions: readonly PubSubSubscription[],
): DeliveryPlan[] {
  return subscriptions
    .filter(
      (subscription) => subscription.active && topicMatches(subscription.topicPattern, event.topic),
    )
    .map((subscription) => ({
      eventId: event.id,
      subscriptionId: subscription.id,
      topic: event.topic,
      removeAfterDelivery: subscription.once === true,
    }));
}

export function deactivateSubscription(subscription: PubSubSubscription): PubSubSubscription {
  return { ...subscription, active: false };
}

export function clonePubSubEvent<TPayload>(event: PubSubEvent<TPayload>): PubSubEvent<TPayload> {
  return {
    ...event,
    payload: clonePayload(event.payload),
    metadata: event.metadata ? { ...event.metadata } : undefined,
  };
}

function assertTopic(topic: string): void {
  assertNonEmpty(topic, "topic");
  if (topic.includes("..")) throw new Error("topic must not contain empty segments");
}

function assertTopicPattern(pattern: string): void {
  assertNonEmpty(pattern, "topicPattern");
  if (pattern.includes("..")) throw new Error("topicPattern must not contain empty segments");
  const parts = pattern.split(".");
  const hashIndex = parts.indexOf("#");
  if (hashIndex !== -1 && hashIndex !== parts.length - 1) {
    throw new Error("topicPattern # wildcard must be the final segment");
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative integer`);
}

function clonePayload<TPayload>(payload: TPayload): TPayload {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(payload);
    } catch {
      // Fall back for non-cloneable values such as functions.
    }
  }
  if (Array.isArray(payload)) return [...payload] as TPayload;
  if (payload && typeof payload === "object") return { ...(payload as object) } as TPayload;
  return payload;
}

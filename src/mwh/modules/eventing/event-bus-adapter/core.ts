export interface EventEnvelope<TPayload = unknown> {
  id: string;
  type: string;
  source: string;
  subject: string;
  payload: TPayload;
  occurredAtMs: number;
  headers: Record<string, string>;
}

export interface TopicBinding {
  eventTypePattern: string;
  topic: string;
}

export interface EventSubscription {
  id: string;
  topic: string;
  consumerGroup: string;
  eventTypePattern?: string;
  active: boolean;
}

export interface EventPublishRecord {
  envelopeId: string;
  topic: string;
  publishedAtMs: number;
  subscriptionIds: string[];
}

export interface EventBusDelivery<TPayload = unknown> {
  subscriptionId: string;
  consumerGroup: string;
  topic: string;
  offset: number;
  envelope: EventEnvelope<TPayload>;
}

export function createEventEnvelope<TPayload>(input: {
  id: string;
  type: string;
  source: string;
  subject: string;
  payload: TPayload;
  occurredAtMs: number;
  headers?: Record<string, string>;
}): EventEnvelope<TPayload> {
  assertNonEmpty(input.id, "id");
  assertTopic(input.type, "type");
  assertNonEmpty(input.source, "source");
  assertNonEmpty(input.subject, "subject");
  assertNonNegativeInteger(input.occurredAtMs, "occurredAtMs");
  return {
    id: input.id,
    type: input.type,
    source: input.source,
    subject: input.subject,
    payload: cloneJson(input.payload) as TPayload,
    occurredAtMs: input.occurredAtMs,
    headers: { ...(input.headers ?? {}) },
  };
}

export function createTopicBinding(input: {
  eventTypePattern: string;
  topic: string;
}): TopicBinding {
  assertPattern(input.eventTypePattern, "eventTypePattern");
  assertTopic(input.topic, "topic");
  return { eventTypePattern: input.eventTypePattern, topic: input.topic };
}

export function createEventSubscription(input: {
  id: string;
  topic: string;
  consumerGroup: string;
  eventTypePattern?: string;
}): EventSubscription {
  assertNonEmpty(input.id, "id");
  assertTopic(input.topic, "topic");
  assertNonEmpty(input.consumerGroup, "consumerGroup");
  if (input.eventTypePattern) assertPattern(input.eventTypePattern, "eventTypePattern");
  return {
    id: input.id,
    topic: input.topic,
    consumerGroup: input.consumerGroup,
    eventTypePattern: input.eventTypePattern,
    active: true,
  };
}

export function resolveEventTopic(
  envelope: EventEnvelope,
  bindings: readonly TopicBinding[],
): string {
  const binding = bindings.find((candidate) =>
    patternMatches(candidate.eventTypePattern, envelope.type),
  );
  return binding?.topic ?? envelope.type;
}

export function planEventBusDeliveries(input: {
  envelope: EventEnvelope;
  topic: string;
  subscriptions: readonly EventSubscription[];
}): string[] {
  assertTopic(input.topic, "topic");
  return input.subscriptions
    .filter((subscription) => subscription.active)
    .filter((subscription) => subscription.topic === input.topic)
    .filter(
      (subscription) =>
        !subscription.eventTypePattern ||
        patternMatches(subscription.eventTypePattern, input.envelope.type),
    )
    .map((subscription) => subscription.id)
    .sort();
}

export function planEventBusDeliveryRecords(input: {
  envelope: EventEnvelope;
  topic: string;
  offset: number;
  subscriptions: readonly EventSubscription[];
}): EventBusDelivery[] {
  assertTopic(input.topic, "topic");
  assertNonNegativeInteger(input.offset, "offset");
  return input.subscriptions
    .filter((subscription) => subscription.active)
    .filter((subscription) => subscription.topic === input.topic)
    .filter(
      (subscription) =>
        !subscription.eventTypePattern ||
        patternMatches(subscription.eventTypePattern, input.envelope.type),
    )
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((subscription) => ({
      subscriptionId: subscription.id,
      consumerGroup: subscription.consumerGroup,
      topic: input.topic,
      offset: input.offset,
      envelope: cloneEnvelope(input.envelope),
    }));
}

export function createPublishRecord(input: {
  envelope: EventEnvelope;
  topic: string;
  subscriptionIds: readonly string[];
  nowMs: number;
}): EventPublishRecord {
  assertTopic(input.topic, "topic");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  return {
    envelopeId: input.envelope.id,
    topic: input.topic,
    publishedAtMs: input.nowMs,
    subscriptionIds: [...input.subscriptionIds].sort(),
  };
}

export function patternMatches(pattern: string, value: string): boolean {
  assertPattern(pattern, "pattern");
  assertTopic(value, "value");
  if (pattern === "*") return true;
  const patternParts = pattern.split(".");
  const valueParts = value.split(".");
  for (let index = 0; index < patternParts.length; index += 1) {
    const part = patternParts[index]!;
    if (part === "#") return true;
    if (valueParts[index] === undefined) return false;
    if (part !== "*" && part !== valueParts[index]) return false;
  }
  return patternParts.length === valueParts.length;
}

function assertPattern(pattern: string, name: string): void {
  assertNonEmpty(pattern, name);
  if (pattern.includes("..")) throw new Error(`${name} must not contain empty segments`);
}

function assertTopic(topic: string, name: string): void {
  assertNonEmpty(topic, name);
  if (topic.includes("..")) throw new Error(`${name} must not contain empty segments`);
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

function cloneJson(value: unknown): unknown {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function cloneEnvelope<TPayload>(envelope: EventEnvelope<TPayload>): EventEnvelope<TPayload> {
  return {
    ...envelope,
    payload: cloneJson(envelope.payload) as TPayload,
    headers: { ...envelope.headers },
  };
}

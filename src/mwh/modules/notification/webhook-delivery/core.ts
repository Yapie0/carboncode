export type WebhookDeliveryStatus = "pending" | "scheduled" | "delivered" | "dead-lettered";
export type WebhookAttemptOutcome = "success" | "retry" | "dead-letter";

export interface WebhookEndpointPolicy {
  endpointId: string;
  url: string;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableStatusCodes: readonly number[];
}

export interface WebhookDelivery {
  id: string;
  endpointId: string;
  eventType: string;
  payload: unknown;
  status: WebhookDeliveryStatus;
  attempts: number;
  nextAttemptAtMs: number;
  createdAtMs: number;
  updatedAtMs: number;
  deadLetterReason?: string;
}

export interface WebhookAttempt {
  deliveryId: string;
  attempt: number;
  atMs: number;
  outcome: WebhookAttemptOutcome;
  statusCode?: number;
  error?: string;
  nextAttemptAtMs?: number;
}

export interface WebhookDeliveryState {
  deliveries: readonly WebhookDelivery[];
  attempts: readonly WebhookAttempt[];
}

export interface WebhookDeliverySnapshot {
  pending: number;
  scheduled: number;
  delivered: number;
  deadLettered: number;
  attempts: number;
}

export function createWebhookDeliveryState(): WebhookDeliveryState {
  return { deliveries: [], attempts: [] };
}

export function createWebhookDelivery(
  state: WebhookDeliveryState,
  input: {
    id: string;
    endpointId: string;
    eventType: string;
    payload: unknown;
    nowMs: number;
  },
): { state: WebhookDeliveryState; delivery: WebhookDelivery } {
  assertState(state);
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.endpointId, "endpointId");
  assertNonEmpty(input.eventType, "eventType");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (state.deliveries.some((delivery) => delivery.id === input.id)) {
    throw new Error("delivery already exists");
  }
  const delivery: WebhookDelivery = {
    id: input.id,
    endpointId: input.endpointId,
    eventType: input.eventType,
    payload: cloneJson(input.payload),
    status: "pending",
    attempts: 0,
    nextAttemptAtMs: input.nowMs,
    createdAtMs: input.nowMs,
    updatedAtMs: input.nowMs,
  };
  return {
    state: cloneState({ ...state, deliveries: [...state.deliveries, delivery] }),
    delivery: cloneDelivery(delivery),
  };
}

export function dueWebhookDeliveries(
  state: WebhookDeliveryState,
  nowMs: number,
): WebhookDelivery[] {
  assertState(state);
  assertNonNegativeInteger(nowMs, "nowMs");
  return state.deliveries
    .filter((delivery) => delivery.status === "pending" || delivery.status === "scheduled")
    .filter((delivery) => delivery.nextAttemptAtMs <= nowMs)
    .sort(
      (left, right) =>
        left.nextAttemptAtMs - right.nextAttemptAtMs || left.id.localeCompare(right.id),
    )
    .map(cloneDelivery);
}

export function recordWebhookAttempt(
  state: WebhookDeliveryState,
  input: {
    deliveryId: string;
    policy: WebhookEndpointPolicy;
    nowMs: number;
    statusCode?: number;
    error?: string;
  },
): { state: WebhookDeliveryState; delivery: WebhookDelivery; attempt: WebhookAttempt } {
  assertState(state);
  assertPolicy(input.policy);
  assertNonEmpty(input.deliveryId, "deliveryId");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const delivery = state.deliveries.find((candidate) => candidate.id === input.deliveryId);
  if (!delivery) throw new Error("delivery not found");
  if (delivery.endpointId !== input.policy.endpointId) throw new Error("endpoint policy mismatch");
  if (delivery.status === "delivered" || delivery.status === "dead-lettered") {
    throw new Error("delivery is already terminal");
  }

  const attemptNumber = delivery.attempts + 1;
  const outcome = classifyWebhookAttempt({
    statusCode: input.statusCode,
    error: input.error,
    attempt: attemptNumber,
    policy: input.policy,
  });
  const nextAttemptAtMs =
    outcome === "retry"
      ? input.nowMs + computeRetryDelayMs(input.policy, attemptNumber)
      : undefined;
  const updated: WebhookDelivery = {
    ...delivery,
    attempts: attemptNumber,
    status:
      outcome === "success" ? "delivered" : outcome === "retry" ? "scheduled" : "dead-lettered",
    nextAttemptAtMs: nextAttemptAtMs ?? delivery.nextAttemptAtMs,
    updatedAtMs: input.nowMs,
    deadLetterReason:
      outcome === "dead-letter"
        ? (input.error ?? `status ${input.statusCode ?? "unknown"}`)
        : undefined,
  };
  const attempt: WebhookAttempt = {
    deliveryId: delivery.id,
    attempt: attemptNumber,
    atMs: input.nowMs,
    outcome,
    statusCode: input.statusCode,
    error: input.error,
    nextAttemptAtMs,
  };
  return {
    state: cloneState({
      deliveries: state.deliveries.map((candidate) =>
        candidate.id === delivery.id ? updated : candidate,
      ),
      attempts: [...state.attempts, attempt],
    }),
    delivery: cloneDelivery(updated),
    attempt: { ...attempt },
  };
}

export function classifyWebhookAttempt(input: {
  statusCode?: number;
  error?: string;
  attempt: number;
  policy: WebhookEndpointPolicy;
}): WebhookAttemptOutcome {
  assertPolicy(input.policy);
  assertPositiveInteger(input.attempt, "attempt");
  const success =
    input.statusCode !== undefined && input.statusCode >= 200 && input.statusCode < 300;
  if (success) return "success";
  const retryable =
    input.error !== undefined ||
    (input.statusCode !== undefined &&
      input.policy.retryableStatusCodes.includes(input.statusCode));
  if (retryable && input.attempt < input.policy.maxAttempts) return "retry";
  return "dead-letter";
}

export function computeRetryDelayMs(policy: WebhookEndpointPolicy, attempt: number): number {
  assertPolicy(policy);
  assertPositiveInteger(attempt, "attempt");
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
}

export function webhookDeliverySnapshot(state: WebhookDeliveryState): WebhookDeliverySnapshot {
  assertState(state);
  return {
    pending: state.deliveries.filter((delivery) => delivery.status === "pending").length,
    scheduled: state.deliveries.filter((delivery) => delivery.status === "scheduled").length,
    delivered: state.deliveries.filter((delivery) => delivery.status === "delivered").length,
    deadLettered: state.deliveries.filter((delivery) => delivery.status === "dead-lettered").length,
    attempts: state.attempts.length,
  };
}

export function cloneWebhookDeliveryState(state: WebhookDeliveryState): WebhookDeliveryState {
  assertState(state);
  return cloneState(state);
}

function assertPolicy(policy: WebhookEndpointPolicy): void {
  assertNonEmpty(policy.endpointId, "endpointId");
  assertNonEmpty(policy.url, "url");
  assertPositiveInteger(policy.maxAttempts, "maxAttempts");
  assertPositiveInteger(policy.baseDelayMs, "baseDelayMs");
  assertPositiveInteger(policy.maxDelayMs, "maxDelayMs");
}

function assertState(state: WebhookDeliveryState): void {
  if (!Array.isArray(state.deliveries)) throw new Error("deliveries must be an array");
  if (!Array.isArray(state.attempts)) throw new Error("attempts must be an array");
}

function cloneState(state: WebhookDeliveryState): WebhookDeliveryState {
  return {
    deliveries: state.deliveries.map(cloneDelivery),
    attempts: state.attempts.map((attempt) => ({ ...attempt })),
  };
}

function cloneDelivery(delivery: WebhookDelivery): WebhookDelivery {
  return {
    ...delivery,
    payload: cloneJson(delivery.payload),
  };
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
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

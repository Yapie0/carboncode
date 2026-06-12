import {
  type WebhookAttempt,
  type WebhookDelivery,
  type WebhookDeliverySnapshot,
  type WebhookDeliveryState,
  type WebhookEndpointPolicy,
  cloneWebhookDeliveryState,
  createWebhookDelivery,
  createWebhookDeliveryState,
  dueWebhookDeliveries,
  recordWebhookAttempt,
  webhookDeliverySnapshot,
} from "./core.js";

export interface MemoryWebhookDeliveryOptions {
  endpoints: readonly WebhookEndpointPolicy[];
  now?: () => number;
  sender?: WebhookSender;
}

export interface WebhookSendResult {
  statusCode?: number;
  error?: string;
}

export type WebhookSender = (
  delivery: WebhookDelivery,
  endpoint: WebhookEndpointPolicy,
) => Promise<WebhookSendResult> | WebhookSendResult;

export class MemoryWebhookDelivery {
  private state: WebhookDeliveryState = createWebhookDeliveryState();
  private readonly endpoints: Map<string, WebhookEndpointPolicy>;
  private readonly now: () => number;
  private readonly sender: WebhookSender;

  constructor(options: MemoryWebhookDeliveryOptions) {
    this.endpoints = new Map(
      options.endpoints.map((endpoint) => [endpoint.endpointId, { ...endpoint }]),
    );
    this.now = options.now ?? Date.now;
    this.sender =
      options.sender ??
      (() => {
        throw new Error("webhook sender is not configured");
      });
  }

  enqueue(input: {
    id: string;
    endpointId: string;
    eventType: string;
    payload: unknown;
  }): WebhookDelivery {
    this.requireEndpoint(input.endpointId);
    const result = createWebhookDelivery(this.state, { ...input, nowMs: this.now() });
    this.state = result.state;
    return result.delivery;
  }

  due(): WebhookDelivery[] {
    return dueWebhookDeliveries(this.state, this.now());
  }

  record(input: {
    deliveryId: string;
    statusCode?: number;
    error?: string;
  }): { delivery: WebhookDelivery; attempt: WebhookAttempt } {
    const delivery = this.state.deliveries.find((candidate) => candidate.id === input.deliveryId);
    if (!delivery) throw new Error("delivery not found");
    const result = recordWebhookAttempt(this.state, {
      ...input,
      policy: this.requireEndpoint(delivery.endpointId),
      nowMs: this.now(),
    });
    this.state = result.state;
    return { delivery: result.delivery, attempt: result.attempt };
  }

  async dispatch(id: string): Promise<{ delivery: WebhookDelivery; attempt: WebhookAttempt }> {
    const delivery = this.state.deliveries.find((candidate) => candidate.id === id);
    if (!delivery) throw new Error("delivery not found");
    const dueDelivery = this.due().find((candidate) => candidate.id === id);
    if (!dueDelivery) throw new Error("webhook delivery is not due");
    const endpoint = this.requireEndpoint(delivery.endpointId);
    const result = await Promise.resolve().then(() => this.sender(dueDelivery, endpoint));
    return this.record({
      deliveryId: id,
      statusCode: result.statusCode,
      error: result.error,
    });
  }

  async dispatchDue(
    limit = Number.MAX_SAFE_INTEGER,
  ): Promise<{ delivery: WebhookDelivery; attempt: WebhookAttempt }[]> {
    if (!Number.isInteger(limit) || limit <= 0) throw new Error("limit must be a positive integer");
    const results: { delivery: WebhookDelivery; attempt: WebhookAttempt }[] = [];
    for (const delivery of this.due().slice(0, limit)) {
      results.push(await this.dispatch(delivery.id));
    }
    return results;
  }

  snapshot(): WebhookDeliverySnapshot {
    return webhookDeliverySnapshot(this.state);
  }

  listDeliveries(): WebhookDelivery[] {
    return cloneWebhookDeliveryState(this.state).deliveries.map((delivery) => ({ ...delivery }));
  }

  listAttempts(): WebhookAttempt[] {
    return cloneWebhookDeliveryState(this.state).attempts.map((attempt) => ({ ...attempt }));
  }

  private requireEndpoint(endpointId: string): WebhookEndpointPolicy {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) throw new Error("endpoint not found");
    return { ...endpoint, retryableStatusCodes: [...endpoint.retryableStatusCodes] };
  }
}

import type { NotificationChannel } from "../notification-router/core.js";
import {
  type NotificationBackoffPolicy,
  type NotificationContact,
  type NotificationDelivery,
  type NotificationEnvelope,
  createNotificationContact,
  createNotificationEnvelope,
  isNotificationDue,
  markNotificationFailed,
  markNotificationSent,
  planNotificationDeliveries,
} from "./core.js";

export interface MemoryNotificationHubOptions {
  now?: () => number;
  defaultMaxAttempts?: number;
  backoff?: NotificationBackoffPolicy;
}

export class MemoryNotificationHub {
  private readonly now: () => number;
  private readonly defaultMaxAttempts: number;
  private readonly backoff: NotificationBackoffPolicy;
  private readonly contacts = new Map<string, NotificationContact>();
  private readonly deliveries = new Map<string, NotificationDelivery>();
  private readonly envelopes = new Map<string, NotificationEnvelope>();

  constructor(options: MemoryNotificationHubOptions = {}) {
    this.now = options.now ?? Date.now;
    this.defaultMaxAttempts = options.defaultMaxAttempts ?? 3;
    this.backoff = options.backoff ?? { baseDelayMs: 1_000, maxDelayMs: 60_000 };
  }

  setContact(input: {
    userId: string;
    channel: NotificationChannel;
    destination: string;
    enabled?: boolean;
  }): NotificationContact {
    const contact = createNotificationContact(input);
    this.contacts.set(contactKey(contact), contact);
    return { ...contact };
  }

  enqueue(input: {
    id: string;
    userId: string;
    type: string;
    title: string;
    body: string;
    priority?: NotificationEnvelope["priority"];
    channels: NotificationChannel[];
    data?: Record<string, string | number | boolean>;
    maxAttempts?: number;
  }): NotificationDelivery[] {
    const envelope = createNotificationEnvelope({ ...input, createdAtMs: this.now() });
    if (this.envelopes.has(envelope.id))
      throw new Error(`notification already exists: ${envelope.id}`);
    this.envelopes.set(envelope.id, envelope);
    const deliveries = planNotificationDeliveries({
      envelope,
      channels: input.channels,
      contacts: [...this.contacts.values()],
      nowMs: envelope.createdAtMs,
      maxAttempts: input.maxAttempts ?? this.defaultMaxAttempts,
    });
    for (const delivery of deliveries) this.deliveries.set(delivery.id, delivery);
    return deliveries.map(cloneDelivery);
  }

  due(): NotificationDelivery[] {
    const nowMs = this.now();
    return [...this.deliveries.values()]
      .filter((delivery) => isNotificationDue(delivery, nowMs))
      .sort((a, b) => a.availableAtMs - b.availableAtMs || a.id.localeCompare(b.id))
      .map(cloneDelivery);
  }

  sent(id: string, providerMessageId?: string): NotificationDelivery {
    const next = markNotificationSent(this.require(id), {
      nowMs: this.now(),
      providerMessageId,
    });
    this.deliveries.set(id, next);
    return cloneDelivery(next);
  }

  failed(id: string, error: string): NotificationDelivery {
    const next = markNotificationFailed(this.require(id), {
      nowMs: this.now(),
      error,
      backoff: this.backoff,
    });
    this.deliveries.set(id, next);
    return cloneDelivery(next);
  }

  getDelivery(id: string): NotificationDelivery | undefined {
    const delivery = this.deliveries.get(id);
    return delivery ? cloneDelivery(delivery) : undefined;
  }

  listDeliveries(messageId?: string): NotificationDelivery[] {
    return [...this.deliveries.values()]
      .filter((delivery) => !messageId || delivery.messageId === messageId)
      .map(cloneDelivery);
  }

  private require(id: string): NotificationDelivery {
    const delivery = this.deliveries.get(id);
    if (!delivery) throw new Error(`unknown notification delivery: ${id}`);
    return delivery;
  }
}

function contactKey(contact: Pick<NotificationContact, "userId" | "channel">): string {
  return `${contact.userId}\0${contact.channel}`;
}

function cloneDelivery(delivery: NotificationDelivery): NotificationDelivery {
  return { ...delivery };
}

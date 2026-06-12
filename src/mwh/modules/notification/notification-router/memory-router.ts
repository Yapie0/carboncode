import {
  type NotificationChannel,
  type NotificationMessage,
  type NotificationPreferences,
  type NotificationRouteDecision,
  type RoutedNotificationDelivery,
  cloneNotificationRouteDecision,
  cloneRoutedNotificationDelivery,
  createNotificationDeliveries,
  createNotificationMessage,
  markNotificationDeliveryDispatched,
  normalizePreferences,
  notificationDedupeKey,
  routeNotification,
} from "./core.js";

export interface RoutedNotificationRecord {
  id: string;
  dedupeKey: string;
  decision: NotificationRouteDecision;
  routedAtMs: number;
  expiresAtMs: number;
}

export interface MemoryNotificationRouterOptions {
  now?: () => number;
  dedupeTtlMs?: number;
}

export class MemoryNotificationRouter {
  private readonly now: () => number;
  private readonly dedupeTtlMs: number;
  private readonly preferences = new Map<string, NotificationPreferences>();
  private readonly records = new Map<string, RoutedNotificationRecord>();
  private readonly deliveries = new Map<string, RoutedNotificationDelivery>();

  constructor(opts: MemoryNotificationRouterOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.dedupeTtlMs = opts.dedupeTtlMs ?? 300_000;
    if (!Number.isInteger(this.dedupeTtlMs) || this.dedupeTtlMs <= 0) {
      throw new Error("dedupeTtlMs must be a positive integer");
    }
  }

  setPreferences(preferences: NotificationPreferences): NotificationPreferences {
    const normalized = normalizePreferences(preferences);
    this.preferences.set(normalized.userId, normalized);
    return normalizePreferences(normalized);
  }

  route(input: {
    id: string;
    userId: string;
    type: string;
    title: string;
    body: string;
    priority?: NotificationMessage["priority"];
    channels?: NotificationMessage["channels"];
    dedupeKey?: string;
  }): NotificationRouteDecision {
    const nowMs = this.now();
    this.pruneExpired(nowMs);
    const message = createNotificationMessage({ ...input, createdAtMs: nowMs });
    const dedupeKey = notificationDedupeKey(message);
    const decision = routeNotification({
      message,
      preferences: this.preferences.get(message.userId),
      nowMs,
      replayed: this.records.has(dedupeKey),
    });
    this.records.set(dedupeKey, {
      id: message.id,
      dedupeKey,
      decision,
      routedAtMs: nowMs,
      expiresAtMs: nowMs + this.dedupeTtlMs,
    });
    for (const delivery of createNotificationDeliveries({ message, decision })) {
      this.deliveries.set(delivery.id, delivery);
    }
    return cloneNotificationRouteDecision(decision);
  }

  pendingDeliveries(channel?: NotificationChannel): RoutedNotificationDelivery[] {
    return [...this.deliveries.values()]
      .filter((delivery) => delivery.status === "pending")
      .filter((delivery) => channel === undefined || delivery.channel === channel)
      .sort(
        (left, right) => left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id),
      )
      .map(cloneRoutedNotificationDelivery);
  }

  markDispatched(id: string, dispatchedAtMs: number = this.now()): RoutedNotificationDelivery {
    const delivery = this.deliveries.get(id);
    if (!delivery) throw new Error("notification delivery not found");
    const next = markNotificationDeliveryDispatched(delivery, dispatchedAtMs);
    this.deliveries.set(id, next);
    return cloneRoutedNotificationDelivery(next);
  }

  listDeliveries(): RoutedNotificationDelivery[] {
    return [...this.deliveries.values()]
      .sort(
        (left, right) => left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id),
      )
      .map(cloneRoutedNotificationDelivery);
  }

  pruneExpired(nowMs: number = this.now()): number {
    let removed = 0;
    for (const [key, record] of this.records) {
      if (nowMs >= record.expiresAtMs) {
        this.records.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  listRecords(): RoutedNotificationRecord[] {
    return [...this.records.values()].map((record) => ({
      ...record,
      decision: cloneNotificationRouteDecision(record.decision),
    }));
  }
}

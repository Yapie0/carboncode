import {
  type InAppNotification,
  type InAppNotificationPage,
  type InAppNotificationSummary,
  archiveInAppNotification,
  archiveMatchingInAppNotifications,
  cloneInAppNotification,
  createInAppNotification,
  expireInAppNotification,
  markAllInAppNotificationsRead,
  markInAppNotificationRead,
  pageInAppNotifications,
  summarizeInAppNotifications,
} from "./core.js";

export class MemoryInAppNotificationStore {
  private readonly now: () => number;
  private readonly records = new Map<string, InAppNotification>();

  constructor(input: { now?: () => number } = {}) {
    this.now = input.now ?? Date.now;
  }

  create(input: {
    id: string;
    userId: string;
    title: string;
    body: string;
    type: string;
    ttlMs?: number;
    metadata?: Record<string, string>;
  }): InAppNotification {
    if (this.records.has(input.id)) throw new Error("in-app notification already exists");
    const notification = createInAppNotification({ ...input, nowMs: this.now() });
    this.records.set(notification.id, notification);
    return cloneInAppNotification(notification);
  }

  markRead(id: string): InAppNotification {
    const notification = this.require(id);
    const next = markInAppNotificationRead(notification, this.now());
    this.records.set(id, next);
    return cloneInAppNotification(next);
  }

  archive(id: string): InAppNotification {
    const notification = this.require(id);
    const next = archiveInAppNotification(notification, this.now());
    this.records.set(id, next);
    return cloneInAppNotification(next);
  }

  markAllRead(input: { userId: string; type?: string }): string[] {
    const result = markAllInAppNotificationsRead([...this.records.values()], {
      ...input,
      nowMs: this.now(),
    });
    this.replaceAll(result.notifications);
    return [...result.changedIds];
  }

  archiveMatching(input: { userId: string; type?: string; includeRead?: boolean }): string[] {
    const result = archiveMatchingInAppNotifications([...this.records.values()], {
      ...input,
      nowMs: this.now(),
    });
    this.replaceAll(result.notifications);
    return [...result.changedIds];
  }

  page(input: {
    userId: string;
    limit: number;
    cursor?: string;
    includeArchived?: boolean;
  }): InAppNotificationPage {
    this.pruneExpired();
    return pageInAppNotifications([...this.records.values()], { ...input, nowMs: this.now() });
  }

  unreadCount(userId: string): number {
    return this.page({ userId, limit: Number.MAX_SAFE_INTEGER }).unreadCount;
  }

  summary(input: { userId: string; includeArchived?: boolean }): InAppNotificationSummary {
    this.pruneExpired();
    return summarizeInAppNotifications([...this.records.values()], {
      ...input,
      nowMs: this.now(),
    });
  }

  pruneExpired(): number {
    const nowMs = this.now();
    let changed = 0;
    for (const [id, notification] of this.records) {
      const next = expireInAppNotification(notification, nowMs);
      if (next.status === "expired" && notification.status !== "expired") {
        this.records.set(id, next);
        changed += 1;
      }
    }
    return changed;
  }

  get(id: string): InAppNotification | undefined {
    const notification = this.records.get(id);
    return notification ? cloneInAppNotification(notification) : undefined;
  }

  list(): InAppNotification[] {
    return [...this.records.values()]
      .sort(
        (left, right) => left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id),
      )
      .map(cloneInAppNotification);
  }

  private require(id: string): InAppNotification {
    const notification = this.records.get(id);
    if (!notification) throw new Error("in-app notification not found");
    return notification;
  }

  private replaceAll(notifications: readonly InAppNotification[]): void {
    this.records.clear();
    for (const notification of notifications) {
      this.records.set(notification.id, cloneInAppNotification(notification));
    }
  }
}

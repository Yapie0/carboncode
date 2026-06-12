export type InAppNotificationStatus = "unread" | "read" | "archived" | "expired";

export interface InAppNotification {
  id: string;
  userId: string;
  title: string;
  body: string;
  type: string;
  createdAtMs: number;
  status: InAppNotificationStatus;
  readAtMs?: number;
  archivedAtMs?: number;
  expiresAtMs?: number;
  metadata?: Record<string, string>;
}

export interface InAppNotificationPage {
  items: InAppNotification[];
  nextCursor?: string;
  unreadCount: number;
}

export interface InAppNotificationSummary {
  unread: number;
  read: number;
  archived: number;
  expired: number;
  totalVisible: number;
}

export function createInAppNotification(input: {
  id: string;
  userId: string;
  title: string;
  body: string;
  type: string;
  nowMs: number;
  ttlMs?: number;
  metadata?: Record<string, string>;
}): InAppNotification {
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.userId, "userId");
  assertNonEmpty(input.title, "title");
  assertNonEmpty(input.body, "body");
  assertNonEmpty(input.type, "type");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (input.ttlMs !== undefined) assertPositiveInteger(input.ttlMs, "ttlMs");
  return {
    id: input.id,
    userId: input.userId,
    title: input.title.trim(),
    body: input.body.trim(),
    type: input.type,
    createdAtMs: input.nowMs,
    status: "unread",
    expiresAtMs: input.ttlMs === undefined ? undefined : input.nowMs + input.ttlMs,
    metadata: input.metadata ? { ...input.metadata } : undefined,
  };
}

export function classifyInAppNotification(
  notification: InAppNotification,
  nowMs: number,
): InAppNotificationStatus {
  assertNonNegativeInteger(nowMs, "nowMs");
  if (
    notification.status !== "archived" &&
    notification.expiresAtMs !== undefined &&
    nowMs >= notification.expiresAtMs
  ) {
    return "expired";
  }
  return notification.status;
}

export function markInAppNotificationRead(
  notification: InAppNotification,
  nowMs: number,
): InAppNotification {
  assertNonNegativeInteger(nowMs, "nowMs");
  const status = classifyInAppNotification(notification, nowMs);
  if (status === "expired") return { ...cloneInAppNotification(notification), status: "expired" };
  if (status === "archived") return cloneInAppNotification(notification);
  if (status === "read") return cloneInAppNotification(notification);
  return {
    ...cloneInAppNotification(notification),
    status: "read",
    readAtMs: nowMs,
  };
}

export function archiveInAppNotification(
  notification: InAppNotification,
  nowMs: number,
): InAppNotification {
  assertNonNegativeInteger(nowMs, "nowMs");
  if (notification.status === "expired") return cloneInAppNotification(notification);
  return {
    ...cloneInAppNotification(notification),
    status: "archived",
    archivedAtMs: nowMs,
  };
}

export function markAllInAppNotificationsRead(
  notifications: readonly InAppNotification[],
  input: { userId: string; nowMs: number; type?: string },
): { notifications: InAppNotification[]; changedIds: string[] } {
  assertNonEmpty(input.userId, "userId");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const changedIds: string[] = [];
  const next = notifications.map((notification) => {
    if (notification.userId !== input.userId) return cloneInAppNotification(notification);
    if (input.type !== undefined && notification.type !== input.type) {
      return cloneInAppNotification(notification);
    }
    const updated = markInAppNotificationRead(notification, input.nowMs);
    if (updated.status !== notification.status || updated.readAtMs !== notification.readAtMs) {
      changedIds.push(notification.id);
    }
    return updated;
  });
  return { notifications: next, changedIds };
}

export function archiveMatchingInAppNotifications(
  notifications: readonly InAppNotification[],
  input: { userId: string; nowMs: number; type?: string; includeRead?: boolean },
): { notifications: InAppNotification[]; changedIds: string[] } {
  assertNonEmpty(input.userId, "userId");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const changedIds: string[] = [];
  const next = notifications.map((notification) => {
    if (notification.userId !== input.userId) return cloneInAppNotification(notification);
    if (input.type !== undefined && notification.type !== input.type) {
      return cloneInAppNotification(notification);
    }
    if (!input.includeRead && notification.status === "read") {
      return cloneInAppNotification(notification);
    }
    const updated = archiveInAppNotification(notification, input.nowMs);
    if (
      updated.status !== notification.status ||
      updated.archivedAtMs !== notification.archivedAtMs
    ) {
      changedIds.push(notification.id);
    }
    return updated;
  });
  return { notifications: next, changedIds };
}

export function expireInAppNotification(
  notification: InAppNotification,
  nowMs: number,
): InAppNotification {
  const status = classifyInAppNotification(notification, nowMs);
  return status === "expired"
    ? { ...cloneInAppNotification(notification), status: "expired" }
    : cloneInAppNotification(notification);
}

export function summarizeInAppNotifications(
  notifications: readonly InAppNotification[],
  input: { userId: string; nowMs: number; includeArchived?: boolean },
): InAppNotificationSummary {
  assertNonEmpty(input.userId, "userId");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const visible = notifications
    .map((notification) => expireInAppNotification(notification, input.nowMs))
    .filter((notification) => notification.userId === input.userId)
    .filter((notification) => input.includeArchived || notification.status !== "archived");
  return {
    unread: visible.filter((notification) => notification.status === "unread").length,
    read: visible.filter((notification) => notification.status === "read").length,
    archived: visible.filter((notification) => notification.status === "archived").length,
    expired: visible.filter((notification) => notification.status === "expired").length,
    totalVisible: visible.length,
  };
}

export function pageInAppNotifications(
  notifications: readonly InAppNotification[],
  input: {
    userId: string;
    nowMs: number;
    limit: number;
    cursor?: string;
    includeArchived?: boolean;
  },
): InAppNotificationPage {
  assertNonEmpty(input.userId, "userId");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.limit, "limit");
  const visible = notifications
    .map((notification) => expireInAppNotification(notification, input.nowMs))
    .filter((notification) => notification.userId === input.userId)
    .filter((notification) => notification.status !== "expired")
    .filter((notification) => input.includeArchived || notification.status !== "archived")
    .sort((left, right) => right.createdAtMs - left.createdAtMs || right.id.localeCompare(left.id));
  const start = input.cursor
    ? visible.findIndex((notification) => notification.id === input.cursor) + 1
    : 0;
  const items = visible.slice(Math.max(0, start), Math.max(0, start) + input.limit);
  const next = visible[Math.max(0, start) + input.limit];
  return {
    items: items.map(cloneInAppNotification),
    nextCursor: next?.id,
    unreadCount: visible.filter((notification) => notification.status === "unread").length,
  };
}

export function cloneInAppNotification(notification: InAppNotification): InAppNotification {
  return {
    ...notification,
    metadata: notification.metadata ? { ...notification.metadata } : undefined,
  };
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

export type NotificationChannel = "email" | "sms" | "push" | "in-app" | "webhook";
export type NotificationDeliveryStatus = "pending" | "dispatched";

export interface NotificationMessage {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  priority: "low" | "normal" | "high";
  createdAtMs: number;
  channels?: NotificationChannel[];
  dedupeKey?: string;
}

export interface NotificationPreferences {
  userId: string;
  enabled: boolean;
  channels: NotificationChannel[];
  mutedTypes?: string[];
  quietHours?: {
    startHour: number;
    endHour: number;
    timezoneOffsetMinutes?: number;
  };
}

export interface NotificationRouteDecision {
  messageId: string;
  userId: string;
  channels: NotificationChannel[];
  skipped: boolean;
  reasons: string[];
}

export interface RoutedNotificationDelivery {
  id: string;
  messageId: string;
  userId: string;
  channel: NotificationChannel;
  type: string;
  title: string;
  body: string;
  priority: NotificationMessage["priority"];
  dedupeKey: string;
  status: NotificationDeliveryStatus;
  createdAtMs: number;
  dispatchedAtMs?: number;
}

export function createNotificationMessage(input: {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  priority?: NotificationMessage["priority"];
  createdAtMs: number;
  channels?: NotificationChannel[];
  dedupeKey?: string;
}): NotificationMessage {
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.userId, "userId");
  assertNonEmpty(input.type, "type");
  assertNonEmpty(input.title, "title");
  assertNonEmpty(input.body, "body");
  assertNonNegativeInteger(input.createdAtMs, "createdAtMs");
  if (input.channels) assertChannels(input.channels);
  return {
    id: input.id,
    userId: input.userId,
    type: input.type,
    title: input.title,
    body: input.body,
    priority: input.priority ?? "normal",
    createdAtMs: input.createdAtMs,
    channels: input.channels ? [...input.channels] : undefined,
    dedupeKey: input.dedupeKey,
  };
}

export function normalizePreferences(input: NotificationPreferences): NotificationPreferences {
  assertNonEmpty(input.userId, "userId");
  assertChannels(input.channels);
  if (input.quietHours) {
    assertHour(input.quietHours.startHour, "quietHours.startHour");
    assertHour(input.quietHours.endHour, "quietHours.endHour");
  }
  return {
    userId: input.userId,
    enabled: input.enabled,
    channels: [...new Set(input.channels)],
    mutedTypes: input.mutedTypes ? [...new Set(input.mutedTypes)] : undefined,
    quietHours: input.quietHours ? { ...input.quietHours } : undefined,
  };
}

export function routeNotification(input: {
  message: NotificationMessage;
  preferences?: NotificationPreferences;
  nowMs: number;
  replayed?: boolean;
}): NotificationRouteDecision {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const preferences = input.preferences
    ? normalizePreferences(input.preferences)
    : defaultPreferences(input.message.userId);
  const reasons: string[] = [];
  if (!preferences.enabled) reasons.push("notifications disabled");
  if (preferences.mutedTypes?.includes(input.message.type)) reasons.push("notification type muted");
  if (preferences.quietHours && isQuietHour(input.nowMs, preferences.quietHours)) {
    reasons.push("quiet hours");
  }
  if (input.replayed) reasons.push("dedupe key already routed");

  const preferred = input.message.channels ?? preferences.channels;
  const allowed = preferred.filter((channel) => preferences.channels.includes(channel));
  if (allowed.length === 0) reasons.push("no enabled channels");

  return {
    messageId: input.message.id,
    userId: input.message.userId,
    channels: reasons.length === 0 ? allowed : [],
    skipped: reasons.length > 0,
    reasons,
  };
}

export function notificationDedupeKey(message: NotificationMessage): string {
  return message.dedupeKey ?? `${message.userId}:${message.type}:${message.id}`;
}

export function createNotificationDeliveries(input: {
  message: NotificationMessage;
  decision: NotificationRouteDecision;
}): RoutedNotificationDelivery[] {
  if (input.decision.messageId !== input.message.id) throw new Error("decision message mismatch");
  if (input.decision.userId !== input.message.userId) throw new Error("decision user mismatch");
  if (input.decision.skipped) return [];
  const dedupeKey = notificationDedupeKey(input.message);
  return input.decision.channels.map((channel) => ({
    id: `${input.message.id}:${channel}`,
    messageId: input.message.id,
    userId: input.message.userId,
    channel,
    type: input.message.type,
    title: input.message.title,
    body: input.message.body,
    priority: input.message.priority,
    dedupeKey,
    status: "pending",
    createdAtMs: input.message.createdAtMs,
  }));
}

export function markNotificationDeliveryDispatched(
  delivery: RoutedNotificationDelivery,
  dispatchedAtMs: number,
): RoutedNotificationDelivery {
  assertNonNegativeInteger(dispatchedAtMs, "dispatchedAtMs");
  if (delivery.status === "dispatched") throw new Error("delivery already dispatched");
  if (dispatchedAtMs < delivery.createdAtMs)
    throw new Error("dispatchedAtMs must be >= createdAtMs");
  return { ...delivery, status: "dispatched", dispatchedAtMs };
}

export function cloneNotificationMessage(message: NotificationMessage): NotificationMessage {
  return {
    ...message,
    channels: message.channels ? [...message.channels] : undefined,
  };
}

export function cloneNotificationRouteDecision(
  decision: NotificationRouteDecision,
): NotificationRouteDecision {
  return {
    ...decision,
    channels: [...decision.channels],
    reasons: [...decision.reasons],
  };
}

export function cloneRoutedNotificationDelivery(
  delivery: RoutedNotificationDelivery,
): RoutedNotificationDelivery {
  return { ...delivery };
}

export function isQuietHour(
  nowMs: number,
  quietHours: {
    startHour: number;
    endHour: number;
    timezoneOffsetMinutes?: number;
  },
): boolean {
  assertNonNegativeInteger(nowMs, "nowMs");
  assertHour(quietHours.startHour, "quietHours.startHour");
  assertHour(quietHours.endHour, "quietHours.endHour");
  const offsetMs = (quietHours.timezoneOffsetMinutes ?? 0) * 60_000;
  const hour = new Date(nowMs + offsetMs).getUTCHours();
  if (quietHours.startHour === quietHours.endHour) return false;
  if (quietHours.startHour < quietHours.endHour) {
    return hour >= quietHours.startHour && hour < quietHours.endHour;
  }
  return hour >= quietHours.startHour || hour < quietHours.endHour;
}

function defaultPreferences(userId: string): NotificationPreferences {
  return {
    userId,
    enabled: true,
    channels: ["in-app"],
  };
}

function assertChannels(channels: readonly NotificationChannel[]): void {
  if (channels.length === 0) throw new Error("channels must not be empty");
  for (const channel of channels) {
    if (!["email", "sms", "push", "in-app", "webhook"].includes(channel)) {
      throw new Error(`unsupported notification channel: ${channel}`);
    }
  }
}

function assertHour(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 23) {
    throw new Error(`${name} must be an integer between 0 and 23`);
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

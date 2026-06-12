import {
  type PushBackoffPolicy,
  type PushDeliveryRecord,
  type PushMessage,
  type PushProviderResult,
  type PushTarget,
  applyPushProviderResult,
  clonePushDeliveryRecord,
  createPushDeliveryRecord,
  createPushTarget,
  expirePushDelivery,
  isPushDeliveryDue,
  planPushMessages,
  pushDeliverySummary,
  reschedulePushDelivery,
  suppressPushDelivery,
} from "./core.js";

export type PushProvider = (
  message: PushMessage,
) => Promise<PushProviderResult> | PushProviderResult;

export class MemoryPushDeliveryOutbox {
  private readonly now: () => number;
  private readonly provider: PushProvider;
  private readonly backoff: PushBackoffPolicy;
  private readonly targets = new Map<string, PushTarget>();
  private readonly records = new Map<string, PushDeliveryRecord>();

  constructor(input: {
    now?: () => number;
    provider: PushProvider;
    backoff?: PushBackoffPolicy;
  }) {
    this.now = input.now ?? Date.now;
    this.provider = input.provider;
    this.backoff = input.backoff ?? { baseDelayMs: 1_000, maxDelayMs: 60_000 };
  }

  setTarget(input: {
    userId: string;
    platform: PushTarget["platform"];
    token: string;
    enabled?: boolean;
  }): PushTarget {
    const target = createPushTarget(input);
    this.targets.set(targetKey(target), target);
    return { ...target };
  }

  enqueue(input: {
    id: string;
    userId: string;
    title: string;
    body: string;
    data?: Record<string, string | number | boolean>;
    collapseKey?: string;
    ttlMs?: number;
    maxAttempts?: number;
    suppressedReason?: string;
  }): PushDeliveryRecord[] {
    const messages = planPushMessages({
      id: input.id,
      userId: input.userId,
      title: input.title,
      body: input.body,
      targets: [...this.targets.values()],
      data: input.data,
      collapseKey: input.collapseKey,
      ttlMs: input.ttlMs,
    });
    if (messages.length === 0) {
      const suppressed = createPushDeliveryRecord({
        message: {
          id: `${input.id}:suppressed`,
          userId: input.userId,
          platform: "web",
          token: "missing-target",
          title: input.title,
          body: input.body,
          data: input.data
            ? Object.fromEntries(
                Object.entries(input.data).map(([key, value]) => [key, String(value)]),
              )
            : undefined,
          collapseKey: input.collapseKey,
          ttlMs: input.ttlMs,
        },
        nowMs: this.now(),
        maxAttempts: input.maxAttempts,
        suppressedReason: input.suppressedReason ?? "missing target",
      });
      this.records.set(suppressed.id, suppressed);
      return [clonePushDeliveryRecord(suppressed)];
    }
    const records = messages.map((message) =>
      createPushDeliveryRecord({
        message,
        nowMs: this.now(),
        maxAttempts: input.maxAttempts,
        suppressedReason: input.suppressedReason,
      }),
    );
    for (const record of records) {
      if (this.records.has(record.id)) throw new Error("push delivery already exists");
      this.records.set(record.id, record);
    }
    return records.map(clonePushDeliveryRecord);
  }

  due(): PushDeliveryRecord[] {
    const nowMs = this.now();
    this.expireDue(nowMs);
    return [...this.records.values()]
      .filter((record) => isPushDeliveryDue(record, nowMs))
      .sort(
        (left, right) =>
          left.availableAtMs - right.availableAtMs || left.id.localeCompare(right.id),
      )
      .map(clonePushDeliveryRecord);
  }

  async deliver(id: string): Promise<PushDeliveryRecord> {
    const record = this.records.get(id);
    if (!record) throw new Error("push delivery not found");
    const nowMs = this.now();
    const maybeExpired = expirePushDelivery(record, nowMs);
    if (maybeExpired.status === "dead-lettered" && record.status !== "dead-lettered") {
      this.records.set(id, maybeExpired);
      return clonePushDeliveryRecord(maybeExpired);
    }
    if (!isPushDeliveryDue(record, nowMs)) throw new Error("push delivery is not due");
    const result = await Promise.resolve().then(() => this.provider(record.message));
    const next = applyPushProviderResult(record, {
      nowMs: this.now(),
      result,
      backoff: this.backoff,
    });
    this.records.set(id, next);
    return clonePushDeliveryRecord(next);
  }

  async deliverDue(limit = Number.MAX_SAFE_INTEGER): Promise<PushDeliveryRecord[]> {
    if (!Number.isInteger(limit) || limit <= 0) throw new Error("limit must be a positive integer");
    const delivered: PushDeliveryRecord[] = [];
    for (const record of this.due().slice(0, limit)) {
      delivered.push(await this.deliver(record.id));
    }
    return delivered;
  }

  suppress(id: string, reason: string): PushDeliveryRecord {
    const record = this.records.get(id);
    if (!record) throw new Error("push delivery not found");
    const next = suppressPushDelivery(record, { nowMs: this.now(), reason });
    this.records.set(id, next);
    return clonePushDeliveryRecord(next);
  }

  reschedule(id: string, availableAtMs: number): PushDeliveryRecord {
    const record = this.records.get(id);
    if (!record) throw new Error("push delivery not found");
    const next = reschedulePushDelivery(record, { nowMs: this.now(), availableAtMs });
    this.records.set(id, next);
    return clonePushDeliveryRecord(next);
  }

  disableTarget(input: {
    userId: string;
    platform: PushTarget["platform"];
    token: string;
  }): boolean {
    const target = createPushTarget({ ...input, enabled: false });
    const key = targetKey(target);
    const existing = this.targets.get(key);
    if (!existing) return false;
    this.targets.set(key, { ...existing, enabled: false });
    return true;
  }

  get(id: string): PushDeliveryRecord | undefined {
    const record = this.records.get(id);
    return record ? clonePushDeliveryRecord(record) : undefined;
  }

  list(): PushDeliveryRecord[] {
    return [...this.records.values()]
      .sort(
        (left, right) => left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id),
      )
      .map(clonePushDeliveryRecord);
  }

  summary(): ReturnType<typeof pushDeliverySummary> {
    this.expireDue(this.now());
    return pushDeliverySummary([...this.records.values()], { nowMs: this.now() });
  }

  private expireDue(nowMs: number): void {
    for (const [id, record] of this.records) {
      const next = expirePushDelivery(record, nowMs);
      if (next !== record) this.records.set(id, next);
    }
  }
}

function targetKey(target: PushTarget): string {
  return `${target.userId}:${target.platform}:${target.token}`;
}

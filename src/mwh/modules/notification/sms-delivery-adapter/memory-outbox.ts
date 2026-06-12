import {
  type SmsBackoffPolicy,
  type SmsDeliveryRecord,
  type SmsMessage,
  type SmsProviderResult,
  applySmsProviderResult,
  cloneSmsDeliveryRecord,
  createSmsDeliveryRecord,
  createSmsMessage,
  isSmsDeliveryDue,
  rescheduleSmsDelivery,
  smsDeliverySummary,
  suppressSmsDelivery,
} from "./core.js";

export type SmsProvider = (message: SmsMessage) => Promise<SmsProviderResult> | SmsProviderResult;

export class MemorySmsDeliveryOutbox {
  private readonly now: () => number;
  private readonly provider: SmsProvider;
  private readonly backoff: SmsBackoffPolicy;
  private readonly records = new Map<string, SmsDeliveryRecord>();

  constructor(input: {
    now?: () => number;
    provider: SmsProvider;
    backoff?: SmsBackoffPolicy;
  }) {
    this.now = input.now ?? Date.now;
    this.provider = input.provider;
    this.backoff = input.backoff ?? { baseDelayMs: 1_000, maxDelayMs: 60_000 };
  }

  enqueue(input: {
    id: string;
    to: string;
    body: string;
    from?: string;
    metadata?: Record<string, string>;
    maxAttempts?: number;
    suppressedReason?: string;
  }): SmsDeliveryRecord {
    if (this.records.has(input.id)) throw new Error("SMS delivery already exists");
    const message = createSmsMessage(input);
    const record = createSmsDeliveryRecord({
      message,
      nowMs: this.now(),
      maxAttempts: input.maxAttempts,
      suppressedReason: input.suppressedReason,
    });
    this.records.set(record.id, record);
    return cloneSmsDeliveryRecord(record);
  }

  due(): SmsDeliveryRecord[] {
    const nowMs = this.now();
    return [...this.records.values()]
      .filter((record) => isSmsDeliveryDue(record, nowMs))
      .sort(
        (left, right) =>
          left.availableAtMs - right.availableAtMs || left.id.localeCompare(right.id),
      )
      .map(cloneSmsDeliveryRecord);
  }

  async deliver(id: string): Promise<SmsDeliveryRecord> {
    const record = this.records.get(id);
    if (!record) throw new Error("SMS delivery not found");
    if (!isSmsDeliveryDue(record, this.now())) throw new Error("SMS delivery is not due");
    const result = await Promise.resolve().then(() => this.provider(record.message));
    const next = applySmsProviderResult(record, {
      nowMs: this.now(),
      result,
      backoff: this.backoff,
    });
    this.records.set(id, next);
    return cloneSmsDeliveryRecord(next);
  }

  async deliverDue(limit = Number.MAX_SAFE_INTEGER): Promise<SmsDeliveryRecord[]> {
    if (!Number.isInteger(limit) || limit <= 0) throw new Error("limit must be a positive integer");
    const delivered: SmsDeliveryRecord[] = [];
    for (const record of this.due().slice(0, limit)) {
      delivered.push(await this.deliver(record.id));
    }
    return delivered;
  }

  suppress(id: string, reason: string): SmsDeliveryRecord {
    const record = this.records.get(id);
    if (!record) throw new Error("SMS delivery not found");
    const next = suppressSmsDelivery(record, { nowMs: this.now(), reason });
    this.records.set(id, next);
    return cloneSmsDeliveryRecord(next);
  }

  reschedule(id: string, availableAtMs: number): SmsDeliveryRecord {
    const record = this.records.get(id);
    if (!record) throw new Error("SMS delivery not found");
    const next = rescheduleSmsDelivery(record, { nowMs: this.now(), availableAtMs });
    this.records.set(id, next);
    return cloneSmsDeliveryRecord(next);
  }

  get(id: string): SmsDeliveryRecord | undefined {
    const record = this.records.get(id);
    return record ? cloneSmsDeliveryRecord(record) : undefined;
  }

  list(): SmsDeliveryRecord[] {
    return [...this.records.values()]
      .sort(
        (left, right) => left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id),
      )
      .map(cloneSmsDeliveryRecord);
  }

  summary(): ReturnType<typeof smsDeliverySummary> {
    return smsDeliverySummary([...this.records.values()], { nowMs: this.now() });
  }
}

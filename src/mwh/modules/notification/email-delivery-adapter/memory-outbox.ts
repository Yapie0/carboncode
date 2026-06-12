import {
  type EmailBackoffPolicy,
  type EmailDeliveryRecord,
  type EmailMessage,
  type EmailProviderResult,
  applyEmailProviderResult,
  cloneEmailDeliveryRecord,
  createEmailDeliveryRecord,
  createEmailMessage,
  emailDeliverySummary,
  isEmailDeliveryDue,
  rescheduleEmailDelivery,
  suppressEmailDelivery,
} from "./core.js";

export type EmailProvider = (
  message: EmailMessage,
) => Promise<EmailProviderResult> | EmailProviderResult;

export class MemoryEmailDeliveryOutbox {
  private readonly now: () => number;
  private readonly provider: EmailProvider;
  private readonly backoff: EmailBackoffPolicy;
  private readonly records = new Map<string, EmailDeliveryRecord>();

  constructor(input: {
    now?: () => number;
    provider: EmailProvider;
    backoff?: EmailBackoffPolicy;
  }) {
    this.now = input.now ?? Date.now;
    this.provider = input.provider;
    this.backoff = input.backoff ?? { baseDelayMs: 1_000, maxDelayMs: 60_000 };
  }

  enqueue(input: {
    id: string;
    to: string | string[];
    subject: string;
    text: string;
    html?: string;
    from?: string;
    replyTo?: string;
    metadata?: Record<string, string>;
    maxAttempts?: number;
    suppressedReason?: string;
  }): EmailDeliveryRecord {
    if (this.records.has(input.id)) throw new Error("email delivery already exists");
    const message = createEmailMessage(input);
    const record = createEmailDeliveryRecord({
      message,
      nowMs: this.now(),
      maxAttempts: input.maxAttempts,
      suppressedReason: input.suppressedReason,
    });
    this.records.set(record.id, record);
    return cloneEmailDeliveryRecord(record);
  }

  due(): EmailDeliveryRecord[] {
    const nowMs = this.now();
    return [...this.records.values()]
      .filter((record) => isEmailDeliveryDue(record, nowMs))
      .sort(
        (left, right) =>
          left.availableAtMs - right.availableAtMs || left.id.localeCompare(right.id),
      )
      .map(cloneEmailDeliveryRecord);
  }

  async deliver(id: string): Promise<EmailDeliveryRecord> {
    const record = this.records.get(id);
    if (!record) throw new Error("email delivery not found");
    if (!isEmailDeliveryDue(record, this.now())) throw new Error("email delivery is not due");
    const result = await Promise.resolve().then(() => this.provider(record.message));
    const next = applyEmailProviderResult(record, {
      nowMs: this.now(),
      result,
      backoff: this.backoff,
    });
    this.records.set(id, next);
    return cloneEmailDeliveryRecord(next);
  }

  async deliverDue(limit = Number.MAX_SAFE_INTEGER): Promise<EmailDeliveryRecord[]> {
    if (!Number.isInteger(limit) || limit <= 0) throw new Error("limit must be a positive integer");
    const delivered: EmailDeliveryRecord[] = [];
    for (const record of this.due().slice(0, limit)) {
      delivered.push(await this.deliver(record.id));
    }
    return delivered;
  }

  suppress(id: string, reason: string): EmailDeliveryRecord {
    const record = this.records.get(id);
    if (!record) throw new Error("email delivery not found");
    const next = suppressEmailDelivery(record, { nowMs: this.now(), reason });
    this.records.set(id, next);
    return cloneEmailDeliveryRecord(next);
  }

  reschedule(id: string, availableAtMs: number): EmailDeliveryRecord {
    const record = this.records.get(id);
    if (!record) throw new Error("email delivery not found");
    const next = rescheduleEmailDelivery(record, { nowMs: this.now(), availableAtMs });
    this.records.set(id, next);
    return cloneEmailDeliveryRecord(next);
  }

  get(id: string): EmailDeliveryRecord | undefined {
    const record = this.records.get(id);
    return record ? cloneEmailDeliveryRecord(record) : undefined;
  }

  list(): EmailDeliveryRecord[] {
    return [...this.records.values()]
      .sort(
        (left, right) => left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id),
      )
      .map(cloneEmailDeliveryRecord);
  }

  summary(): ReturnType<typeof emailDeliverySummary> {
    return emailDeliverySummary([...this.records.values()], { nowMs: this.now() });
  }
}

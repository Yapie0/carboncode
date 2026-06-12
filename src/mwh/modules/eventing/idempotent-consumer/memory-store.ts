import {
  type BeginConsumeResult,
  type ConsumerMessageRecord,
  type ConsumerMessageSnapshot,
  type ConsumerMessageStatus,
  beginConsume,
  cloneConsumerMessageRecord,
  consumerMessageKey,
  consumerMessageSnapshot,
  markConsumerFailed,
  markConsumerSucceeded,
} from "./core.js";

export interface MemoryIdempotentConsumerStoreOptions {
  now?: () => number;
  lockMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  defaultMaxAttempts?: number;
}

export class MemoryIdempotentConsumerStore {
  private readonly now: () => number;
  private readonly lockMs: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly defaultMaxAttempts: number;
  private readonly records = new Map<string, ConsumerMessageRecord>();

  constructor(opts: MemoryIdempotentConsumerStoreOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.lockMs = opts.lockMs ?? 30_000;
    this.baseDelayMs = opts.baseDelayMs ?? 1_000;
    this.maxDelayMs = opts.maxDelayMs ?? 60_000;
    this.defaultMaxAttempts = opts.defaultMaxAttempts ?? 5;
  }

  begin(input: {
    consumerName: string;
    messageId: string;
    workerId: string;
    maxAttempts?: number;
  }): BeginConsumeResult {
    const key = consumerMessageKey(input);
    const result = beginConsume({
      ...input,
      existing: this.records.get(key),
      nowMs: this.now(),
      lockMs: this.lockMs,
      maxAttempts: input.maxAttempts ?? this.defaultMaxAttempts,
    });
    if (result.kind === "started") this.records.set(key, result.record);
    if (result.kind === "skip" && result.record.status === "dead-letter") {
      this.records.set(key, result.record);
    }
    return cloneBeginConsumeResult(result);
  }

  succeed(
    consumerName: string,
    messageId: string,
    workerId: string,
    result?: unknown,
  ): ConsumerMessageRecord {
    const key = consumerMessageKey({ consumerName, messageId });
    const record = this.require(key);
    const next = markConsumerSucceeded(record, {
      nowMs: this.now(),
      workerId,
      result,
    });
    this.records.set(key, next);
    return cloneConsumerMessageRecord(next);
  }

  fail(
    consumerName: string,
    messageId: string,
    workerId: string,
    error: string,
  ): ConsumerMessageRecord {
    const key = consumerMessageKey({ consumerName, messageId });
    const record = this.require(key);
    const next = markConsumerFailed(record, {
      nowMs: this.now(),
      workerId,
      error,
      baseDelayMs: this.baseDelayMs,
      maxDelayMs: this.maxDelayMs,
    });
    this.records.set(key, next);
    return cloneConsumerMessageRecord(next);
  }

  get(consumerName: string, messageId: string): ConsumerMessageRecord | undefined {
    const record = this.records.get(consumerMessageKey({ consumerName, messageId }));
    return record ? cloneConsumerMessageRecord(record) : undefined;
  }

  list(status?: ConsumerMessageStatus): ConsumerMessageRecord[] {
    const records = [...this.records.values()].sort(
      (left, right) =>
        left.firstSeenAtMs - right.firstSeenAtMs || left.key.localeCompare(right.key),
    );
    return (status ? records.filter((record) => record.status === status) : records).map(
      cloneConsumerMessageRecord,
    );
  }

  snapshot(): ConsumerMessageSnapshot {
    return consumerMessageSnapshot([...this.records.values()], this.now());
  }

  private require(key: string): ConsumerMessageRecord {
    const record = this.records.get(key);
    if (!record) throw new Error(`consumer message record not found: ${key}`);
    return record;
  }
}

function cloneBeginConsumeResult(result: BeginConsumeResult): BeginConsumeResult {
  if (result.kind === "skip") {
    return { ...result, record: cloneConsumerMessageRecord(result.record) };
  }
  return { ...result, record: cloneConsumerMessageRecord(result.record) };
}

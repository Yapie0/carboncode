import {
  type OutboxEvent,
  type OutboxEventStatus,
  claimOutboxEvent,
  cloneOutboxEvent,
  createOutboxEvent,
  failOutboxEvent,
  markOutboxPublished,
  releaseFailedForRetry,
  summarizeOutboxEvents,
} from "./core.js";

export interface MemoryOutboxStoreOptions {
  now?: () => number;
  claimTimeoutMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export class MemoryOutboxStore {
  private readonly now: () => number;
  private readonly claimTimeoutMs: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly events = new Map<string, OutboxEvent>();

  constructor(opts: MemoryOutboxStoreOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.claimTimeoutMs = opts.claimTimeoutMs ?? 30_000;
    this.baseDelayMs = opts.baseDelayMs ?? 1000;
    this.maxDelayMs = opts.maxDelayMs ?? 60_000;
  }

  append(input: {
    id: string;
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    payload: unknown;
    maxAttempts?: number;
  }): OutboxEvent {
    if (this.events.has(input.id)) throw new Error(`outbox event already exists: ${input.id}`);
    const event = createOutboxEvent({ ...input, nowMs: this.now() });
    this.events.set(event.id, event);
    return cloneOutboxEvent(event);
  }

  claimNext(workerId: string): OutboxEvent | null {
    this.releaseDueRetries();
    const candidates = [...this.events.values()]
      .filter((event) => event.status === "pending" || event.status === "claimed")
      .sort((a, b) => a.createdAtMs - b.createdAtMs);

    for (const event of candidates) {
      const result = claimOutboxEvent({
        event,
        workerId,
        nowMs: this.now(),
        claimTimeoutMs: this.claimTimeoutMs,
      });
      if (result.kind === "claimed") {
        this.events.set(result.event.id, result.event);
        return cloneOutboxEvent(result.event);
      }
    }
    return null;
  }

  claimBatch(workerId: string, limit: number): OutboxEvent[] {
    if (!Number.isInteger(limit) || limit <= 0) throw new Error("limit must be a positive integer");
    const claimed: OutboxEvent[] = [];
    for (let index = 0; index < limit; index += 1) {
      const event = this.claimNext(workerId);
      if (!event) break;
      claimed.push(event);
    }
    return claimed;
  }

  publish(id: string): OutboxEvent {
    const event = this.require(id);
    const next = markOutboxPublished(event, this.now());
    this.events.set(id, next);
    return cloneOutboxEvent(next);
  }

  fail(id: string, error: string): OutboxEvent {
    const event = this.require(id);
    const next = failOutboxEvent({
      event,
      error,
      nowMs: this.now(),
      baseDelayMs: this.baseDelayMs,
      maxDelayMs: this.maxDelayMs,
    });
    this.events.set(id, next);
    return cloneOutboxEvent(next);
  }

  releaseDueRetries(): number {
    let released = 0;
    for (const event of this.events.values()) {
      if (event.status !== "failed") continue;
      const next = releaseFailedForRetry(event, this.now());
      if (next !== event) {
        this.events.set(event.id, next);
        released++;
      }
    }
    return released;
  }

  list(status?: OutboxEventStatus): OutboxEvent[] {
    const events = [...this.events.values()].sort((a, b) => a.createdAtMs - b.createdAtMs);
    return (status ? events.filter((event) => event.status === status) : events).map(
      cloneOutboxEvent,
    );
  }

  get(id: string): OutboxEvent | undefined {
    const event = this.events.get(id);
    return event ? cloneOutboxEvent(event) : undefined;
  }

  summary(): ReturnType<typeof summarizeOutboxEvents> {
    return summarizeOutboxEvents([...this.events.values()], { nowMs: this.now() });
  }

  private require(id: string): OutboxEvent {
    const event = this.events.get(id);
    if (!event) throw new Error(`outbox event not found: ${id}`);
    return event;
  }
}

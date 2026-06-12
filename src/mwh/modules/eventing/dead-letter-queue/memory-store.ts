import {
  type DeadLetterMessage,
  type DeadLetterReason,
  type DeadLetterSnapshot,
  archiveDeadLetter,
  claimDeadLetterForReplay,
  cloneDeadLetterMessage,
  createDeadLetterMessage,
  deadLetterId,
  deadLetterSnapshot,
  purgeArchivedDeadLetters,
  releaseDeadLetterReplay,
  requeueDeadLetter,
  resolveDeadLetter,
} from "./core.js";

export interface MemoryDeadLetterQueueOptions {
  now?: () => number;
}

export class MemoryDeadLetterQueue {
  private readonly messages = new Map<string, DeadLetterMessage>();
  private readonly now: () => number;

  constructor(options: MemoryDeadLetterQueueOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  enqueue(input: {
    source: string;
    messageId: string;
    reason: DeadLetterReason;
    payload: unknown;
    headers?: Record<string, string>;
    error: string;
    attempts: number;
  }): DeadLetterMessage {
    const message = createDeadLetterMessage({ ...input, nowMs: this.now() });
    if (this.messages.has(message.id)) throw new Error("dead-letter message already exists");
    this.messages.set(message.id, message);
    return cloneDeadLetterMessage(message);
  }

  claimReplay(input: { source: string; messageId: string; workerId: string; lockMs: number }):
    | { kind: "claimed"; message: DeadLetterMessage }
    | { kind: "skip"; message: DeadLetterMessage; reason: string } {
    const id = deadLetterId(input);
    const result = claimDeadLetterForReplay({
      message: this.requireMessage(id),
      workerId: input.workerId,
      nowMs: this.now(),
      lockMs: input.lockMs,
    });
    this.messages.set(id, result.message);
    if (result.kind === "skip") {
      return {
        kind: "skip",
        message: cloneDeadLetterMessage(result.message),
        reason: result.reason ?? "",
      };
    }
    return { kind: "claimed", message: cloneDeadLetterMessage(result.message) };
  }

  claimBatch(input: {
    workerId: string;
    lockMs: number;
    limit: number;
    source?: string;
  }): Array<{ kind: "claimed"; message: DeadLetterMessage }> {
    if (!Number.isInteger(input.limit) || input.limit <= 0) {
      throw new Error("limit must be a positive integer");
    }
    const claimed: Array<{ kind: "claimed"; message: DeadLetterMessage }> = [];
    for (const message of this.list({ status: "queued", source: input.source })) {
      if (claimed.length >= input.limit) break;
      const result = this.claimReplay({
        source: message.source,
        messageId: message.messageId,
        workerId: input.workerId,
        lockMs: input.lockMs,
      });
      if (result.kind === "claimed") claimed.push(result);
    }
    return claimed;
  }

  releaseReplay(input: {
    source: string;
    messageId: string;
    workerId?: string;
    error: string;
  }): DeadLetterMessage {
    const id = deadLetterId(input);
    const message = releaseDeadLetterReplay(this.requireMessage(id), {
      nowMs: this.now(),
      workerId: input.workerId,
      error: input.error,
    });
    this.messages.set(id, message);
    return cloneDeadLetterMessage(message);
  }

  resolve(input: {
    source: string;
    messageId: string;
    workerId?: string;
    note?: string;
  }): DeadLetterMessage {
    const id = deadLetterId(input);
    const message = resolveDeadLetter(this.requireMessage(id), {
      nowMs: this.now(),
      workerId: input.workerId,
      note: input.note,
    });
    this.messages.set(id, message);
    return cloneDeadLetterMessage(message);
  }

  archive(input: { source: string; messageId: string; note?: string }): DeadLetterMessage {
    const id = deadLetterId(input);
    const message = archiveDeadLetter(this.requireMessage(id), {
      nowMs: this.now(),
      note: input.note,
    });
    this.messages.set(id, message);
    return cloneDeadLetterMessage(message);
  }

  requeue(input: { source: string; messageId: string; note?: string }): DeadLetterMessage {
    const id = deadLetterId(input);
    const message = requeueDeadLetter(this.requireMessage(id), {
      nowMs: this.now(),
      note: input.note,
    });
    this.messages.set(id, message);
    return cloneDeadLetterMessage(message);
  }

  purgeArchived(input: { olderThanMs: number }): DeadLetterMessage[] {
    const result = purgeArchivedDeadLetters([...this.messages.values()], {
      olderThanMs: input.olderThanMs,
      nowMs: this.now(),
    });
    this.messages.clear();
    for (const message of result.retained) {
      this.messages.set(message.id, message);
    }
    return result.purged.map(cloneDeadLetterMessage);
  }

  list(input: { status?: DeadLetterMessage["status"]; source?: string } = {}): DeadLetterMessage[] {
    return [...this.messages.values()]
      .filter((message) => !input.status || message.status === input.status)
      .filter((message) => !input.source || message.source === input.source)
      .sort(
        (left, right) => left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id),
      )
      .map(cloneDeadLetterMessage);
  }

  snapshot(): DeadLetterSnapshot {
    return deadLetterSnapshot([...this.messages.values()]);
  }

  private requireMessage(id: string): DeadLetterMessage {
    const message = this.messages.get(id);
    if (!message) throw new Error("dead-letter message not found");
    return cloneDeadLetterMessage(message);
  }
}

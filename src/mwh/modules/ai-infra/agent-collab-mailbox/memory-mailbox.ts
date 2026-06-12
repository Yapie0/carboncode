import {
  type CollabInboxEntry,
  type CollabMessage,
  type CollabMessageType,
  type CollabOutboxEntry,
  cloneInboxEntry,
  cloneOutboxEntry,
  collabThread,
  createCollabMessage,
  createCollabReply,
  createInboxEntry,
  createOutboxEntry,
  filterInbox,
  markInboxRead,
} from "./core.js";

export class MemoryAgentCollabMailbox<TBody = Record<string, unknown>> {
  private readonly now: () => number;
  private readonly inboxes = new Map<string, CollabInboxEntry<TBody>[]>();
  private readonly outboxes = new Map<string, CollabOutboxEntry<TBody>[]>();
  private nextId = 1;

  constructor(input: { now?: () => number } = {}) {
    this.now = input.now ?? Date.now;
  }

  send(input: {
    from: string;
    to: string;
    type: CollabMessageType;
    body: TBody;
    taskId?: string;
    id?: string;
  }): CollabMessage<TBody> {
    const message = createCollabMessage({
      id: input.id ?? `msg-${this.nextId}`,
      from: input.from,
      to: input.to,
      type: input.type,
      taskId: input.taskId,
      body: input.body,
      nowMs: this.now(),
    });
    if (input.id === undefined) this.nextId += 1;
    this.inboxFor(message.to).push(createInboxEntry(message));
    this.outboxFor(message.from).push(createOutboxEntry(message, { nowMs: this.now() }));
    return { ...message, body: cloneBody(message.body) };
  }

  reply(input: {
    agent: string;
    messageId: string;
    type: CollabMessageType;
    body: TBody;
    id?: string;
  }): CollabMessage<TBody> {
    const inbox = this.inboxFor(input.agent);
    const entry = inbox.find((candidate) => candidate.message.id === input.messageId);
    if (!entry) throw new Error("message not found");
    const message = createCollabReply({
      id: input.id ?? `msg-${this.nextId}`,
      replyTo: entry.message,
      type: input.type,
      body: input.body,
      nowMs: this.now(),
    });
    if (input.id === undefined) this.nextId += 1;
    this.inboxFor(message.to).push(createInboxEntry(message));
    this.outboxFor(message.from).push(createOutboxEntry(message, { nowMs: this.now() }));
    return { ...message, body: cloneBody(message.body) };
  }

  ack(agent: string, messageId: string, body: TBody): CollabMessage<TBody> {
    return this.reply({ agent, messageId, type: "ack", body });
  }

  readInbox(
    agent: string,
    input: { unreadOnly?: boolean; taskId?: string; from?: string } = {},
  ): CollabInboxEntry<TBody>[] {
    return filterInbox(this.inboxFor(agent), input);
  }

  readOutbox(agent: string): CollabOutboxEntry<TBody>[] {
    return this.outboxFor(agent).map(cloneOutboxEntry);
  }

  markRead(agent: string, messageId: string): CollabInboxEntry<TBody> {
    const inbox = this.inboxFor(agent);
    const index = inbox.findIndex((entry) => entry.message.id === messageId);
    if (index < 0) throw new Error("message not found");
    const next = markInboxRead(inbox[index]!, { nowMs: this.now() });
    inbox[index] = next;
    return cloneInboxEntry(next);
  }

  thread(agent: string, taskId: string): CollabMessage<TBody>[] {
    return collabThread(this.inboxFor(agent), this.outboxFor(agent), taskId);
  }

  unreadCount(agent: string): number {
    return this.inboxFor(agent).filter((entry) => entry.readAtMs === undefined).length;
  }

  private inboxFor(agent: string): CollabInboxEntry<TBody>[] {
    const existing = this.inboxes.get(agent);
    if (existing) return existing;
    const created: CollabInboxEntry<TBody>[] = [];
    this.inboxes.set(agent, created);
    return created;
  }

  private outboxFor(agent: string): CollabOutboxEntry<TBody>[] {
    const existing = this.outboxes.get(agent);
    if (existing) return existing;
    const created: CollabOutboxEntry<TBody>[] = [];
    this.outboxes.set(agent, created);
    return created;
  }
}

function cloneBody<TBody>(body: TBody): TBody {
  if (body === undefined) return body;
  return JSON.parse(JSON.stringify(body)) as TBody;
}

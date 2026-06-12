export type CollabMessageType =
  | "note"
  | "task"
  | "result"
  | "permission_request"
  | "permission_response"
  | "ack"
  | "error";

export interface CollabMessage<TBody = Record<string, unknown>> {
  id: string;
  from: string;
  to: string;
  type: CollabMessageType;
  taskId?: string;
  body: TBody;
  createdAtMs: number;
}

export interface CollabInboxEntry<TBody = Record<string, unknown>> {
  message: CollabMessage<TBody>;
  readAtMs?: number;
}

export interface CollabOutboxEntry<TBody = Record<string, unknown>> {
  message: CollabMessage<TBody>;
  deliveredAtMs: number;
}

export function createCollabMessage<TBody>(input: {
  id: string;
  from: string;
  to: string;
  type: CollabMessageType;
  body: TBody;
  nowMs: number;
  taskId?: string;
}): CollabMessage<TBody> {
  assertNonEmpty(input.id, "id");
  assertAgentName(input.from, "from");
  assertAgentName(input.to, "to");
  if (input.from === input.to) throw new Error("from and to must be different agents");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  validateMessageType(input.type);
  if (input.type === "permission_request") validatePermissionRequestBody(input.body);
  if (input.type === "permission_response") validatePermissionResponseBody(input.body);
  return {
    id: input.id,
    from: input.from,
    to: input.to,
    type: input.type,
    taskId: input.taskId,
    body: cloneValue(input.body),
    createdAtMs: input.nowMs,
  };
}

export function createCollabReply<TBody>(input: {
  id: string;
  replyTo: CollabMessage<unknown>;
  type: CollabMessageType;
  body: TBody;
  nowMs: number;
  from?: string;
}): CollabMessage<TBody> {
  const from = input.from ?? input.replyTo.to;
  if (from !== input.replyTo.to) {
    throw new Error("reply sender must be the original recipient");
  }
  return createCollabMessage({
    id: input.id,
    from,
    to: input.replyTo.from,
    type: input.type,
    taskId: input.replyTo.taskId,
    body: input.body,
    nowMs: input.nowMs,
  });
}

export function createInboxEntry<TBody>(message: CollabMessage<TBody>): CollabInboxEntry<TBody> {
  return { message: cloneCollabMessage(message) };
}

export function createOutboxEntry<TBody>(
  message: CollabMessage<TBody>,
  input: { nowMs: number },
): CollabOutboxEntry<TBody> {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  return {
    message: cloneCollabMessage(message),
    deliveredAtMs: input.nowMs,
  };
}

export function markInboxRead<TBody>(
  entry: CollabInboxEntry<TBody>,
  input: { nowMs: number },
): CollabInboxEntry<TBody> {
  assertNonNegativeInteger(input.nowMs, "nowMs");
  return {
    message: cloneCollabMessage(entry.message),
    readAtMs: entry.readAtMs ?? input.nowMs,
  };
}

export function filterInbox<TBody>(
  entries: readonly CollabInboxEntry<TBody>[],
  input: { unreadOnly?: boolean; taskId?: string; from?: string } = {},
): CollabInboxEntry<TBody>[] {
  return entries
    .filter((entry) => !input.unreadOnly || entry.readAtMs === undefined)
    .filter((entry) => input.taskId === undefined || entry.message.taskId === input.taskId)
    .filter((entry) => input.from === undefined || entry.message.from === input.from)
    .sort((left, right) => left.message.createdAtMs - right.message.createdAtMs)
    .map(cloneInboxEntry);
}

export function collabThread<TBody>(
  inboxEntries: readonly CollabInboxEntry<TBody>[],
  outboxEntries: readonly CollabOutboxEntry<TBody>[],
  taskId: string,
): CollabMessage<TBody>[] {
  assertNonEmpty(taskId, "taskId");
  return [
    ...inboxEntries.map((entry) => entry.message),
    ...outboxEntries.map((entry) => entry.message),
  ]
    .filter((message) => message.taskId === taskId)
    .sort((left, right) => left.createdAtMs - right.createdAtMs || left.id.localeCompare(right.id))
    .map(cloneCollabMessage);
}

export function cloneCollabMessage<TBody>(message: CollabMessage<TBody>): CollabMessage<TBody> {
  return {
    ...message,
    body: cloneValue(message.body),
  };
}

export function cloneInboxEntry<TBody>(entry: CollabInboxEntry<TBody>): CollabInboxEntry<TBody> {
  return {
    message: cloneCollabMessage(entry.message),
    readAtMs: entry.readAtMs,
  };
}

export function cloneOutboxEntry<TBody>(entry: CollabOutboxEntry<TBody>): CollabOutboxEntry<TBody> {
  return {
    message: cloneCollabMessage(entry.message),
    deliveredAtMs: entry.deliveredAtMs,
  };
}

function validatePermissionRequestBody(body: unknown): void {
  if (!body || typeof body !== "object") {
    throw new Error("permission_request body must be an object");
  }
  const reason = (body as { reason?: unknown }).reason;
  if (typeof reason !== "string" || !reason.trim()) {
    throw new Error("permission_request body.reason is required");
  }
}

function validatePermissionResponseBody(body: unknown): void {
  if (!body || typeof body !== "object") {
    throw new Error("permission_response body must be an object");
  }
  const approved = (body as { approved?: unknown }).approved;
  if (typeof approved !== "boolean") {
    throw new Error("permission_response body.approved is required");
  }
}

function validateMessageType(type: CollabMessageType): void {
  if (
    ![
      "note",
      "task",
      "result",
      "permission_request",
      "permission_response",
      "ack",
      "error",
    ].includes(type)
  ) {
    throw new Error("message type is invalid");
  }
}

function assertAgentName(value: string, name: string): void {
  assertNonEmpty(value, name);
  if (!/^[A-Za-z0-9._-]+$/.test(value)) {
    throw new Error(`${name} must be a stable agent id`);
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative integer`);
}

function cloneValue<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

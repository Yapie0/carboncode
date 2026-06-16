/**
 * Carbon Code Teams — Agent 邮箱操作。
 *
 * 参考 MWH agent-collab-mailbox 模块设计：
 * - 输入验证（assertAgentName、assertNonEmpty）
 * - reply 语义（自动翻转 from/to + 继承 taskId）
 * - ack 快捷回复
 * - readAtMs 时间点已读模型
 * - clone 安全（每次读写深拷贝）
 * - JSONL 文件持久化
 */

import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { inboxJsonlPath, outboxJsonlPath } from "./paths.js";
import type { TeamMessage, TeamMessageType } from "./types.js";

// ─── 输入验证（参考 MWH core.ts） ─────────────────────────────────

const AGENT_NAME_RE = /^[A-Za-z0-9._-]+$/;

function assertAgentName(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required`);
  if (!AGENT_NAME_RE.test(value)) {
    throw new Error(`${label} must be a stable agent id (got "${value}")`);
  }
}

function assertNonEmpty(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required`);
}

function assertValidMessageType(type: TeamMessageType): void {
  const valid = new Set<TeamMessageType>([
    "note",
    "task",
    "task_assigned",
    "progress",
    "permission_request",
    "permission_response",
    "submitted",
    "blocked",
    "review",
    "result",
    "ack",
  ]);
  if (!valid.has(type)) {
    throw new Error(`invalid message type: ${type}`);
  }
}

function assertPermissionRequestBody(body: Record<string, unknown>): void {
  if (typeof body.reason !== "string" || !body.reason.trim()) {
    throw new Error("permission_request body.reason is required");
  }
}

function assertPermissionResponseBody(body: Record<string, unknown>): void {
  if (typeof body.approved !== "boolean") {
    throw new Error("permission_response body.approved is required");
  }
}

// ─── Clone 安全（参考 MWH cloneValue / cloneCollabMessage） ─────────

function cloneMessage(msg: TeamMessage): TeamMessage {
  return JSON.parse(JSON.stringify(msg)) as TeamMessage;
}

// ─── JSONL 读写 ────────────────────────────────────────────────────

function appendJsonl(path: string, entry: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf-8");
}

function readJsonl<T>(path: string): T[] {
  try {
    const raw = readFileSync(path, "utf-8").trim();
    if (!raw) return [];
    return raw.split("\n").map((line) => JSON.parse(line) as T);
  } catch {
    return [];
  }
}

function writeJsonl(path: string, entries: Array<Record<string, unknown>>): void {
  const lines = entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length > 0 ? "\n" : "");
  writeFileSync(path, lines, "utf-8");
}

// ─── 消息创建 ──────────────────────────────────────────────────────

export interface SendMessageInput {
  from: string;
  to: string;
  type: TeamMessageType;
  taskId?: string;
  body?: Record<string, unknown>;
  inReplyTo?: string;
}

export function createMessage(input: SendMessageInput): TeamMessage {
  assertAgentName(input.from, "from");
  assertAgentName(input.to, "to");
  assertNonEmpty(input.from, "from");
  assertNonEmpty(input.to, "to");
  assertValidMessageType(input.type);

  if (input.from === input.to) {
    throw new Error("from and to must be different agents");
  }
  if (input.type === "permission_request") {
    assertPermissionRequestBody(input.body ?? {});
  }
  if (input.type === "permission_response") {
    assertPermissionResponseBody(input.body ?? {});
  }

  return {
    id: randomUUID(),
    taskId: input.taskId ?? "",
    from: input.from,
    to: input.to,
    type: input.type,
    createdAt: new Date().toISOString(),
    readAtMs: undefined,
    inReplyTo: input.inReplyTo,
    body: input.body ?? {},
  };
}

// ─── Reply（参考 MWH createCollabReply） ────────────────────────────

export interface ReplyInput {
  agent: string;
  replyToId: string;
  type: TeamMessageType;
  body?: Record<string, unknown>;
}

/** 回复消息——自动翻转 from/to，继承 taskId，写入 inReplyTo 链。 */
export function reply(workspaceRoot: string, teamId: string, input: ReplyInput): TeamMessage {
  // 从 inbox 找到原消息
  const inbox = readJsonl<TeamMessage>(inboxJsonlPath(workspaceRoot, teamId, input.agent));
  const original = inbox.find((m) => m.id === input.replyToId);
  if (!original) throw new Error("original message not found");

  // 回复者必须是原消息的接收者
  if (input.agent !== original.to) {
    throw new Error("reply sender must be the original recipient");
  }

  return sendMessage(workspaceRoot, teamId, {
    from: input.agent,
    to: original.from,
    type: input.type,
    taskId: original.taskId,
    body: input.body,
    inReplyTo: input.replyToId,
  });
}

/** 快捷 ack——等价于 reply(type: "ack")。 */
export function ack(
  workspaceRoot: string,
  teamId: string,
  agent: string,
  messageId: string,
  body: Record<string, unknown> = {},
): TeamMessage {
  return reply(workspaceRoot, teamId, { agent, replyToId: messageId, type: "ack", body });
}

// ─── 发送消息 ──────────────────────────────────────────────────────

export function sendMessage(
  workspaceRoot: string,
  teamId: string,
  input: SendMessageInput,
): TeamMessage {
  const msg = createMessage(input);

  appendJsonl(
    inboxJsonlPath(workspaceRoot, teamId, input.to),
    msg as unknown as Record<string, unknown>,
  );
  appendJsonl(
    outboxJsonlPath(workspaceRoot, teamId, input.from),
    msg as unknown as Record<string, unknown>,
  );

  return cloneMessage(msg);
}

// ─── 读取 inbox ────────────────────────────────────────────────────

export interface ReadInboxOptions {
  unreadOnly?: boolean;
  taskId?: string;
  from?: string;
}

export function readInbox(
  workspaceRoot: string,
  teamId: string,
  agentId: string,
  options: ReadInboxOptions = {},
): TeamMessage[] {
  let messages = readJsonl<TeamMessage>(inboxJsonlPath(workspaceRoot, teamId, agentId));

  if (options.unreadOnly) {
    messages = messages.filter((m) => m.readAtMs === undefined);
  }
  if (options.taskId) {
    messages = messages.filter((m) => m.taskId === options.taskId);
  }
  if (options.from) {
    messages = messages.filter((m) => m.from === options.from);
  }

  return messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(cloneMessage);
}

// ─── 读取 outbox ───────────────────────────────────────────────────

export function readOutbox(workspaceRoot: string, teamId: string, agentId: string): TeamMessage[] {
  const messages = readJsonl<TeamMessage>(outboxJsonlPath(workspaceRoot, teamId, agentId));
  return messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(cloneMessage);
}

// ─── 标记已读（时间点模型） ────────────────────────────────────────

export function markRead(
  workspaceRoot: string,
  teamId: string,
  agentId: string,
  messageId: string,
): TeamMessage {
  const path = inboxJsonlPath(workspaceRoot, teamId, agentId);
  const messages = readJsonl<TeamMessage>(path);
  const idx = messages.findIndex((m) => m.id === messageId);
  if (idx < 0) throw new Error("message not found");

  const msg = messages[idx]!;
  if (msg.readAtMs !== undefined) return cloneMessage(msg); // already read

  msg.readAtMs = Date.now();
  writeJsonl(path, messages as unknown as Array<Record<string, unknown>>);
  return cloneMessage(msg);
}

export function markAllRead(workspaceRoot: string, teamId: string, agentId: string): number {
  const path = inboxJsonlPath(workspaceRoot, teamId, agentId);
  const messages = readJsonl<TeamMessage>(path);
  const now = Date.now();
  let count = 0;

  for (const msg of messages) {
    if (msg.readAtMs === undefined) {
      msg.readAtMs = now;
      count++;
    }
  }

  if (count > 0) {
    writeJsonl(path, messages as unknown as Array<Record<string, unknown>>);
  }
  return count;
}

// ─── 未读计数 ──────────────────────────────────────────────────────

export function unreadCount(workspaceRoot: string, teamId: string, agentId: string): number {
  const messages = readJsonl<TeamMessage>(inboxJsonlPath(workspaceRoot, teamId, agentId));
  return messages.filter((m) => m.readAtMs === undefined).length;
}

// ─── 线程（按 taskId 聚合收发） ───────────────────────────────────

export function thread(
  workspaceRoot: string,
  teamId: string,
  agentId: string,
  taskId: string,
): TeamMessage[] {
  assertNonEmpty(taskId, "taskId");

  const inbox = readJsonl<TeamMessage>(inboxJsonlPath(workspaceRoot, teamId, agentId));
  const outbox = readJsonl<TeamMessage>(outboxJsonlPath(workspaceRoot, teamId, agentId));

  const sorted = [...inbox, ...outbox]
    .filter((m) => m.taskId === taskId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

  return sorted.map(cloneMessage);
}

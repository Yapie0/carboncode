import { readFileSync } from "node:fs";
import {
  type CollabMessageType,
  type CollabTaskStatus,
  assignTask,
  checkProtocol,
  initCollab,
  listInboxMessages,
  listTasks,
  readInboxMessages,
  renderCollabConnectPrompt,
  resolveInboxRoot,
  respondToTask,
  sendMessage,
  updateTaskStatus,
} from "../../collab/inbox.js";

export interface CollabInitOptions {
  agent: string;
  root?: string;
  force?: boolean;
  json?: boolean;
}

export interface CollabCheckOptions {
  root?: string;
  json?: boolean;
}

export interface InboxListOptions {
  agent: string;
  root?: string;
  json?: boolean;
}

export interface InboxReadOptions extends InboxListOptions {
  all?: boolean;
  noMarkRead?: boolean;
}

export interface TaskAssignOptions {
  to: string;
  file: string;
  root?: string;
  title?: string;
  workspace?: string;
  by?: string;
  writeScope?: string[];
  verify?: string[];
  json?: boolean;
}

export interface TaskStatusOptions {
  root?: string;
  json?: boolean;
  set?: string;
}

export interface TaskRespondOptions {
  root?: string;
  task: string;
  to?: string;
  from?: string;
  request?: string;
  note?: string;
  approve?: boolean;
  reject?: boolean;
  json?: boolean;
}

export interface CollabSendOptions {
  root?: string;
  from: string;
  to: string;
  type: string;
  task?: string;
  body?: string;
  bodyFile?: string;
  json?: boolean;
}

export function collabInitCommand(opts: CollabInitOptions): void {
  const root = resolveInboxRoot(opts.root);
  const result = initCollab({ collabRoot: root, agent: opts.agent, force: !!opts.force });
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(result.ok ? "collab protocol ready" : `collab protocol invalid: ${result.reason}`);
  console.log(`protocol: ${result.protocolPath}`);
  console.log(`hash: ${result.hashPath}`);
  console.log("");
  console.log("Copy this prompt to Codex, Claude Code, or another coding agent:");
  console.log("");
  console.log(renderCollabConnectPrompt(opts.agent, root));
}

export function collabCheckCommand(opts: CollabCheckOptions): void {
  const root = resolveInboxRoot(opts.root);
  const result = checkProtocol(root);
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (result.ok) {
    console.log(`collab protocol ok: ${result.protocolPath}`);
    return;
  }
  console.log(`collab protocol invalid: ${result.reason}`);
  console.log(`protocol: ${result.protocolPath}`);
  console.log(`expected: ${result.expectedHash ?? "(missing)"}`);
  console.log(`actual: ${result.actualHash ?? "(missing)"}`);
}

export function inboxListCommand(opts: InboxListOptions): void {
  const root = resolveInboxRoot(opts.root);
  const messages = listInboxMessages(opts.agent, root);
  if (opts.json) {
    console.log(JSON.stringify(messages, null, 2));
    return;
  }
  if (messages.length === 0) {
    console.log(`inbox ${opts.agent}: no messages`);
    return;
  }
  const unread = messages.filter((m) => !m.read).length;
  console.log(`inbox ${opts.agent}: ${messages.length} message(s), ${unread} unread`);
  for (const msg of messages) {
    console.log(formatMessageLine(msg));
  }
}

export function inboxReadCommand(opts: InboxReadOptions): void {
  const root = resolveInboxRoot(opts.root);
  const messages = readInboxMessages(opts.agent, {
    inboxRoot: root,
    all: opts.all,
    markRead: opts.noMarkRead !== true,
  });
  if (opts.json) {
    console.log(JSON.stringify(messages, null, 2));
    return;
  }
  if (messages.length === 0) {
    console.log(`inbox ${opts.agent}: no ${opts.all ? "" : "unread "}messages`);
    return;
  }
  for (const msg of messages) {
    console.log(formatMessageBlock(msg));
  }
}

export function taskAssignCommand(opts: TaskAssignOptions): void {
  const root = resolveInboxRoot(opts.root);
  const task = assignTask({
    inboxRoot: root,
    to: opts.to,
    file: opts.file,
    title: opts.title,
    workspace: opts.workspace,
    createdBy: opts.by,
    writeScope: opts.writeScope ?? [],
    verification: opts.verify ?? [],
  });
  if (opts.json) {
    console.log(JSON.stringify(task, null, 2));
    return;
  }
  console.log(`assigned ${task.id} -> ${task.assignee}`);
  console.log(`task file: ${root}/tasks/${task.id}.md`);
}

export function taskStatusCommand(opts: TaskStatusOptions): void {
  const root = resolveInboxRoot(opts.root);
  if (opts.set) {
    const [taskId, rawStatus] = opts.set.split("=");
    if (!taskId || !rawStatus) throw new Error("--set must be <taskId>=<status>");
    updateTaskStatus(taskId, parseStatus(rawStatus), root);
  }
  const tasks = listTasks(root);
  if (opts.json) {
    console.log(JSON.stringify(tasks, null, 2));
    return;
  }
  if (tasks.length === 0) {
    console.log("no collaboration tasks");
    return;
  }
  for (const task of tasks) {
    console.log(`${task.id}  ${task.status.padEnd(9)}  ${task.assignee.padEnd(12)}  ${task.title}`);
  }
}

export function taskRespondCommand(opts: TaskRespondOptions): void {
  const root = resolveInboxRoot(opts.root);
  const msg = respondToTask({
    inboxRoot: root,
    taskId: opts.task,
    to: opts.to,
    from: opts.from,
    requestId: opts.request,
    note: opts.note,
    approve: opts.approve,
    reject: opts.reject,
  });
  if (opts.json) {
    console.log(JSON.stringify(msg, null, 2));
    return;
  }
  console.log(`${String(msg.body.decision)} ${msg.taskId} -> ${msg.to}`);
}

export function collabSendCommand(opts: CollabSendOptions): void {
  const root = resolveInboxRoot(opts.root);
  const body = parseBody(opts.body, opts.bodyFile);
  const msg = sendMessage({
    inboxRoot: root,
    from: opts.from,
    to: opts.to,
    type: parseMessageType(opts.type),
    taskId: opts.task,
    body,
  });
  if (opts.json) {
    console.log(JSON.stringify(msg, null, 2));
    return;
  }
  console.log(`sent ${msg.type} ${msg.id} ${msg.from} -> ${msg.to}`);
}

function formatMessageLine(msg: {
  id: string;
  taskId: string;
  type: string;
  from: string;
  read: boolean;
  createdAt: string;
}): string {
  return `${msg.read ? "read " : "new  "} ${msg.createdAt} ${msg.type} ${msg.taskId} from ${msg.from}`;
}

function formatMessageBlock(msg: {
  id: string;
  taskId: string;
  from: string;
  to: string;
  type: string;
  createdAt: string;
  body: Record<string, unknown>;
}): string {
  return [
    `${msg.type} ${msg.taskId}`,
    `  id: ${msg.id}`,
    `  from: ${msg.from}`,
    `  to: ${msg.to}`,
    `  at: ${msg.createdAt}`,
    `  body: ${JSON.stringify(msg.body)}`,
  ].join("\n");
}

function parseStatus(raw: string): CollabTaskStatus {
  const statuses: readonly CollabTaskStatus[] = [
    "queued",
    "assigned",
    "running",
    "blocked",
    "submitted",
    "accepted",
    "rejected",
  ];
  if ((statuses as readonly string[]).includes(raw)) return raw as CollabTaskStatus;
  throw new Error(`invalid status: ${raw}`);
}

function parseMessageType(raw: string): CollabMessageType {
  const types: readonly CollabMessageType[] = [
    "note",
    "task",
    "task_assigned",
    "progress",
    "permission_request",
    "permission_response",
    "submitted",
    "blocked",
    "review",
  ];
  if ((types as readonly string[]).includes(raw)) return raw as CollabMessageType;
  throw new Error(`invalid message type: ${raw}`);
}

function parseBody(raw: string | undefined, file: string | undefined): Record<string, unknown> {
  if (raw && file) throw new Error("use only one of --body or --body-file");
  if (!raw && !file) return {};
  const text = file ? readFileSync(file, "utf8").replace(/^\uFEFF/, "") : raw!;
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("message body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

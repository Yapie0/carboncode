import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export type CollabTaskStatus =
  | "queued"
  | "assigned"
  | "running"
  | "blocked"
  | "submitted"
  | "accepted"
  | "rejected";

export type CollabMessageType =
  | "note"
  | "task"
  | "task_assigned"
  | "progress"
  | "permission_request"
  | "permission_response"
  | "submitted"
  | "blocked"
  | "review";

export interface CollabTask {
  id: string;
  title: string;
  status: CollabTaskStatus;
  assignee: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  workspace: string;
  instructions: string;
  writeScope: string[];
  verification: string[];
  result: null | Record<string, unknown>;
}

export interface CollabMessage {
  id: string;
  taskId: string;
  from: string;
  to: string;
  type: CollabMessageType;
  createdAt: string;
  read: boolean;
  body: Record<string, unknown>;
}

interface CollabState {
  tasks: CollabTask[];
}

export interface AssignTaskInput {
  inboxRoot?: string;
  to: string;
  file: string;
  title?: string;
  workspace?: string;
  createdBy?: string;
  writeScope?: string[];
  verification?: string[];
}

export interface RespondInput {
  inboxRoot?: string;
  taskId: string;
  to?: string;
  from?: string;
  approve?: boolean;
  reject?: boolean;
  requestId?: string;
  note?: string;
}

export interface SendMessageInput {
  inboxRoot?: string;
  from: string;
  to: string;
  type: CollabMessageType;
  taskId?: string;
  body?: Record<string, unknown>;
}

export interface CollabInitInput {
  collabRoot?: string;
  agent: string;
  force?: boolean;
}

export interface CollabProtocolCheck {
  ok: boolean;
  protocolPath: string;
  hashPath: string;
  expectedHash: string | null;
  actualHash: string | null;
  reason?: string;
}

export function defaultCollabRoot(cwd: string = process.cwd()): string {
  return join(cwd, ".carboncode", "collab");
}

export const defaultInboxRoot = defaultCollabRoot;

export function loadCollabState(inboxRoot: string = defaultCollabRoot()): CollabState {
  const path = statePath(inboxRoot);
  if (!existsSync(path)) return { tasks: [] };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.tasks)) {
      return { tasks: parsed.tasks.filter(isTask) };
    }
  } catch {
    /* malformed state is treated as empty; task files remain on disk for audit */
  }
  return { tasks: [] };
}

export function saveCollabState(state: CollabState, inboxRoot: string = defaultCollabRoot()): void {
  atomicWriteJson(statePath(inboxRoot), state);
}

export function listTasks(inboxRoot: string = defaultCollabRoot()): CollabTask[] {
  return loadCollabState(inboxRoot).tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function listInboxMessages(
  agent: string,
  inboxRoot: string = defaultCollabRoot(),
): CollabMessage[] {
  const path = agentBoxPath(inboxRoot, agent, "inbox");
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim());
  const messages: CollabMessage[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (isMessage(parsed)) messages.push(parsed);
    } catch {
      /* skip malformed inbox lines */
    }
  }
  return messages;
}

export function readInboxMessages(
  agent: string,
  opts: { all?: boolean; markRead?: boolean; inboxRoot?: string } = {},
): CollabMessage[] {
  const inboxRoot = opts.inboxRoot ?? defaultInboxRoot();
  const messages = listInboxMessages(agent, inboxRoot);
  const selected = opts.all ? messages : messages.filter((m) => !m.read);
  if (opts.markRead !== false && selected.length > 0) {
    const selectedIds = new Set(selected.map((m) => m.id));
    const next = messages.map((m) => (selectedIds.has(m.id) ? { ...m, read: true } : m));
    writeAgentMessages(agent, "inbox", next, inboxRoot);
  }
  return selected;
}

export function assignTask(input: AssignTaskInput): CollabTask {
  const inboxRoot = input.inboxRoot ?? defaultInboxRoot();
  const instructions = readFileSync(input.file, "utf8").trim();
  const now = new Date().toISOString();
  const task: CollabTask = {
    id: nextTaskId(now),
    title: input.title?.trim() || titleFromMarkdown(instructions) || basename(input.file),
    status: "assigned",
    assignee: input.to,
    createdBy: input.createdBy ?? "carboncode",
    createdAt: now,
    updatedAt: now,
    workspace: input.workspace ?? ".",
    instructions,
    writeScope: input.writeScope ?? [],
    verification: input.verification ?? [],
    result: null,
  };

  const state = loadCollabState(inboxRoot);
  state.tasks = [task, ...state.tasks.filter((t) => t.id !== task.id)];
  saveCollabState(state, inboxRoot);
  writeTaskMarkdown(task, inboxRoot);
  deliverMessage(task.createdBy, input.to, taskAssignedMessage(task), inboxRoot);
  return task;
}

export function updateTaskStatus(
  taskId: string,
  status: CollabTaskStatus,
  inboxRoot: string = defaultCollabRoot(),
): CollabTask {
  const state = loadCollabState(inboxRoot);
  const idx = state.tasks.findIndex((t) => t.id === taskId);
  if (idx < 0) throw new Error(`task not found: ${taskId}`);
  const current = state.tasks[idx]!;
  const next = { ...current, status, updatedAt: new Date().toISOString() };
  state.tasks[idx] = next;
  saveCollabState(state, inboxRoot);
  writeTaskMarkdown(next, inboxRoot);
  return next;
}

export function respondToTask(input: RespondInput): CollabMessage {
  if ((input.approve ? 1 : 0) + (input.reject ? 1 : 0) !== 1) {
    throw new Error("choose exactly one of approve or reject");
  }
  const inboxRoot = input.inboxRoot ?? defaultInboxRoot();
  const task = loadCollabState(inboxRoot).tasks.find((t) => t.id === input.taskId);
  if (!task) throw new Error(`task not found: ${input.taskId}`);
  const approved = input.approve === true;
  const from = input.from ?? "carboncode";
  const to = input.to ?? task.assignee;
  const msg: CollabMessage = {
    id: nextMessageId(),
    taskId: input.taskId,
    from,
    to,
    type: "permission_response",
    createdAt: new Date().toISOString(),
    read: false,
    body: {
      requestId: input.requestId ?? null,
      decision: approved ? "approved" : "rejected",
      note: input.note ?? "",
    },
  };
  deliverMessage(from, to, msg, inboxRoot);
  return msg;
}

export function sendMessage(input: SendMessageInput): CollabMessage {
  const inboxRoot = input.inboxRoot ?? defaultCollabRoot();
  const msg: CollabMessage = {
    id: nextMessageId(),
    taskId: input.taskId ?? "",
    from: input.from,
    to: input.to,
    type: input.type,
    createdAt: new Date().toISOString(),
    read: false,
    body: input.body ?? {},
  };
  deliverMessage(input.from, input.to, msg, inboxRoot);
  return msg;
}

export function deliverMessage(
  from: string,
  to: string,
  message: CollabMessage,
  inboxRoot: string = defaultCollabRoot(),
): void {
  appendMessage(to, "inbox", message, inboxRoot);
  appendMessage(from, "outbox", message, inboxRoot);
}

export function appendMessage(
  agent: string,
  box: "inbox" | "outbox",
  message: CollabMessage,
  inboxRoot: string = defaultCollabRoot(),
): void {
  const path = agentBoxPath(inboxRoot, agent, box);
  mkdirSync(dirname(path), { recursive: true });
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const next = `${existing}${existing.endsWith("\n") || existing.length === 0 ? "" : "\n"}${JSON.stringify(message)}\n`;
  atomicWriteText(path, next);
}

function writeAgentMessages(
  agent: string,
  box: "inbox" | "outbox",
  messages: CollabMessage[],
  inboxRoot: string = defaultCollabRoot(),
): void {
  const path = agentBoxPath(inboxRoot, agent, box);
  atomicWriteText(path, `${messages.map((m) => JSON.stringify(m)).join("\n")}\n`);
}

function taskAssignedMessage(task: CollabTask): CollabMessage {
  return {
    id: nextMessageId(),
    taskId: task.id,
    from: task.createdBy,
    to: task.assignee,
    type: "task_assigned",
    createdAt: new Date().toISOString(),
    read: false,
    body: {
      title: task.title,
      workspace: task.workspace,
      taskFile: `tasks/${task.id}.md`,
      writeScope: task.writeScope,
      verification: task.verification,
    },
  };
}

function writeTaskMarkdown(task: CollabTask, inboxRoot: string): void {
  const frontmatter = JSON.stringify(
    {
      id: task.id,
      title: task.title,
      status: task.status,
      assignee: task.assignee,
      createdBy: task.createdBy,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      workspace: task.workspace,
      writeScope: task.writeScope,
      verification: task.verification,
      result: task.result,
    },
    null,
    2,
  );
  const body = `---json\n${frontmatter}\n---\n\n${task.instructions.trim()}\n`;
  atomicWriteText(join(inboxRoot, "tasks", `${task.id}.md`), body);
}

function agentBoxPath(inboxRoot: string, agent: string, box: "inbox" | "outbox"): string {
  return join(inboxRoot, "agents", safeAgentName(agent), `${box}.jsonl`);
}

function statePath(inboxRoot: string): string {
  return join(inboxRoot, "state.json");
}

function safeAgentName(agent: string): string {
  const safe = agent
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!safe) throw new Error("agent name is required");
  return safe;
}

function nextTaskId(nowIso: string): string {
  const stamp = nowIso.replace(/[-:.TZ]/g, "").slice(0, 14);
  return `task-${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextMessageId(): string {
  return `msg-${randomUUID()}`;
}

function titleFromMarkdown(markdown: string): string | null {
  const line = markdown.split(/\r?\n/).find((l) => l.trim().length > 0);
  if (!line) return null;
  return (
    line
      .replace(/^#+\s*/, "")
      .trim()
      .slice(0, 120) || null
  );
}

function atomicWriteJson(path: string, value: unknown): void {
  atomicWriteText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function atomicWriteText(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, value, "utf8");
  renameSync(tmp, path);
}

function isTask(value: unknown): value is CollabTask {
  const v = value as Partial<CollabTask>;
  return (
    !!v &&
    typeof v.id === "string" &&
    typeof v.title === "string" &&
    typeof v.status === "string" &&
    typeof v.assignee === "string" &&
    typeof v.createdAt === "string" &&
    typeof v.updatedAt === "string" &&
    typeof v.workspace === "string" &&
    typeof v.instructions === "string" &&
    Array.isArray(v.writeScope) &&
    Array.isArray(v.verification)
  );
}

function isMessage(value: unknown): value is CollabMessage {
  const v = value as Partial<CollabMessage>;
  return (
    !!v &&
    typeof v.id === "string" &&
    typeof v.taskId === "string" &&
    typeof v.from === "string" &&
    typeof v.to === "string" &&
    typeof v.type === "string" &&
    typeof v.createdAt === "string" &&
    typeof v.read === "boolean" &&
    !!v.body &&
    typeof v.body === "object"
  );
}

export function resolveInboxRoot(raw: string | undefined, cwd: string = process.cwd()): string {
  return raw ? resolve(cwd, raw) : defaultCollabRoot(cwd);
}

export function initCollab(input: CollabInitInput): CollabProtocolCheck {
  const root = input.collabRoot ?? defaultCollabRoot();
  const agent = safeAgentName(input.agent);
  mkdirSync(join(root, "agents", agent), { recursive: true });
  mkdirSync(join(root, "tasks"), { recursive: true });
  for (const box of ["inbox", "outbox"] as const) {
    const path = agentBoxPath(root, agent, box);
    if (!existsSync(path)) atomicWriteText(path, "");
  }
  const protocolPath = join(root, "protocol.md");
  const hashPath = join(root, "protocol.sha256");
  if (!existsSync(protocolPath) || input.force) {
    atomicWriteText(protocolPath, renderProtocol(agent));
    atomicWriteText(hashPath, hashProtocol(readFileSync(protocolPath, "utf8")));
  }
  return checkProtocol(root);
}

export function renderCollabConnectPrompt(carbonAgent: string, collabRoot: string): string {
  const agent = safeAgentName(carbonAgent);
  const protocolPath = join(collabRoot, "protocol.md");
  return `You are joining a Carbon Code collaboration session as an external coding agent.

Use this local file protocol instead of opening a network port.

- Collaboration root: ${collabRoot}
- Protocol file: ${protocolPath}
- Carbon Code agent name: ${agent}
- Your agent name: choose a stable id, for example "codex" or "claude-code".

Read the protocol file first. Do not edit protocol.md or protocol.sha256.

To send a message to Carbon Code, create a JSON object in a temporary file and run:

carboncode collab send --from <your-agent-name> --to ${agent} --type note --body-file <json-file> --root "${collabRoot}"

To read messages addressed to you:

carboncode collab inbox read --agent <your-agent-name> --root "${collabRoot}" --json

If your agent environment supports background tasks, hooks, automations, reminders, or scheduled continuations, configure one for this session:

- Schedule: every 2 minutes while collaboration is active, or the closest supported interval.
- Agent name: choose one stable id and reuse it for every run, for example "codex", "claude-code", or "cursor".
- On each run, read only messages addressed to your agent name:

carboncode collab inbox read --agent <your-agent-name> --root "${collabRoot}" --json

- If there are no unread messages, finish silently.
- If there are unread messages, process them in createdAt order.
- Reply to Carbon Code by writing a JSON body to a temporary file and running:

carboncode collab send --from <your-agent-name> --to ${agent} --type note --task <taskId-if-any> --body-file <json-file> --root "${collabRoot}"

- Include the original message id in the reply body as "inReplyTo".
- Use type "permission_request" instead of "note" before sensitive shell commands, broad filesystem edits, network access, credential changes, or publishing actions.
- Do not read Carbon Code's outbox directly; your inbox is .carboncode/collab/agents/<your-agent-name>/inbox.jsonl.

If the carboncode command is unavailable, write JSONL directly according to protocol.md:
- append incoming messages to .carboncode/collab/agents/<recipient>/inbox.jsonl
- append sent-message audit entries to .carboncode/collab/agents/<sender>/outbox.jsonl

Check your inbox periodically, include from/to/type/taskId/body in every message, and request permission with type "permission_request" before sensitive actions.`;
}

export function checkProtocol(collabRoot: string = defaultCollabRoot()): CollabProtocolCheck {
  const protocolPath = join(collabRoot, "protocol.md");
  const hashPath = join(collabRoot, "protocol.sha256");
  if (!existsSync(protocolPath)) {
    return {
      ok: false,
      protocolPath,
      hashPath,
      expectedHash: null,
      actualHash: null,
      reason: "missing protocol.md",
    };
  }
  const actualHash = hashProtocol(readFileSync(protocolPath, "utf8"));
  if (!existsSync(hashPath)) {
    return {
      ok: false,
      protocolPath,
      hashPath,
      expectedHash: null,
      actualHash,
      reason: "missing protocol.sha256",
    };
  }
  const expectedHash = readFileSync(hashPath, "utf8").trim();
  return {
    ok: expectedHash === actualHash,
    protocolPath,
    hashPath,
    expectedHash,
    actualHash,
    reason: expectedHash === actualHash ? undefined : "protocol hash mismatch",
  };
}

function hashProtocol(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function renderProtocol(agent: string): string {
  return `# Carbon Code Collaboration Protocol

This workspace exposes a file-based collaboration protocol for local agents.

## Agent

- Current agent: \`${agent}\`
- Collaboration root: \`.carboncode/collab\`

## Mailboxes

- Send messages to an agent by appending JSONL to \`.carboncode/collab/agents/<agent>/inbox.jsonl\`.
- Keep a sent-message audit by appending the same JSONL to your own \`.carboncode/collab/agents/<agent>/outbox.jsonl\`.
- Do not delete messages after reading. Mark them with \`read: true\` or append follow-up messages.

## Message Shape

\`\`\`json
{
  "id": "msg-uuid",
  "taskId": "task-id-or-empty",
  "from": "sender-agent",
  "to": "receiver-agent",
  "type": "note | task | task_assigned | progress | permission_request | permission_response | submitted | blocked | review",
  "createdAt": "2026-06-08T00:00:00.000Z",
  "read": false,
  "body": {}
}
\`\`\`

## Rules

- Every message must include \`id\`, \`from\`, \`to\`, \`type\`, \`createdAt\`, and \`body\`.
- Sensitive actions should be represented as \`permission_request\` and must wait for \`permission_response\`.
- Task completion is a \`submitted\` message; only the leader may mark a task \`accepted\`.
- Prefer project-relative paths and explicit write scopes.
- This file is protected by \`protocol.sha256\`; unexpected edits should be treated as untrusted until reviewed.
`;
}

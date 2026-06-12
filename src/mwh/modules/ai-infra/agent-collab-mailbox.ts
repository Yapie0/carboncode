import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Agent Collaboration Mailbox

## Purpose

Use this module as a reusable reference for local multi-agent communication: normalized message envelopes, inbox/outbox append semantics, read acknowledgements, task threads, and permission_request messages.

This module is the protocol layer that can back Carbon Code collaboration mode, Codex/Claude Code handoff prompts, local JSONL inboxes, MCP mailbox tools, or file-based agent coordination.

## When To Use

- Need agents to exchange notes, task assignments, results, acknowledgements, or permission requests.
- Need a deterministic local inbox/outbox model before adding file or MCP adapters.
- Need taskId-based threads across multiple agents.
- Need external agents to communicate without opening a network port.

## When Not To Use

- Do not use memory storage as a durable mailbox.
- Do not put secrets in message bodies unless the recipient is trusted.
- Do not treat read acknowledgement as task completion.
- Do not let untrusted agents write arbitrary protocol files.

## Implementation Variants

- Memory mailbox for tests and local prototypes.
- JSONL file mailbox under .carboncode/collab/agents/<agent>/inbox.jsonl and outbox.jsonl.
- MCP tools exposing inbox read, send, markRead, and thread operations.
- SQL mailbox with durable message ids and read receipts.
- Broker mailbox mapping to agent-specific queues or topics.

## Recommended Architecture

- core.ts: pure message validation, inbox/outbox entry creation, read marking, filtering, task threads, and clone helpers.
- memory-mailbox.ts: stateful send, readInbox, readOutbox, markRead, thread, and unreadCount behavior.
- adapters/jsonl.ts: append-only file protocol with atomic temp-file writes.
- adapters/mcp.ts: expose send/read/update/delete mailbox tools.
- integrations/dispatcher.ts: convert agent-task-dispatcher assignments into task messages.

## Public API Sketch

\`\`\`ts
const mailbox = new MemoryAgentCollabMailbox();
mailbox.send({
  from: "carboncode",
  to: "codex",
  type: "task",
  taskId: "mwh-42",
  body: { title: "implement vector module" },
});

const unread = mailbox.readInbox("codex", { unreadOnly: true });
mailbox.markRead("codex", unread[0]!.message.id);
\`\`\`

## Integration Rules

1. Include from, to, type, taskId, and body in messages.
2. Use stable agent ids such as carboncode, codex, claude-code, or cbc-worker-1.
3. Append incoming messages to recipient inbox and audit sent messages in sender outbox.
4. Use permission_request before sensitive actions.
5. Treat inbox reads as at-least-once; consumers should be idempotent.
6. Hash or protect protocol files that external agents should not edit.

## Failure Modes

- Duplicate processing when readers do not track message ids.
- Lost messages when file appends are not atomic.
- Confused routing when agent ids are unstable.
- Sensitive actions performed without permission_request.
- Inbox growth without retention or compaction.

## Security Notes

- Validate agent ids and message types before writing to storage.
- Do not allow external agents to mutate protocol.md or protocol hashes.
- Store permission decisions with taskId and message id.
- Redact secrets before writing JSONL audit logs.

## Verification Checklist

- Stateless tests cover message validation, permission_request body checks, inbox/outbox entry creation, read marking, filtering, threading, and clone safety.
- Stateful tests cover send, inbox/outbox audit, unread count, markRead, from/task filters, thread ordering, multiple agents, and clone-safe message bodies.
- File adapter tests should cover atomic append, malformed JSONL rejection, and restart reads.
- MCP adapter tests should cover send/read/update/delete tool behavior.

## Source References

- Local file-based inbox/outbox collaboration protocols.
- Append-only JSONL audit logs.
- Multi-agent handoff and permission request patterns.
- MCP resource/tool exposure for local stateful capabilities.
`;

export const AGENT_COLLAB_MAILBOX_MODULE: MwhModule = {
  id: "agent-collab-mailbox",
  title: "Agent Collaboration Mailbox",
  summary:
    "Reusable AI infrastructure reference for multi-agent inbox/outbox messages, read acknowledgements, task threads, and permission_request flows.",
  version: "0.1.0",
  tags: ["ai-infra", "agent", "collaboration", "mailbox", "inbox", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};

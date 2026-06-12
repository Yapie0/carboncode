import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Audit Log Trail Middleware

## Purpose

Use this module as a reusable reference when implementing security and compliance audit trails for user actions, admin changes, auth events, billing changes, data access, and privileged operations.

The module contains pure audit event creation, metadata redaction, append-only hash-chain entries, chain verification, and query matching plus a deterministic memory store for tests. Production adapters should persist entries in SQL, append-only object storage, event streams, or an immutable audit service.

## When To Use

- Track who did what to which resource and whether it succeeded.
- Need tamper-evident log entries with previous-hash chaining.
- Need deterministic tests for redaction and audit integrity.
- Need a provider-neutral contract before choosing SQL, Kafka, object storage, or SIEM export.

## When Not To Use

- Do not use memory storage for production audit retention.
- Do not store raw secrets, tokens, passwords, or authorization headers.
- Do not treat audit logs as metrics or tracing spans.
- Do not allow normal application users to modify audit entries.

## Implementation Variants

1. Memory store
   - Deterministic unit tests and local examples.
2. SQL append-only table
   - sequence, previousHash, hash, actor, resource, action, metadata.
3. Object storage archive
   - Periodic immutable JSONL/Parquet batches with manifest hashes.
4. SIEM/event stream export
   - Forward verified entries to Splunk, Elastic, Datadog, or cloud audit services.

## Recommended Architecture

- core.ts: pure event validation, redaction, stable hashing, append, verify, and query matching.
- memory-store.ts: stateful append, appendEvent, query, list, and chain verification.
- adapters/sql.ts: transactionally append audit entries.
- adapters/archive.ts: batch export with manifest checksum.
- policy.ts: action taxonomy, metadata allow-list, retention rules.

## Public API Sketch

\`\`\`ts
const audit = new MemoryAuditLogStore({ redactedKeys: ["password", "token"] });
audit.append({
  id: "audit_1",
  actorId: "admin_1",
  action: "update",
  resourceType: "user",
  resourceId: "user_2",
  metadata: { changed: ["role"], token: "secret" },
});
const integrity = audit.verify();
const entries = audit.query({ actorId: "admin_1", resourceType: "user" });
\`\`\`

## Integration Rules

1. Append audit events in the same transaction as sensitive state changes when possible.
2. Use stable action names and resource types.
3. Redact or reject sensitive metadata before persistence.
4. Chain hashes with previousHash to detect deletion or mutation.
5. Export immutable batches for long-term retention.
6. Keep audit authorization separate from ordinary application read APIs.

## Failure Modes

- Mutable logs cannot prove integrity after an incident.
- Missing transaction coupling can create business changes without audit entries.
- Raw metadata can leak secrets.
- Sequence gaps or previous-hash mismatches indicate deletion, reordering, or tampering.
- High-cardinality action names make investigation harder.

## Security Notes

- Treat audit metadata as sensitive user/admin data.
- Restrict write access to server-side trusted code.
- Restrict read access to support, security, or compliance roles.
- Use immutable storage or external export for high-risk systems.

## Verification Checklist

- Stateless tests cover event creation, nested redaction, deterministic hashing, append sequence, query matching, valid chain, mutated entry detection, and sequence gaps.
- Stateful tests cover append, appendEvent, query filters, limit, clone-safe reads, and chain verification.
- SQL adapter tests should verify transactional append and sequence locking.
- Archive tests should verify JSONL batch hash manifests and restore verification.

## Source References

- Append-only audit log patterns.
- Hash-chain tamper-evident logging.
- Security event redaction and retention policies.
- SIEM export and immutable archive patterns.
`;

export const AUDIT_LOG_TRAIL_MODULE: MwhModule = {
  id: "audit-log-trail",
  title: "Audit Log Trail Middleware",
  summary:
    "Reusable observability audit-log reference with redaction, append-only hash chains, integrity verification, and stateful query tests.",
  version: "0.1.0",
  tags: ["observability", "audit", "logging", "security", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};

import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Distributed Lock Middleware

## Purpose

Use this module as a reusable reference when building distributed locks, lease-based mutual exclusion, cache stampede prevention, singleton workers, cron leader election, or fencing-token protected writes.

The module contains pure lock lifecycle transitions plus a deterministic memory store for tests. Production adapters can use Redis SET NX PX, PostgreSQL advisory locks, database rows with compare-and-swap, ZooKeeper, etcd, or cloud-native coordination services.

## When To Use

- Prevent duplicate expensive work across replicas.
- Elect one worker for a periodic task.
- Protect a resource with a short lease and explicit owner token.
- Use fencing tokens to reject stale owners at downstream storage.

## When Not To Use

- Do not use process memory for cross-process production locking.
- Do not use locks as the only correctness layer for financial or irreversible writes.
- Do not hold locks longer than the TTL unless renewals are explicit and monitored.

## Recommended Architecture

- core.ts: pure acquire, renew, release, expiry, and fencing token transitions.
- memory-store.ts: deterministic stateful store for tests and local demos.
- adapters/redis.ts: SET NX PX acquire, Lua compare-and-delete release, Lua compare-and-renew.
- adapters/sql.ts: row-based lock with owner token, expiry, and fencing counter.
- guard.ts: wrapper for running a critical section with renew and finally-release.

## Public API Sketch

\`\`\`ts
const locks = new MemoryDistributedLockStore();
const acquired = locks.acquire("sync:tenant-1", "worker-a", 30_000);
if (!acquired.acquired) return;

try {
  await syncTenant(acquired.record.fencingToken);
} finally {
  locks.release("sync:tenant-1", "worker-a", acquired.record.token);
}
\`\`\`

## Integration Rules

1. Generate an unguessable owner token per acquisition attempt.
2. Release and renew only when owner id and token both match.
3. Use short TTLs and explicit renewals for long critical sections.
4. Pass fencing tokens to downstream writes that can reject stale owners.
5. Treat lock acquisition failure as a normal control-flow outcome.
6. Make critical sections idempotent when possible.

## Failure Modes

- Stale owners continue writing after their lease expires.
- Locks remain held when release lacks compare-and-delete semantics.
- Clock drift changes expiry behavior across nodes.
- Long work exceeds TTL without renewal.
- Memory stores only coordinate within one process.

## Security Notes

- Do not expose lock owner tokens to clients.
- Use cryptographically strong tokens in production adapters.
- Avoid embedding secrets in lock keys.

## Verification Checklist

- Stateless tests cover first acquire, held conflict, same-owner renew acquire, expired takeover, explicit renew, release mismatch, release match, and expiry.
- Stateful tests cover acquisition conflict, fencing increments, renewal, release, prune expired, and takeover after expiry.
- Adapter tests should verify atomic acquire/release/renew under concurrent workers.
- Critical-section wrapper tests should assert release in success and failure paths.

## Source References

- Redis SET NX PX lock pattern and compare-and-delete release.
- Martin Kleppmann fencing token guidance for lease-based locks.
- PostgreSQL advisory lock and row-based lock patterns.
`;

export const DISTRIBUTED_LOCK_MODULE: MwhModule = {
  id: "distributed-lock",
  title: "Distributed Lock Middleware",
  summary:
    "Reusable distributed lock reference with leases, owner tokens, renew/release semantics, fencing tokens, and stateful tests.",
  version: "0.1.0",
  tags: ["cache-state", "distributed-lock", "lease", "redis", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};

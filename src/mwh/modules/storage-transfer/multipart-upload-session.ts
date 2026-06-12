import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Multipart Upload Session Middleware

## Purpose

Use this module as a reusable reference when implementing provider-neutral multipart upload session ledgers for S3, R2, OSS, COS, MinIO, or app-server multipart flows.

The module focuses on session state, not URL signing: create session, record uploaded parts, validate part sizes and checksums, compute missing parts, build completion payloads, complete, abort, expire, and expose snapshots.

## When To Use

- Large file uploads need durable per-part state before object-store completion.
- Upload adapters need a provider-neutral ledger independent of presigned URL generation.
- Clients may retry parts and the server must replace duplicate part records deterministically.
- Tests need upload state behavior without an object store.

## When Not To Use

- Do not use process memory as the production upload ledger.
- Do not complete a multipart upload with missing parts.
- Do not trust content-type metadata as malware or content validation.
- Do not leave expired object-store multipart sessions un-aborted.

## Implementation Variants

- memory-store: deterministic in-process ledger for unit tests and adapter contracts.
- SQL adapter: stores sessions and part records in relational tables.
- Redis adapter: stores short-lived upload ledgers with TTL.
- Object-store adapter: maps completion plans to S3/R2/OSS/COS CompleteMultipartUpload payloads.

## Recommended Architecture

- core.ts: pure session creation, part recording, missing-part detection, completion plan, complete, abort, expire, and snapshots.
- memory-store.ts: stateful reference implementation with deterministic time and clone-safe reads.
- adapters/sql.ts: durable upload_sessions and upload_parts tables.
- adapters/s3.ts: maps completion plans to object-store SDK calls and aborts expired remote sessions.

## Public API Sketch

\`\`\`ts
const store = new MemoryMultipartUploadStore({
  policy: { minPartBytes: 5_000_000, maxPartBytes: 100_000_000, maxParts: 10_000, ttlMs: 86_400_000 },
});

store.create({ uploadId: "upl_1", objectKey: "tenant-a/file.bin", totalBytes: 10_000_000, expectedParts: 2 });
store.recordPart({ uploadId: "upl_1", partNumber: 1, sizeBytes: 5_000_000, checksum: "sha256:a", etag: "etag-1" });
const plan = store.completionPlan("upl_1");
\`\`\`

## Integration Steps

1. Create upload sessions after validating tenant, object key, total size, and content policy.
2. Record each part with size, checksum, ETag, and part number.
3. Replace duplicate part records deterministically.
4. Complete only when missingPartNumbers is empty.
5. Abort or expire abandoned sessions and call the object-store abort API.

## Failure Modes

- Missing part records cause object-store completion failure.
- Non-final parts below provider minimum size are accepted incorrectly.
- Duplicate part numbers append instead of replacing the old part record.
- Expired sessions remain open and leak remote multipart uploads.
- Completion payload is not sorted by part number.

## Security Notes

- Server chooses tenant-scoped object keys.
- Do not log raw checksums if they can correlate sensitive files.
- Enforce max file size before creating sessions.
- Run malware/content validation outside this ledger when required.

## Verification Checklist

- Stateless tests cover create, record, duplicate replacement, min/max part sizes, missing parts, completion plan sorting, complete, abort, expire, and snapshots.
- Stateful tests cover memory create/record/complete, incomplete completion rejection, abort rejection, expiry, and clone-safe reads.
- Adapter tests should verify SQL uniqueness and object-store completion/abort payloads.

## Source References

- AWS S3 multipart upload completion payload rules.
- Cloudflare R2 and MinIO S3-compatible multipart patterns.
- TUS-style upload session ledger patterns.
`;

export const MULTIPART_UPLOAD_SESSION_MODULE: MwhModule = {
  id: "multipart-upload-session",
  title: "Multipart Upload Session Middleware",
  summary:
    "Reusable storage-transfer reference for multipart upload ledgers, part validation, completion plans, abort/expiry, and adapter tests.",
  version: "0.1.0",
  tags: ["storage-transfer", "upload", "multipart", "object-storage", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};

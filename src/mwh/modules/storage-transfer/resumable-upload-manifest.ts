import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Resumable Upload Manifest Middleware

## Purpose

Use this module as a reusable reference when implementing resumable application-level uploads with deterministic chunk planning, SHA-256 checksum validation, missing-chunk detection, merge planning, abort, and expiry.

This module is intentionally separate from object-store presigned URL signing. It owns the upload manifest and byte integrity rules; adapters can persist chunk bytes in a temp filesystem directory, Redis, SQL metadata plus blob storage, or bridge the verified chunks into object-store multipart completion.

## When To Use

- Clients may pause and resume large uploads.
- The server receives or coordinates chunks and must know exactly which chunks are missing.
- Upload completion requires a deterministic merge plan.
- Chunk integrity needs checksum validation before the final object is assembled.

## When Not To Use

- Do not use the memory store for production upload state.
- Do not merge chunks before every planned chunk is present and verified.
- Do not trust client-provided object keys without tenant and path validation.
- Do not keep uploaded chunks after abort, expiry, or failed malware scanning.

## Implementation Variants

1. Filesystem temp chunks
   - Store chunk bytes under a manifest-specific temp directory.
   - Rename or stream chunks in merge-plan order on completion.
2. SQL manifest plus blob/object chunk storage
   - Store manifest/chunk metadata transactionally.
   - Store bytes in object storage or a blob table.
3. Redis-backed short-lived resumable uploads
   - Useful for small files and short TTLs.
   - Requires memory limits and eviction handling.
4. Object-store multipart bridge
   - Use this manifest layer for checksum/missing-chunk decisions.
   - Use object-upload-presigned when clients upload parts directly to storage.

## Recommended Architecture

- core.ts: pure chunk planning, checksum validation, missing chunk detection, complete/abort/expire transitions.
- memory-store.ts: deterministic in-memory manifest store for tests.
- adapters/fs.ts: temp directory chunk store with atomic final rename.
- adapters/sql.ts: manifest and chunk metadata store with row-level locking.
- routes/uploads.ts: initiate, upload-chunk, status, complete, abort endpoints.
- cleanup.ts: TTL expiry job that removes stale manifest rows and temp chunk bytes.

## Public API Sketch

\`\`\`ts
const manifest = store.initiate({
  id: "upl_1",
  objectKey: "tenant-a/archive.zip",
  totalBytes: 11,
  chunkSizeBytes: 5,
});
store.recordChunk(manifest.id, 0, firstFiveBytes, firstChecksum);
const missing = store.missing(manifest.id);
const completed = store.complete(manifest.id);
\`\`\`

## Integration Rules

1. Server creates the manifest id and tenant-scoped object key.
2. Use stable chunk size and byte ranges for the life of the manifest.
3. Validate chunk size and checksum before marking a chunk uploaded.
4. Upsert duplicate chunk indexes only after checksum validation.
5. Complete only when missing-chunk detection returns empty.
6. Delete temp chunks after complete, abort, or expiry.

## Failure Modes

- Last chunk size differs from full chunk size; tests must cover this.
- Duplicate chunk upload may overwrite a previous record; checksum validation must run first.
- Expired manifests must reject further writes.
- Merge order must be based on chunk index, not arrival time.
- Cleanup jobs can remove bytes while metadata still says open unless expiry is coordinated.

## Verification Checklist

- Stateless tests cover chunk planning, short final chunk, checksum mismatch, missing chunks, complete, abort, and expiry.
- Stateful tests cover initiate, duplicate-safe record, missing status, complete merge plan, list/get clone safety, abort, and TTL expiry.
- Filesystem adapter tests should verify atomic write, final merge order, and cleanup.
- SQL adapter tests should verify concurrent chunk records and completion locking.

## Source References

- TUS-style resumable upload manifest patterns.
- HTTP chunked upload and checksum validation patterns.
- Object-store multipart upload completion constraints.
- Filesystem temp-file atomic rename patterns.
`;

export const RESUMABLE_UPLOAD_MANIFEST_MODULE: MwhModule = {
  id: "resumable-upload-manifest",
  title: "Resumable Upload Manifest Middleware",
  summary:
    "Reusable storage-transfer reference for resumable chunk manifests, SHA-256 checksum validation, missing chunk detection, and merge planning.",
  version: "0.1.0",
  tags: ["storage-transfer", "resumable-upload", "chunks", "checksum", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};

import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Presigned Object Upload Middleware

## Purpose

Use this module as a reusable reference when implementing direct-to-object-store uploads with presigned URLs, multipart upload planning, upload session tracking, completion, abort, and expiry.

The module contains verified stateless multipart planning and session transitions plus a stateful in-memory store used by tests. Production adapters should sign URLs with S3, MinIO, R2, OSS, COS, or another object store SDK.

## When To Use

- Browsers or mobile clients need to upload files without proxying bytes through the app server.
- Large files need multipart upload and resumable part tracking.
- The app server must control allowed object keys, content types, and upload TTL.

## When Not To Use

- Do not let clients choose arbitrary object keys.
- Do not use the memory store for production upload sessions.
- Do not complete multipart uploads before every expected part has been recorded.

## Implementation Variants

1. Single PUT presigned URL
   - Simple for small files.
   - No multipart resume.
2. Multipart presigned URLs
   - Recommended for large files.
   - Requires part planning, ETag tracking, completion, and abort.
3. App-server streamed upload
   - Useful when malware scanning or content transforms must happen before storage.

## Recommended Architecture

- core.ts: pure multipart planning and session transitions.
- memory-store.ts: deterministic local adapter for tests.
- adapters/s3.ts: CreateMultipartUpload, UploadPart presign, CompleteMultipartUpload, AbortMultipartUpload.
- routes/uploads.ts: initiate/sign/record-part/complete/abort endpoints.
- policy.ts: object key, size, MIME type, and tenant validation.

## Public API Sketch

\`\`\`ts
const session = store.initiate({
  uploadId: "upl_1",
  objectKey: "tenant-a/avatar.png",
  contentType: "image/png",
  totalBytes: 10_000_000,
  partSizeBytes: 5_000_000,
});
const urls = store.signParts(session.uploadId);
store.recordPart(session.uploadId, 1, etagFromClient);
const complete = store.complete(session.uploadId);
\`\`\`

## Integration Rules

1. Server chooses object key prefix and validates tenant ownership.
2. Enforce max file size and allowed MIME types before signing.
3. Use deterministic part plans so clients and server agree on byte ranges.
4. Record ETags for every uploaded part.
5. Complete only when all expected parts are recorded.
6. Abort or expire abandoned sessions.

## Failure Modes

- Missing part ETags cause object-store complete calls to fail.
- Client-provided object keys can overwrite another tenant's data.
- TTL expiry during upload requires restart or re-signing policy.
- Multipart sessions leak storage until aborted.
- Content-Type is metadata, not a security guarantee; validate where needed.

## Verification Checklist

- Stateless tests cover multipart planning, last-part sizing, complete missing parts, abort, expiry.
- Stateful store tests cover initiate -> sign -> record all parts -> complete.
- Stateful store tests cover incomplete complete returning missing parts.
- Stateful store tests cover abort preventing further part records.
- Adapter tests should verify SDK calls and object-store completion payload.

## Source References

- AWS S3 multipart upload and presigned URL flow.
- MinIO JavaScript SDK multipart upload patterns.
- Cloudflare R2 S3-compatible presigned URL flow.
- Common direct-upload security patterns for tenant-scoped object keys.
`;

export const OBJECT_UPLOAD_PRESIGNED_MODULE: MwhModule = {
  id: "object-upload-presigned",
  title: "Presigned Object Upload Middleware",
  summary:
    "Reusable storage-transfer reference for presigned multipart upload planning, session tracking, completion, abort, and expiry.",
  version: "0.1.0",
  tags: ["upload", "object-storage", "presigned-url", "multipart", "storage-transfer"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};

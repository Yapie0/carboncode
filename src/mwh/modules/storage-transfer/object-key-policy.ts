import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Object Key Policy Middleware

## Purpose

Use this module as a reusable reference when implementing tenant-scoped object storage keys for uploads, downloads, presigned URLs, multipart sessions, and CDN-backed file access.

The module focuses on object key safety: normalize client-provided names, reject traversal and absolute paths, enforce tenant prefixes, restrict extensions/content types, and expose a small stateful policy registry for tests and adapters.

## When To Use

- Object storage keys must be generated or validated before upload signing.
- Multiple tenants share one bucket and must not read or overwrite each other's objects.
- Upload flows need consistent key policy across presigned, resumable, and multipart code paths.
- Tests need object key authorization without a real object store.

## When Not To Use

- Do not treat extension or content-type checks as malware scanning.
- Do not let clients provide full bucket paths.
- Do not use display filenames directly as permanent object keys without normalization.

## Implementation Variants

- memory-store: deterministic in-process tenant policy registry for unit tests and adapter contracts.
- SQL adapter: stores tenant key policies, max object size, and allowed content types.
- Config adapter: reads static tenant policies from environment or deployment config.
- Upload adapter: wraps presigned or multipart initiation before any object-store SDK call.

## Recommended Architecture

- core.ts: pure key normalization, tenant prefix rendering, ownership checks, split/parse helpers, and extension validation.
- memory-store.ts: stateful reference implementation with tenant policy registration and read/write authorization.
- adapters/sql.ts: durable tenant policy table.
- routes/uploads.ts: calls authorizeWrite before creating upload sessions or presigned URLs.
- routes/downloads.ts: calls authorizeRead before returning signed read URLs.

## Public API Sketch

\`\`\`ts
const store = new MemoryObjectKeyPolicyStore();
store.registerTenant({
  tenantId: "tenant-a",
  policy: { maxKeyBytes: 512, tenantPrefixTemplate: "tenants/{tenantId}", allowedExtensions: ["png", "jpg"] },
  allowedContentTypes: ["image/png", "image/jpeg"],
  maxObjectBytes: 5_000_000,
});

const authorized = store.authorizeWrite({
  tenantId: "tenant-a",
  rawKey: "avatars/me.png",
  contentType: "image/png",
  sizeBytes: 120_000,
});
\`\`\`

## Integration Steps

1. Register or load tenant object policies at process startup.
2. Accept only relative client filenames or logical paths.
3. Normalize separators and reject traversal, absolute paths, control characters, and denied segments.
4. Prefix keys with the server-rendered tenant prefix.
5. Call the same policy before presigned upload, multipart upload, resumable upload, and signed download.

## Failure Modes

- Client-provided keys overwrite another tenant's objects.
- Path traversal sneaks through mixed slash and backslash separators.
- Upload code and download code enforce different prefixes.
- Extension allowlists are bypassed by case or trailing-dot variants.
- Key length exceeds provider limits after tenant prefixing.

## Security Notes

- Server must choose the tenant prefix; never trust a tenant id embedded in a client key.
- Content-Type is metadata and can be forged.
- Consider generating opaque object ids when filenames contain private user data.
- Log policy decisions without logging sensitive full object keys when required.

## Verification Checklist

- Stateless tests cover normalization, prefix generation, traversal rejection, extension allowlists, max key length, and ownership checks.
- Stateful tests cover tenant registration, write authorization, read authorization, content-type rejection, max-size rejection, and clone-safe policy reads.
- Adapter tests should verify SQL/config policy loading and integration before presigned or multipart session creation.

## Source References

- S3-compatible object key naming and prefix isolation patterns.
- Multi-tenant bucket isolation through server-side key prefixes.
- Direct upload security patterns for tenant-scoped object keys.
`;

export const OBJECT_KEY_POLICY_MODULE: MwhModule = {
  id: "object-key-policy",
  title: "Object Key Policy Middleware",
  summary:
    "Reusable storage-transfer reference for tenant-scoped object key normalization, ownership checks, extension/content-type policy, and upload authorization.",
  version: "0.1.0",
  tags: ["storage-transfer", "object-storage", "tenant-isolation", "upload", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};

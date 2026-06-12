import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Chunked Download Cache Middleware

## Purpose

Use this module as a reusable reference when building resumable downloads, HTTP Range handling, CDN-like chunk caches, object storage download accelerators, or large-file proxy caches.

The module contains pure Range parsing, chunk planning, ETag/If-Range decisions, and TTL expiry checks plus a deterministic memory cache for tests. Production adapters can store chunks in Redis, filesystem cache, object storage, CDN edge cache, or database-backed blob storage.

## When To Use

- Serve large files through range requests.
- Cache object chunks rather than full objects.
- Reuse cached chunks only when ETag still matches.
- Plan which byte ranges must be fetched from origin.

## When Not To Use

- Do not cache private files without authorization-aware keys.
- Do not reuse chunks after ETag or version changes.
- Do not keep unbounded in-memory chunks for large objects.

## Recommended Architecture

- core.ts: pure Range parser, chunk range splitter, If-Range decision, chunk hit/miss plan, and expiry checks.
- memory-cache.ts: deterministic stateful chunk cache for tests.
- adapters/fs.ts: local disk chunk cache.
- adapters/redis.ts: small object chunk metadata and binary cache.
- middleware/http.ts: validates Range, plans cache hits, fetches misses, and emits 206 responses.

## Verification Checklist

- Stateless tests cover range parsing, suffix ranges, invalid ranges, chunk splitting, If-Range, ETag mismatch, hit/miss planning, and expiry.
- Stateful tests cover put, plan hit/miss, ETag isolation, object invalidation, TTL pruning, and clone safety.
- HTTP tests should assert 206 Partial Content and Content-Range behavior.
`;

export const CHUNKED_DOWNLOAD_CACHE_MODULE: MwhModule = {
  id: "chunked-download-cache",
  title: "Chunked Download Cache Middleware",
  summary:
    "Reusable storage-transfer reference with Range parsing, ETag-aware chunk planning, TTL expiry, and stateful cache tests.",
  version: "0.1.0",
  tags: ["storage-transfer", "range-request", "download-cache", "etag", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};

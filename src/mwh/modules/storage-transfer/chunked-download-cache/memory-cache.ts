import {
  type ByteRange,
  type CachedChunk,
  type ChunkPlan,
  isChunkExpired,
  planChunkedDownload,
  readCachedChunkBytes,
} from "./core.js";

export interface MemoryChunkedDownloadCacheOptions {
  now?: () => number;
}

export interface CachedRangeRead {
  hit: boolean;
  chunks: CachedChunk[];
  missingRanges: ByteRange[];
  bytes?: Uint8Array;
}

export class MemoryChunkedDownloadCache {
  private readonly now: () => number;
  private readonly chunks = new Map<string, CachedChunk>();

  constructor(opts: MemoryChunkedDownloadCacheOptions = {}) {
    this.now = opts.now ?? Date.now;
  }

  put(input: {
    objectKey: string;
    etag: string;
    range: ByteRange;
    bytes?: Uint8Array;
    ttlMs?: number;
  }): CachedChunk {
    const nowMs = this.now();
    const chunk: CachedChunk = {
      objectKey: input.objectKey,
      etag: input.etag,
      range: { ...input.range },
      storedAtMs: nowMs,
      expiresAtMs: input.ttlMs === undefined ? undefined : nowMs + input.ttlMs,
      bytes: input.bytes ? input.bytes.slice() : undefined,
    };
    this.chunks.set(cacheKey(chunk), chunk);
    return cloneChunk(chunk);
  }

  plan(input: {
    objectKey: string;
    etag: string;
    requested: ByteRange;
    chunkSize: number;
  }): ChunkPlan {
    return planChunkedDownload({
      ...input,
      cached: [...this.chunks.values()],
      nowMs: this.now(),
    });
  }

  read(input: {
    objectKey: string;
    etag: string;
    requested: ByteRange;
    chunkSize: number;
  }): CachedRangeRead {
    const plan = this.plan(input);
    if (plan.misses.length > 0) {
      return {
        hit: false,
        chunks: plan.hits.map(cloneChunk),
        missingRanges: plan.originFetches.map((range) => ({ ...range })),
      };
    }

    const chunks = plan.hits.sort((a, b) => a.range.start - b.range.start);
    const parts: Uint8Array[] = [];
    for (const chunk of chunks) {
      const bytes = readCachedChunkBytes(chunk, input.requested);
      if (!bytes) {
        return {
          hit: false,
          chunks: chunks.map(cloneChunk),
          missingRanges: [{ ...input.requested }],
        };
      }
      parts.push(bytes);
    }

    return {
      hit: true,
      chunks: chunks.map(cloneChunk),
      missingRanges: [],
      bytes: concatBytes(parts),
    };
  }

  invalidateObject(objectKey: string): number {
    let removed = 0;
    for (const [key, chunk] of this.chunks) {
      if (chunk.objectKey === objectKey) {
        this.chunks.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  pruneExpired(): number {
    let removed = 0;
    const nowMs = this.now();
    for (const [key, chunk] of this.chunks) {
      if (isChunkExpired(chunk, nowMs)) {
        this.chunks.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  size(): number {
    return this.chunks.size;
  }
}

function cacheKey(chunk: CachedChunk): string {
  return `${chunk.objectKey}:${chunk.etag}:${chunk.range.start}-${chunk.range.end}`;
}

function cloneChunk(chunk: CachedChunk): CachedChunk {
  return {
    ...chunk,
    range: { ...chunk.range },
    bytes: chunk.bytes ? chunk.bytes.slice() : undefined,
  };
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

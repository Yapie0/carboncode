export interface ByteRange {
  start: number;
  end: number;
}

export interface CachedChunk {
  objectKey: string;
  etag: string;
  range: ByteRange;
  storedAtMs: number;
  expiresAtMs?: number;
  bytes?: Uint8Array;
}

export interface ChunkPlan {
  hits: CachedChunk[];
  misses: ByteRange[];
  originFetches: ByteRange[];
  cacheable: boolean;
}

export interface OriginResponseCacheDecision {
  cacheable: boolean;
  reason?: string;
  chunks: ByteRange[];
}

export function parseRangeHeader(header: string | undefined, size: number): ByteRange | undefined {
  assertPositiveInteger(size, "size");
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return undefined;
  const rawStart = match[1]!;
  const rawEnd = match[2]!;
  if (!rawStart && !rawEnd) return undefined;
  if (!rawStart) {
    const suffix = Number.parseInt(rawEnd, 10);
    if (!Number.isInteger(suffix) || suffix <= 0) return undefined;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number.parseInt(rawStart, 10);
  const end = rawEnd ? Number.parseInt(rawEnd, 10) : size - 1;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return undefined;
  }
  return { start, end: Math.min(end, size - 1) };
}

export function chunkRange(range: ByteRange, chunkSize: number): ByteRange[] {
  assertRange(range);
  assertPositiveInteger(chunkSize, "chunkSize");
  const chunks: ByteRange[] = [];
  let start = Math.floor(range.start / chunkSize) * chunkSize;
  while (start <= range.end) {
    chunks.push({ start, end: start + chunkSize - 1 });
    start += chunkSize;
  }
  return chunks;
}

export function intersectRange(left: ByteRange, right: ByteRange): ByteRange | undefined {
  assertRange(left);
  assertRange(right);
  const start = Math.max(left.start, right.start);
  const end = Math.min(left.end, right.end);
  if (end < start) return undefined;
  return { start, end };
}

export function mergeContiguousRanges(ranges: readonly ByteRange[]): ByteRange[] {
  const sorted = ranges.map(cloneRange).sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: ByteRange[] = [];
  for (const range of sorted) {
    assertRange(range);
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end + 1) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push(range);
    }
  }
  return merged;
}

export function planChunkedDownload(input: {
  objectKey: string;
  etag: string;
  requested: ByteRange;
  chunkSize: number;
  cached: readonly CachedChunk[];
  nowMs: number;
}): ChunkPlan {
  assertNonEmpty(input.objectKey, "objectKey");
  assertNonEmpty(input.etag, "etag");
  assertRange(input.requested);
  assertPositiveInteger(input.chunkSize, "chunkSize");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const chunks = chunkRange(input.requested, input.chunkSize);
  const hits: CachedChunk[] = [];
  const misses: ByteRange[] = [];
  for (const chunk of chunks) {
    const hit = input.cached.find(
      (cached) =>
        cached.objectKey === input.objectKey &&
        cached.etag === input.etag &&
        cached.range.start === chunk.start &&
        cached.range.end === chunk.end &&
        !isChunkExpired(cached, input.nowMs),
    );
    if (hit) hits.push({ ...hit, range: { ...hit.range } });
    else misses.push(chunk);
  }
  return {
    hits,
    misses,
    originFetches: mergeContiguousRanges(misses),
    cacheable: misses.length > 0,
  };
}

export function decideOriginResponseCaching(input: {
  status: number;
  requested: ByteRange;
  responseRange?: ByteRange;
  responseSize?: number;
  chunkSize: number;
}): OriginResponseCacheDecision {
  assertRange(input.requested);
  assertPositiveInteger(input.chunkSize, "chunkSize");
  if (input.status === 304) return { cacheable: false, reason: "not-modified", chunks: [] };
  if (input.status !== 200 && input.status !== 206) {
    return { cacheable: false, reason: "unsupported-status", chunks: [] };
  }

  const delivered =
    input.status === 206
      ? input.responseRange
      : input.responseSize === undefined
        ? undefined
        : { start: 0, end: input.responseSize - 1 };
  if (!delivered) return { cacheable: false, reason: "missing-range", chunks: [] };
  assertRange(delivered);

  const relevant = intersectRange(input.requested, delivered);
  if (!relevant) return { cacheable: false, reason: "outside-request", chunks: [] };
  return {
    cacheable: true,
    chunks: chunkRange(relevant, input.chunkSize)
      .map((chunk) => intersectRange(chunk, delivered))
      .filter((range): range is ByteRange => range !== undefined),
  };
}

export function shouldUseRangeCache(input: {
  ifRange?: string;
  etag: string;
  range?: ByteRange;
}): boolean {
  if (!input.range) return false;
  if (!input.ifRange) return true;
  return input.ifRange === input.etag;
}

export function isChunkExpired(chunk: Pick<CachedChunk, "expiresAtMs">, nowMs: number): boolean {
  assertNonNegativeInteger(nowMs, "nowMs");
  return chunk.expiresAtMs !== undefined && nowMs >= chunk.expiresAtMs;
}

export function readCachedChunkBytes(
  chunk: CachedChunk,
  requested: ByteRange,
): Uint8Array | undefined {
  assertRange(chunk.range);
  assertRange(requested);
  if (!chunk.bytes) return undefined;
  const range = intersectRange(chunk.range, requested);
  if (!range) return undefined;
  const startOffset = range.start - chunk.range.start;
  const endOffsetExclusive = range.end - chunk.range.start + 1;
  return chunk.bytes.slice(startOffset, endOffsetExclusive);
}

function assertRange(range: ByteRange): void {
  assertNonNegativeInteger(range.start, "range.start");
  assertNonNegativeInteger(range.end, "range.end");
  if (range.end < range.start) throw new Error("range.end must be >= range.start");
}

function cloneRange(range: ByteRange): ByteRange {
  return { start: range.start, end: range.end };
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative integer`);
}

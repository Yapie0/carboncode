import { describe, expect, it } from "vitest";
import {
  chunkRange,
  decideOriginResponseCaching,
  mergeContiguousRanges,
  parseRangeHeader,
  planChunkedDownload,
  readCachedChunkBytes,
  shouldUseRangeCache,
} from "../src/mwh/modules/storage-transfer/chunked-download-cache/core.js";
import { MemoryChunkedDownloadCache } from "../src/mwh/modules/storage-transfer/chunked-download-cache/memory-cache.js";

describe("MWH chunked-download-cache middleware", () => {
  it("parses HTTP byte ranges", () => {
    expect(parseRangeHeader("bytes=0-99", 1_000)).toEqual({ start: 0, end: 99 });
    expect(parseRangeHeader("bytes=950-", 1_000)).toEqual({ start: 950, end: 999 });
    expect(parseRangeHeader("bytes=-50", 1_000)).toEqual({ start: 950, end: 999 });
    expect(parseRangeHeader("bytes=1000-1001", 1_000)).toBeUndefined();
    expect(parseRangeHeader("items=0-1", 1_000)).toBeUndefined();
  });

  it("splits requested ranges into fixed chunks and respects If-Range", () => {
    expect(chunkRange({ start: 100, end: 700 }, 256)).toEqual([
      { start: 0, end: 255 },
      { start: 256, end: 511 },
      { start: 512, end: 767 },
    ]);
    expect(shouldUseRangeCache({ etag: "v1", range: { start: 0, end: 1 } })).toBe(true);
    expect(shouldUseRangeCache({ etag: "v1", ifRange: "v1", range: { start: 0, end: 1 } })).toBe(
      true,
    );
    expect(shouldUseRangeCache({ etag: "v1", ifRange: "v2", range: { start: 0, end: 1 } })).toBe(
      false,
    );
    expect(
      mergeContiguousRanges([
        { start: 512, end: 767 },
        { start: 0, end: 255 },
        { start: 256, end: 511 },
        { start: 900, end: 999 },
      ]),
    ).toEqual([
      { start: 0, end: 767 },
      { start: 900, end: 999 },
    ]);
  });

  it("plans ETag-aware hit and miss chunks", () => {
    const cached = [
      {
        objectKey: "file",
        etag: "v1",
        range: { start: 0, end: 255 },
        storedAtMs: 1_000,
      },
      {
        objectKey: "file",
        etag: "v2",
        range: { start: 256, end: 511 },
        storedAtMs: 1_000,
      },
    ];

    expect(
      planChunkedDownload({
        objectKey: "file",
        etag: "v1",
        requested: { start: 0, end: 511 },
        chunkSize: 256,
        cached,
        nowMs: 1_000,
      }),
    ).toEqual({
      hits: [expect.objectContaining({ range: { start: 0, end: 255 } })],
      misses: [{ start: 256, end: 511 }],
      originFetches: [{ start: 256, end: 511 }],
      cacheable: true,
    });
  });

  it("slices cached chunk bytes against a requested range", () => {
    const bytes = new Uint8Array([10, 11, 12, 13]);
    expect(
      readCachedChunkBytes(
        {
          objectKey: "file",
          etag: "v1",
          range: { start: 100, end: 103 },
          storedAtMs: 1_000,
          bytes,
        },
        { start: 101, end: 102 },
      ),
    ).toEqual(new Uint8Array([11, 12]));
  });

  it("decides which origin responses can be written back as cache chunks", () => {
    expect(
      decideOriginResponseCaching({
        status: 206,
        requested: { start: 100, end: 700 },
        responseRange: { start: 0, end: 767 },
        chunkSize: 256,
      }),
    ).toEqual({
      cacheable: true,
      chunks: [
        { start: 0, end: 255 },
        { start: 256, end: 511 },
        { start: 512, end: 767 },
      ],
    });

    expect(
      decideOriginResponseCaching({
        status: 200,
        requested: { start: 256, end: 511 },
        responseSize: 1_000,
        chunkSize: 256,
      }),
    ).toEqual({
      cacheable: true,
      chunks: [{ start: 256, end: 511 }],
    });

    expect(
      decideOriginResponseCaching({
        status: 304,
        requested: { start: 0, end: 255 },
        responseRange: { start: 0, end: 255 },
        chunkSize: 256,
      }),
    ).toEqual({ cacheable: false, reason: "not-modified", chunks: [] });
  });

  it("runs a stateful put, plan, ETag isolation, invalidation, prune, and clone flow", () => {
    let now = 1_000;
    const cache = new MemoryChunkedDownloadCache({ now: () => now });

    const first = cache.put({
      objectKey: "file",
      etag: "v1",
      range: { start: 0, end: 255 },
      ttlMs: 500,
    });
    cache.put({ objectKey: "file", etag: "v2", range: { start: 256, end: 511 } });
    first.range.start = 99;

    expect(
      cache.plan({
        objectKey: "file",
        etag: "v1",
        requested: { start: 0, end: 511 },
        chunkSize: 256,
      }),
    ).toEqual({
      hits: [expect.objectContaining({ range: { start: 0, end: 255 } })],
      misses: [{ start: 256, end: 511 }],
      originFetches: [{ start: 256, end: 511 }],
      cacheable: true,
    });

    now = 1_500;
    expect(cache.pruneExpired()).toBe(1);
    expect(cache.size()).toBe(1);
    expect(cache.invalidateObject("file")).toBe(1);
    expect(cache.size()).toBe(0);
  });

  it("reads cached bytes across chunks and reports missing ranges", () => {
    const cache = new MemoryChunkedDownloadCache({ now: () => 1_000 });
    const first = cache.put({
      objectKey: "file",
      etag: "v1",
      range: { start: 0, end: 2 },
      bytes: new Uint8Array([1, 2, 3]),
    });
    cache.put({
      objectKey: "file",
      etag: "v1",
      range: { start: 3, end: 5 },
      bytes: new Uint8Array([4, 5, 6]),
    });
    first.bytes?.fill(99);

    const hit = cache.read({
      objectKey: "file",
      etag: "v1",
      requested: { start: 1, end: 4 },
      chunkSize: 3,
    });
    expect(hit).toMatchObject({ hit: true, missingRanges: [] });
    expect(hit.bytes).toEqual(new Uint8Array([2, 3, 4, 5]));

    const miss = cache.read({
      objectKey: "file",
      etag: "v1",
      requested: { start: 1, end: 7 },
      chunkSize: 3,
    });
    expect(miss).toMatchObject({
      hit: false,
      missingRanges: [{ start: 6, end: 8 }],
    });
    expect(miss.bytes).toBeUndefined();
  });
});

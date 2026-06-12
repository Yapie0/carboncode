import { describe, expect, it } from "vitest";
import {
  abortResumableUpload,
  completeResumableUpload,
  createResumableUploadManifest,
  expireResumableUpload,
  missingUploadChunks,
  nextMissingUploadChunk,
  planUploadChunks,
  recordUploadChunk,
  resumableUploadProgress,
  sha256,
} from "../src/mwh/modules/storage-transfer/resumable-upload-manifest/core.js";
import { MemoryResumableUploadStore } from "../src/mwh/modules/storage-transfer/resumable-upload-manifest/memory-store.js";

describe("MWH resumable-upload-manifest stateless core", () => {
  it("plans upload byte ranges including the final short chunk", () => {
    expect(planUploadChunks(11, 5)).toEqual([
      { index: 0, startByte: 0, endByteInclusive: 4, sizeBytes: 5 },
      { index: 1, startByte: 5, endByteInclusive: 9, sizeBytes: 5 },
      { index: 2, startByte: 10, endByteInclusive: 10, sizeBytes: 1 },
    ]);
  });

  it("records chunks with checksum validation and reports missing chunks", () => {
    let manifest = createResumableUploadManifest({
      id: "upl-1",
      objectKey: "tenant-a/file.bin",
      totalBytes: 11,
      chunkSizeBytes: 5,
      nowMs: 0,
      ttlMs: 1000,
    });

    expect(() =>
      recordUploadChunk(manifest, { index: 0, bytes: "hello", checksumSha256: "bad", nowMs: 10 }),
    ).toThrow("checksum mismatch");
    manifest = recordUploadChunk(manifest, {
      index: 0,
      bytes: "hello",
      checksumSha256: sha256("hello"),
      nowMs: 10,
    });

    expect(manifest.chunks).toEqual([expect.objectContaining({ index: 0, sizeBytes: 5 })]);
    expect(missingUploadChunks(manifest)).toEqual([1, 2]);
    expect(nextMissingUploadChunk(manifest)).toEqual({
      index: 1,
      startByte: 5,
      endByteInclusive: 9,
      sizeBytes: 5,
    });
    expect(resumableUploadProgress(manifest)).toEqual({
      id: "upl-1",
      uploadedChunks: 1,
      totalChunks: 3,
      uploadedBytes: 5,
      totalBytes: 11,
      missingChunks: [1, 2],
      completeable: false,
    });
    expect(() => recordUploadChunk(manifest, { index: 1, bytes: "toolong", nowMs: 20 })).toThrow(
      "size mismatch",
    );
  });

  it("completes only after every chunk is present and returns an ordered merge plan", () => {
    let manifest = createResumableUploadManifest({
      id: "upl-1",
      objectKey: "tenant-a/file.bin",
      totalBytes: 11,
      chunkSizeBytes: 5,
      nowMs: 0,
      ttlMs: 1000,
    });

    manifest = recordUploadChunk(manifest, { index: 2, bytes: "!", nowMs: 10 });
    expect(completeResumableUpload(manifest, 20)).toMatchObject({
      completed: false,
      missingChunks: [0, 1],
    });

    manifest = recordUploadChunk(manifest, { index: 0, bytes: "hello", nowMs: 30 });
    manifest = recordUploadChunk(manifest, { index: 1, bytes: "world", nowMs: 40 });
    const result = completeResumableUpload(manifest, 50);
    expect(resumableUploadProgress(manifest).completeable).toBe(true);
    expect(result).toMatchObject({
      completed: true,
      missingChunks: [],
      manifest: { status: "completed", completedAtMs: 50 },
    });
    expect(result.mergePlan.map((chunk) => chunk.index)).toEqual([0, 1, 2]);
  });

  it("aborts and expires manifests through pure transitions", () => {
    const manifest = createResumableUploadManifest({
      id: "upl-1",
      objectKey: "tenant-a/file.bin",
      totalBytes: 10,
      chunkSizeBytes: 5,
      nowMs: 0,
      ttlMs: 100,
    });

    expect(expireResumableUpload(manifest, 99).status).toBe("open");
    expect(expireResumableUpload(manifest, 100).status).toBe("expired");
    expect(abortResumableUpload(manifest, 50)).toMatchObject({
      status: "aborted",
      abortedAtMs: 50,
    });
  });
});

describe("MWH resumable-upload-manifest stateful memory store", () => {
  it("initiates, records chunks, completes an upload, and preserves clone safety", () => {
    let now = 0;
    const store = new MemoryResumableUploadStore({ ttlMs: 1000, now: () => now });
    const manifest = store.initiate({
      id: "upl-1",
      objectKey: "tenant-a/file.bin",
      totalBytes: 11,
      chunkSizeBytes: 5,
    });
    expect(manifest.status).toBe("open");

    now = 10;
    const first = store.recordChunk("upl-1", 0, "hello");
    first.chunks[0]!.uploadedAtMs = 999;
    expect(store.get("upl-1")?.chunks[0]?.uploadedAtMs).toBe(10);
    expect(store.missing("upl-1")).toEqual([1, 2]);
    expect(store.progress("upl-1")).toEqual(
      expect.objectContaining({ uploadedChunks: 1, missingChunks: [1, 2], completeable: false }),
    );
    expect(store.nextMissingChunk("upl-1")).toEqual({
      index: 1,
      startByte: 5,
      endByteInclusive: 9,
      sizeBytes: 5,
    });

    now = 20;
    store.recordChunk("upl-1", 2, "!");
    expect(store.complete("upl-1")).toMatchObject({ completed: false, missingChunks: [1] });
    store.recordChunk("upl-1", 1, "world");
    expect(store.progress("upl-1").completeable).toBe(true);
    const complete = store.complete("upl-1");
    expect(complete.completed).toBe(true);
    expect(complete.mergePlan.map((chunk) => chunk.index)).toEqual([0, 1, 2]);
    expect(store.list("completed").map((item) => item.id)).toEqual(["upl-1"]);
  });

  it("aborts manifests and expires abandoned manifests", () => {
    let now = 0;
    const store = new MemoryResumableUploadStore({ ttlMs: 100, now: () => now });
    store.initiate({
      id: "upl-1",
      objectKey: "tenant-a/file.bin",
      totalBytes: 10,
      chunkSizeBytes: 5,
    });
    expect(store.abort("upl-1").status).toBe("aborted");
    expect(() => store.recordChunk("upl-1", 0, "hello")).toThrow("upload is aborted");

    store.initiate({
      id: "upl-2",
      objectKey: "tenant-a/other.bin",
      totalBytes: 10,
      chunkSizeBytes: 5,
    });
    now = 100;
    expect(store.expireDue()).toBe(1);
    expect(store.get("upl-2")?.status).toBe("expired");
  });
});

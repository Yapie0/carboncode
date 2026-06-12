import { describe, expect, it } from "vitest";
import {
  abortUploadSession,
  cloneCompleteUploadResult,
  cloneUploadSession,
  completeUploadSession,
  createUploadSession,
  expireUploadSession,
  missingUploadParts,
  nextUploadPart,
  planMultipartUpload,
  recordUploadedPart,
  uploadSessionProgress,
} from "../src/mwh/modules/storage-transfer/object-upload-presigned/core.js";
import { MemoryUploadStore } from "../src/mwh/modules/storage-transfer/object-upload-presigned/memory-store.js";

describe("MWH object-upload-presigned stateless core", () => {
  it("plans multipart upload byte ranges including the final short part", () => {
    expect(planMultipartUpload(11, 5)).toEqual([
      { partNumber: 1, startByte: 0, endByteInclusive: 4, sizeBytes: 5 },
      { partNumber: 2, startByte: 5, endByteInclusive: 9, sizeBytes: 5 },
      { partNumber: 3, startByte: 10, endByteInclusive: 10, sizeBytes: 1 },
    ]);
  });

  it("records parts and refuses completion while parts are missing", () => {
    let session = createUploadSession({
      uploadId: "upl-1",
      objectKey: "tenant-a/file.bin",
      contentType: "application/octet-stream",
      totalBytes: 11,
      partSizeBytes: 5,
      nowMs: 0,
      ttlMs: 1000,
    });

    session = recordUploadedPart(session, 1, "etag-1", 10);
    const clonedSession = cloneUploadSession(session);
    clonedSession.parts[0]!.etag = "mutated";
    expect(session.parts[0]?.etag).toBe("etag-1");
    expect(uploadSessionProgress(session)).toMatchObject({
      totalParts: 3,
      uploadedParts: 1,
      missingParts: [2, 3],
      uploadedBytes: 5,
      percent: 45.45,
      completeable: false,
    });
    expect(missingUploadParts(session).map((part) => part.partNumber)).toEqual([2, 3]);
    expect(nextUploadPart(session)).toMatchObject({ partNumber: 2, startByte: 5 });

    const incomplete = completeUploadSession(session, 20);
    const clonedIncomplete = cloneCompleteUploadResult(incomplete);
    clonedIncomplete.missingParts.push(99);
    expect(incomplete.missingParts).toEqual([2, 3]);
    expect(incomplete).toMatchObject({ completed: false, missingParts: [2, 3] });

    session = recordUploadedPart(session, 2, "etag-2", 30);
    session = recordUploadedPart(session, 3, "etag-3", 40);
    expect(uploadSessionProgress(session)).toMatchObject({
      uploadedParts: 3,
      missingParts: [],
      uploadedBytes: 11,
      percent: 100,
      completeable: true,
    });
    expect(nextUploadPart(session)).toBeUndefined();
    const complete = completeUploadSession(session, 50);
    expect(complete).toMatchObject({
      completed: true,
      missingParts: [],
      session: { status: "completed", completedAtMs: 50 },
    });
  });

  it("aborts and expires sessions through pure transitions", () => {
    const session = createUploadSession({
      uploadId: "upl-1",
      objectKey: "tenant-a/file.bin",
      contentType: "application/octet-stream",
      totalBytes: 10,
      partSizeBytes: 5,
      nowMs: 0,
      ttlMs: 100,
    });

    expect(expireUploadSession(session, 99).status).toBe("initiated");
    expect(expireUploadSession(session, 100).status).toBe("expired");
    expect(abortUploadSession(session, 50)).toMatchObject({ status: "aborted", abortedAtMs: 50 });
  });
});

describe("MWH object-upload-presigned stateful memory store", () => {
  it("initiates, signs, records all parts, and completes an upload", () => {
    let now = 0;
    const store = new MemoryUploadStore({ ttlMs: 1000, now: () => now });
    const session = store.initiate({
      uploadId: "upl-1",
      objectKey: "tenant-a/file.bin",
      contentType: "application/octet-stream",
      totalBytes: 11,
      partSizeBytes: 5,
    });
    expect(session.status).toBe("initiated");
    session.status = "aborted";
    expect(store.get("upl-1")?.status).toBe("initiated");

    const signed = store.signParts("upl-1");
    expect(signed).toHaveLength(3);
    expect(signed[0]).toMatchObject({ method: "PUT", partNumber: 1, expiresAtMs: 1000 });
    expect(signed[0]?.url).toContain("partNumber=1");

    now = 10;
    const firstPart = store.recordPart("upl-1", 1, "etag-1");
    firstPart.parts[0]!.etag = "mutated";
    expect(store.get("upl-1")?.parts[0]?.etag).toBe("etag-1");
    store.recordPart("upl-1", 2, "etag-2");
    expect(store.progress("upl-1")).toMatchObject({
      uploadedParts: 2,
      missingParts: [3],
      uploadedBytes: 10,
      completeable: false,
    });
    expect(store.nextPart("upl-1")).toMatchObject({ partNumber: 3, startByte: 10 });
    expect(store.signMissingParts("upl-1").map((part) => part.partNumber)).toEqual([3]);
    expect(store.complete("upl-1")).toMatchObject({ completed: false, missingParts: [3] });
    store.recordPart("upl-1", 3, "etag-3");
    expect(store.signMissingParts("upl-1")).toEqual([]);
    const complete = store.complete("upl-1");
    expect(complete).toMatchObject({ completed: true, session: { status: "completed" } });
    complete.session.parts[0]!.etag = "mutated-complete";
    expect(store.get("upl-1")?.parts[0]?.etag).toBe("etag-1");
  });

  it("aborts sessions and expires abandoned sessions", () => {
    let now = 0;
    const store = new MemoryUploadStore({ ttlMs: 100, now: () => now });
    store.initiate({
      uploadId: "upl-1",
      objectKey: "tenant-a/file.bin",
      contentType: "application/octet-stream",
      totalBytes: 10,
      partSizeBytes: 5,
    });
    expect(store.abort("upl-1").status).toBe("aborted");
    expect(() => store.recordPart("upl-1", 1, "etag-1")).toThrow("upload is aborted");

    store.initiate({
      uploadId: "upl-2",
      objectKey: "tenant-a/other.bin",
      contentType: "application/octet-stream",
      totalBytes: 10,
      partSizeBytes: 5,
    });
    now = 100;
    expect(store.expireDue()).toBe(1);
    expect(store.get("upl-2")?.status).toBe("expired");
  });
});

import { describe, expect, it } from "vitest";
import {
  type MultipartUploadPolicy,
  abortMultipartSession,
  completeMultipartSession,
  createMultipartSession,
  expireMultipartSession,
  missingPartNumbers,
  multipartSessionProgress,
  multipartSessionSnapshot,
  nextMultipartPartNumber,
  planMultipartCompletion,
  recordMultipartPart,
  totalRecordedPartBytes,
} from "../src/mwh/modules/storage-transfer/multipart-upload-session/core.js";
import { MemoryMultipartUploadStore } from "../src/mwh/modules/storage-transfer/multipart-upload-session/memory-store.js";

const policy: MultipartUploadPolicy = {
  minPartBytes: 5,
  maxPartBytes: 10,
  maxParts: 10,
  ttlMs: 100,
};

describe("multipart-upload-session MWH module", () => {
  it("records parts, replaces duplicates, and builds a sorted completion plan", () => {
    let session = createMultipartSession({
      uploadId: "upload-1",
      objectKey: "objects/demo.bin",
      totalBytes: 12,
      expectedParts: 2,
      nowMs: 1000,
      policy,
    });

    session = recordMultipartPart(session, {
      partNumber: 2,
      sizeBytes: 7,
      checksum: "sha256:b",
      etag: "etag-2",
      nowMs: 1010,
      policy,
    });
    session = recordMultipartPart(session, {
      partNumber: 1,
      sizeBytes: 5,
      checksum: "sha256:a",
      etag: "etag-1",
      nowMs: 1020,
      policy,
    });
    session = recordMultipartPart(session, {
      partNumber: 2,
      sizeBytes: 7,
      checksum: "sha256:b2",
      etag: "etag-2b",
      nowMs: 1030,
      policy,
    });

    expect(session.parts).toHaveLength(2);
    expect(missingPartNumbers(session)).toEqual([]);
    expect(totalRecordedPartBytes(session)).toBe(12);
    expect(nextMultipartPartNumber(session)).toBeUndefined();
    expect(multipartSessionProgress(session)).toEqual({
      uploadId: "upload-1",
      recordedParts: 2,
      expectedParts: 2,
      recordedBytes: 12,
      totalBytes: 12,
      missingParts: [],
      completeable: true,
    });
    expect(planMultipartCompletion(session)).toEqual({
      uploadId: "upload-1",
      objectKey: "objects/demo.bin",
      parts: [
        { partNumber: 1, etag: "etag-1" },
        { partNumber: 2, etag: "etag-2b" },
      ],
    });
  });

  it("rejects invalid part sizes, missing parts, and byte-count mismatches", () => {
    const session = createMultipartSession({
      uploadId: "upload-2",
      objectKey: "objects/bad.bin",
      totalBytes: 13,
      expectedParts: 2,
      nowMs: 1000,
      policy,
    });

    expect(() =>
      recordMultipartPart(session, {
        partNumber: 1,
        sizeBytes: 4,
        checksum: "sha256:a",
        etag: "etag-1",
        nowMs: 1010,
        policy,
      }),
    ).toThrow("non-final part is smaller than minPartBytes");

    expect(() =>
      recordMultipartPart(session, {
        partNumber: 2,
        sizeBytes: 11,
        checksum: "sha256:b",
        etag: "etag-2",
        nowMs: 1010,
        policy,
      }),
    ).toThrow("part exceeds maxPartBytes");

    const partial = recordMultipartPart(session, {
      partNumber: 1,
      sizeBytes: 5,
      checksum: "sha256:a",
      etag: "etag-1",
      nowMs: 1010,
      policy,
    });
    expect(() => planMultipartCompletion(partial)).toThrow("missing parts: 2");
    expect(multipartSessionProgress(partial)).toEqual({
      uploadId: "upload-2",
      recordedParts: 1,
      expectedParts: 2,
      recordedBytes: 5,
      totalBytes: 13,
      missingParts: [2],
      completeable: false,
    });

    const mismatched = recordMultipartPart(partial, {
      partNumber: 2,
      sizeBytes: 7,
      checksum: "sha256:b",
      etag: "etag-2",
      nowMs: 1020,
      policy,
    });
    expect(() => planMultipartCompletion(mismatched)).toThrow(
      "recorded part bytes 12 do not match totalBytes 13",
    );
  });

  it("completes, aborts, expires, and snapshots session state", () => {
    let completeable = createMultipartSession({
      uploadId: "upload-3",
      objectKey: "objects/done.bin",
      totalBytes: 12,
      expectedParts: 2,
      nowMs: 1000,
      policy,
    });
    completeable = recordMultipartPart(completeable, {
      partNumber: 1,
      sizeBytes: 5,
      checksum: "sha256:a",
      etag: "etag-1",
      nowMs: 1010,
      policy,
    });
    completeable = recordMultipartPart(completeable, {
      partNumber: 2,
      sizeBytes: 7,
      checksum: "sha256:b",
      etag: "etag-2",
      nowMs: 1020,
      policy,
    });
    const completed = completeMultipartSession(completeable, 1030);

    const aborted = abortMultipartSession(
      createMultipartSession({
        uploadId: "upload-4",
        objectKey: "objects/abort.bin",
        totalBytes: 5,
        expectedParts: 1,
        nowMs: 1000,
        policy,
      }),
      { nowMs: 1010, reason: "client cancelled" },
    );
    expect(() =>
      recordMultipartPart(aborted, {
        partNumber: 1,
        sizeBytes: 5,
        checksum: "sha256:a",
        etag: "etag-1",
        nowMs: 1020,
        policy,
      }),
    ).toThrow("session is not open");

    const expired = expireMultipartSession(
      createMultipartSession({
        uploadId: "upload-5",
        objectKey: "objects/expired.bin",
        totalBytes: 5,
        expectedParts: 1,
        nowMs: 1000,
        policy,
      }),
      1100,
    );

    expect(multipartSessionSnapshot([completed, aborted, expired])).toEqual({
      open: 0,
      completed: 1,
      aborted: 1,
      expired: 1,
    });
  });

  it("provides a clone-safe in-memory session store", () => {
    let now = 1000;
    const store = new MemoryMultipartUploadStore({ policy, now: () => now });

    store.create({
      uploadId: "upload-6",
      objectKey: "objects/store.bin",
      totalBytes: 12,
      expectedParts: 2,
    });
    store.recordPart({
      uploadId: "upload-6",
      partNumber: 1,
      sizeBytes: 5,
      checksum: "sha256:a",
      etag: "etag-1",
    });
    store.recordPart({
      uploadId: "upload-6",
      partNumber: 2,
      sizeBytes: 7,
      checksum: "sha256:b",
      etag: "etag-2",
    });

    const leaked = store.listSessions();
    (leaked[0]!.parts[0]! as { etag: string }).etag = "mutated";

    expect(store.completionPlan("upload-6").parts[0]).toEqual({
      partNumber: 1,
      etag: "etag-1",
    });
    expect(store.progress("upload-6")).toEqual(
      expect.objectContaining({ recordedParts: 2, completeable: true }),
    );
    expect(store.nextPartNumber("upload-6")).toBeUndefined();
    expect(store.complete("upload-6").status).toBe("completed");
    expect(store.snapshot()).toEqual({ open: 0, completed: 1, aborted: 0, expired: 0 });

    store.create({
      uploadId: "upload-7",
      objectKey: "objects/expire.bin",
      totalBytes: 5,
      expectedParts: 1,
    });
    now = 1100;
    store.expireOpen();
    expect(store.snapshot()).toEqual({ open: 0, completed: 1, aborted: 0, expired: 1 });
  });

  it("reports the next missing part in the in-memory session store", () => {
    const store = new MemoryMultipartUploadStore({ policy, now: () => 1000 });
    store.create({
      uploadId: "upload-8",
      objectKey: "objects/partial.bin",
      totalBytes: 12,
      expectedParts: 2,
    });
    expect(store.nextPartNumber("upload-8")).toBe(1);
    store.recordPart({
      uploadId: "upload-8",
      partNumber: 1,
      sizeBytes: 5,
      checksum: "sha256:a",
      etag: "etag-1",
    });
    expect(store.nextPartNumber("upload-8")).toBe(2);
    expect(store.progress("upload-8")).toEqual(
      expect.objectContaining({ recordedParts: 1, missingParts: [2], completeable: false }),
    );
  });
});

export type MultipartSessionStatus = "open" | "completed" | "aborted" | "expired";

export interface MultipartUploadPolicy {
  minPartBytes: number;
  maxPartBytes: number;
  maxParts: number;
  ttlMs: number;
}

export interface MultipartPart {
  partNumber: number;
  sizeBytes: number;
  checksum: string;
  etag: string;
  recordedAtMs: number;
}

export interface MultipartUploadSession {
  uploadId: string;
  objectKey: string;
  totalBytes: number;
  expectedParts: number;
  createdAtMs: number;
  expiresAtMs: number;
  status: MultipartSessionStatus;
  parts: readonly MultipartPart[];
  completedAtMs?: number;
  abortedAtMs?: number;
  reason?: string;
}

export interface MultipartCompletionPlan {
  uploadId: string;
  objectKey: string;
  parts: readonly {
    partNumber: number;
    etag: string;
  }[];
}

export interface MultipartSessionSnapshot {
  open: number;
  completed: number;
  aborted: number;
  expired: number;
}

export interface MultipartSessionProgress {
  uploadId: string;
  recordedParts: number;
  expectedParts: number;
  recordedBytes: number;
  totalBytes: number;
  missingParts: number[];
  completeable: boolean;
}

export function createMultipartSession(input: {
  uploadId: string;
  objectKey: string;
  totalBytes: number;
  expectedParts: number;
  nowMs: number;
  policy: MultipartUploadPolicy;
}): MultipartUploadSession {
  assertNonEmpty(input.uploadId, "uploadId");
  assertNonEmpty(input.objectKey, "objectKey");
  assertPositiveInteger(input.totalBytes, "totalBytes");
  assertPositiveInteger(input.expectedParts, "expectedParts");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPolicy(input.policy);
  if (input.expectedParts > input.policy.maxParts)
    throw new Error("expectedParts exceeds maxParts");
  return {
    uploadId: input.uploadId,
    objectKey: input.objectKey,
    totalBytes: input.totalBytes,
    expectedParts: input.expectedParts,
    createdAtMs: input.nowMs,
    expiresAtMs: input.nowMs + input.policy.ttlMs,
    status: "open",
    parts: [],
  };
}

export function recordMultipartPart(
  session: MultipartUploadSession,
  input: {
    partNumber: number;
    sizeBytes: number;
    checksum: string;
    etag: string;
    nowMs: number;
    policy: MultipartUploadPolicy;
  },
): MultipartUploadSession {
  assertOpen(session, input.nowMs);
  assertPolicy(input.policy);
  assertPositiveInteger(input.partNumber, "partNumber");
  assertPositiveInteger(input.sizeBytes, "sizeBytes");
  assertNonEmpty(input.checksum, "checksum");
  assertNonEmpty(input.etag, "etag");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (input.partNumber > session.expectedParts) throw new Error("partNumber exceeds expectedParts");
  const isLastPart = input.partNumber === session.expectedParts;
  if (!isLastPart && input.sizeBytes < input.policy.minPartBytes) {
    throw new Error("non-final part is smaller than minPartBytes");
  }
  if (input.sizeBytes > input.policy.maxPartBytes) {
    throw new Error("part exceeds maxPartBytes");
  }
  const nextPart: MultipartPart = {
    partNumber: input.partNumber,
    sizeBytes: input.sizeBytes,
    checksum: input.checksum,
    etag: input.etag,
    recordedAtMs: input.nowMs,
  };
  return cloneSession({
    ...session,
    parts: [...session.parts.filter((part) => part.partNumber !== input.partNumber), nextPart].sort(
      (left, right) => left.partNumber - right.partNumber,
    ),
  });
}

export function planMultipartCompletion(session: MultipartUploadSession): MultipartCompletionPlan {
  if (session.status !== "open") throw new Error("session is not open");
  const missing = missingPartNumbers(session);
  if (missing.length > 0) throw new Error(`missing parts: ${missing.join(",")}`);
  const recordedBytes = totalRecordedPartBytes(session);
  if (recordedBytes !== session.totalBytes) {
    throw new Error(
      `recorded part bytes ${recordedBytes} do not match totalBytes ${session.totalBytes}`,
    );
  }
  return {
    uploadId: session.uploadId,
    objectKey: session.objectKey,
    parts: session.parts
      .map((part) => ({ partNumber: part.partNumber, etag: part.etag }))
      .sort((left, right) => left.partNumber - right.partNumber),
  };
}

export function completeMultipartSession(
  session: MultipartUploadSession,
  nowMs: number,
): MultipartUploadSession {
  assertOpen(session, nowMs);
  planMultipartCompletion(session);
  return cloneSession({
    ...session,
    status: "completed",
    completedAtMs: nowMs,
  });
}

export function abortMultipartSession(
  session: MultipartUploadSession,
  input: {
    nowMs: number;
    reason: string;
  },
): MultipartUploadSession {
  assertOpen(session, input.nowMs);
  assertNonEmpty(input.reason, "reason");
  return cloneSession({
    ...session,
    status: "aborted",
    abortedAtMs: input.nowMs,
    reason: input.reason,
  });
}

export function expireMultipartSession(
  session: MultipartUploadSession,
  nowMs: number,
): MultipartUploadSession {
  assertNonNegativeInteger(nowMs, "nowMs");
  if (session.status !== "open" || nowMs < session.expiresAtMs) return cloneSession(session);
  return cloneSession({
    ...session,
    status: "expired",
    reason: "ttl expired",
  });
}

export function missingPartNumbers(session: MultipartUploadSession): number[] {
  const recorded = new Set(session.parts.map((part) => part.partNumber));
  return Array.from({ length: session.expectedParts }, (_, index) => index + 1).filter(
    (partNumber) => !recorded.has(partNumber),
  );
}

export function totalRecordedPartBytes(session: MultipartUploadSession): number {
  return session.parts.reduce((total, part) => total + part.sizeBytes, 0);
}

export function multipartSessionSnapshot(
  sessions: readonly MultipartUploadSession[],
): MultipartSessionSnapshot {
  return {
    open: sessions.filter((session) => session.status === "open").length,
    completed: sessions.filter((session) => session.status === "completed").length,
    aborted: sessions.filter((session) => session.status === "aborted").length,
    expired: sessions.filter((session) => session.status === "expired").length,
  };
}

export function multipartSessionProgress(
  session: MultipartUploadSession,
): MultipartSessionProgress {
  const recordedBytes = totalRecordedPartBytes(session);
  const missingParts = missingPartNumbers(session);
  return {
    uploadId: session.uploadId,
    recordedParts: session.parts.length,
    expectedParts: session.expectedParts,
    recordedBytes,
    totalBytes: session.totalBytes,
    missingParts,
    completeable:
      session.status === "open" &&
      missingParts.length === 0 &&
      recordedBytes === session.totalBytes,
  };
}

export function nextMultipartPartNumber(session: MultipartUploadSession): number | undefined {
  return missingPartNumbers(session)[0];
}

export function cloneMultipartSession(session: MultipartUploadSession): MultipartUploadSession {
  return cloneSession(session);
}

function assertOpen(session: MultipartUploadSession, nowMs: number): void {
  assertNonNegativeInteger(nowMs, "nowMs");
  if (session.status !== "open") throw new Error("session is not open");
  if (nowMs >= session.expiresAtMs) throw new Error("session is expired");
}

function assertPolicy(policy: MultipartUploadPolicy): void {
  assertPositiveInteger(policy.minPartBytes, "minPartBytes");
  assertPositiveInteger(policy.maxPartBytes, "maxPartBytes");
  assertPositiveInteger(policy.maxParts, "maxParts");
  assertPositiveInteger(policy.ttlMs, "ttlMs");
  if (policy.minPartBytes > policy.maxPartBytes) {
    throw new Error("minPartBytes exceeds maxPartBytes");
  }
}

function cloneSession(session: MultipartUploadSession): MultipartUploadSession {
  return {
    ...session,
    parts: session.parts.map((part) => ({ ...part })),
  };
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

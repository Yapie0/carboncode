export type UploadSessionStatus = "initiated" | "completed" | "aborted" | "expired";

export interface UploadPartPlan {
  partNumber: number;
  startByte: number;
  endByteInclusive: number;
  sizeBytes: number;
}

export interface UploadPartRecord extends UploadPartPlan {
  etag: string;
  uploadedAtMs: number;
}

export interface UploadSession {
  uploadId: string;
  objectKey: string;
  contentType: string;
  totalBytes: number;
  partSizeBytes: number;
  status: UploadSessionStatus;
  createdAtMs: number;
  expiresAtMs: number;
  completedAtMs?: number;
  abortedAtMs?: number;
  parts: readonly UploadPartRecord[];
}

export interface CreateUploadSessionInput {
  uploadId: string;
  objectKey: string;
  contentType: string;
  totalBytes: number;
  partSizeBytes: number;
  nowMs: number;
  ttlMs: number;
}

export interface CompleteUploadResult {
  completed: boolean;
  missingParts: number[];
  session: UploadSession;
}

export interface UploadSessionProgress {
  totalParts: number;
  uploadedParts: number;
  missingParts: number[];
  uploadedBytes: number;
  totalBytes: number;
  percent: number;
  completeable: boolean;
}

export function planMultipartUpload(totalBytes: number, partSizeBytes: number): UploadPartPlan[] {
  assertPositiveInteger(totalBytes, "totalBytes");
  assertPositiveInteger(partSizeBytes, "partSizeBytes");
  const parts: UploadPartPlan[] = [];
  let start = 0;
  let partNumber = 1;
  while (start < totalBytes) {
    const end = Math.min(totalBytes - 1, start + partSizeBytes - 1);
    parts.push({
      partNumber,
      startByte: start,
      endByteInclusive: end,
      sizeBytes: end - start + 1,
    });
    start = end + 1;
    partNumber++;
  }
  return parts;
}

export function createUploadSession(input: CreateUploadSessionInput): UploadSession {
  assertText(input.uploadId, "uploadId");
  assertText(input.objectKey, "objectKey");
  assertText(input.contentType, "contentType");
  assertPositiveInteger(input.totalBytes, "totalBytes");
  assertPositiveInteger(input.partSizeBytes, "partSizeBytes");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.ttlMs, "ttlMs");
  return {
    uploadId: input.uploadId,
    objectKey: input.objectKey,
    contentType: input.contentType,
    totalBytes: input.totalBytes,
    partSizeBytes: input.partSizeBytes,
    status: "initiated",
    createdAtMs: input.nowMs,
    expiresAtMs: input.nowMs + input.ttlMs,
    parts: [],
  };
}

export function recordUploadedPart(
  session: UploadSession,
  partNumber: number,
  etag: string,
  nowMs: number,
): UploadSession {
  assertActive(session, nowMs);
  assertPositiveInteger(partNumber, "partNumber");
  assertText(etag, "etag");
  const plan = planMultipartUpload(session.totalBytes, session.partSizeBytes).find(
    (part) => part.partNumber === partNumber,
  );
  if (!plan) throw new Error(`invalid part number: ${partNumber}`);
  const record: UploadPartRecord = { ...plan, etag, uploadedAtMs: nowMs };
  const parts = [...session.parts.filter((part) => part.partNumber !== partNumber), record].sort(
    (a, b) => a.partNumber - b.partNumber,
  );
  return { ...session, parts };
}

export function completeUploadSession(session: UploadSession, nowMs: number): CompleteUploadResult {
  assertActive(session, nowMs);
  const expected = planMultipartUpload(session.totalBytes, session.partSizeBytes);
  const uploaded = new Set(session.parts.map((part) => part.partNumber));
  const missingParts = expected
    .filter((part) => !uploaded.has(part.partNumber))
    .map((part) => part.partNumber);
  if (missingParts.length > 0) {
    return { completed: false, missingParts, session };
  }
  return {
    completed: true,
    missingParts: [],
    session: { ...session, status: "completed", completedAtMs: nowMs },
  };
}

export function uploadSessionProgress(session: UploadSession): UploadSessionProgress {
  const expected = planMultipartUpload(session.totalBytes, session.partSizeBytes);
  const uploaded = new Map(session.parts.map((part) => [part.partNumber, part]));
  const missingParts = expected
    .filter((part) => !uploaded.has(part.partNumber))
    .map((part) => part.partNumber);
  const uploadedBytes = expected.reduce((sum, part) => {
    return uploaded.has(part.partNumber) ? sum + part.sizeBytes : sum;
  }, 0);
  return {
    totalParts: expected.length,
    uploadedParts: expected.length - missingParts.length,
    missingParts,
    uploadedBytes,
    totalBytes: session.totalBytes,
    percent: Math.round((uploadedBytes / session.totalBytes) * 10000) / 100,
    completeable: session.status === "initiated" && missingParts.length === 0,
  };
}

export function missingUploadParts(session: UploadSession): UploadPartPlan[] {
  const uploaded = new Set(session.parts.map((part) => part.partNumber));
  return planMultipartUpload(session.totalBytes, session.partSizeBytes).filter(
    (part) => !uploaded.has(part.partNumber),
  );
}

export function nextUploadPart(session: UploadSession): UploadPartPlan | undefined {
  return missingUploadParts(session)[0];
}

export function abortUploadSession(session: UploadSession, nowMs: number): UploadSession {
  assertNonNegativeInteger(nowMs, "nowMs");
  if (session.status === "completed") throw new Error("cannot abort a completed upload");
  if (session.status === "aborted") return session;
  return { ...session, status: "aborted", abortedAtMs: nowMs };
}

export function expireUploadSession(session: UploadSession, nowMs: number): UploadSession {
  assertNonNegativeInteger(nowMs, "nowMs");
  if (session.status !== "initiated") return session;
  if (session.expiresAtMs > nowMs) return session;
  return { ...session, status: "expired" };
}

export function assertPartMatchesPlan(session: UploadSession, part: UploadPartRecord): void {
  const plan = planMultipartUpload(session.totalBytes, session.partSizeBytes).find(
    (entry) => entry.partNumber === part.partNumber,
  );
  if (!plan) throw new Error(`invalid part number: ${part.partNumber}`);
  if (part.startByte !== plan.startByte || part.endByteInclusive !== plan.endByteInclusive) {
    throw new Error(`part ${part.partNumber} byte range does not match upload plan`);
  }
}

export function cloneUploadSession(session: UploadSession): UploadSession {
  return {
    ...session,
    parts: session.parts.map((part) => ({ ...part })),
  };
}

export function cloneCompleteUploadResult(result: CompleteUploadResult): CompleteUploadResult {
  return {
    ...result,
    missingParts: [...result.missingParts],
    session: cloneUploadSession(result.session),
  };
}

function assertActive(session: UploadSession, nowMs: number): void {
  assertNonNegativeInteger(nowMs, "nowMs");
  if (session.status !== "initiated") throw new Error(`upload is ${session.status}`);
  if (session.expiresAtMs <= nowMs) throw new Error("upload session expired");
}

function assertText(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative integer`);
}

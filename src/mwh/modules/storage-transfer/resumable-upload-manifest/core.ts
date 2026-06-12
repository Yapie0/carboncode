import { createHash } from "node:crypto";

export type ResumableUploadStatus = "open" | "completed" | "aborted" | "expired";

export interface UploadChunkPlan {
  index: number;
  startByte: number;
  endByteInclusive: number;
  sizeBytes: number;
}

export interface UploadedChunkRecord extends UploadChunkPlan {
  checksumSha256: string;
  uploadedAtMs: number;
}

export interface ResumableUploadManifest {
  id: string;
  objectKey: string;
  totalBytes: number;
  chunkSizeBytes: number;
  status: ResumableUploadStatus;
  createdAtMs: number;
  expiresAtMs: number;
  chunks: readonly UploadedChunkRecord[];
  completedAtMs?: number;
  abortedAtMs?: number;
}

export interface CompleteResumableUploadResult {
  completed: boolean;
  missingChunks: number[];
  mergePlan: UploadedChunkRecord[];
  manifest: ResumableUploadManifest;
}

export interface ResumableUploadProgress {
  id: string;
  uploadedChunks: number;
  totalChunks: number;
  uploadedBytes: number;
  totalBytes: number;
  missingChunks: number[];
  completeable: boolean;
}

export function planUploadChunks(totalBytes: number, chunkSizeBytes: number): UploadChunkPlan[] {
  assertPositiveInteger(totalBytes, "totalBytes");
  assertPositiveInteger(chunkSizeBytes, "chunkSizeBytes");
  const chunks: UploadChunkPlan[] = [];
  let startByte = 0;
  let index = 0;
  while (startByte < totalBytes) {
    const endByteInclusive = Math.min(totalBytes - 1, startByte + chunkSizeBytes - 1);
    chunks.push({
      index,
      startByte,
      endByteInclusive,
      sizeBytes: endByteInclusive - startByte + 1,
    });
    startByte = endByteInclusive + 1;
    index += 1;
  }
  return chunks;
}

export function createResumableUploadManifest(input: {
  id: string;
  objectKey: string;
  totalBytes: number;
  chunkSizeBytes: number;
  nowMs: number;
  ttlMs: number;
}): ResumableUploadManifest {
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.objectKey, "objectKey");
  assertPositiveInteger(input.totalBytes, "totalBytes");
  assertPositiveInteger(input.chunkSizeBytes, "chunkSizeBytes");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  assertPositiveInteger(input.ttlMs, "ttlMs");
  return {
    id: input.id,
    objectKey: input.objectKey,
    totalBytes: input.totalBytes,
    chunkSizeBytes: input.chunkSizeBytes,
    status: "open",
    createdAtMs: input.nowMs,
    expiresAtMs: input.nowMs + input.ttlMs,
    chunks: [],
  };
}

export function recordUploadChunk(
  manifest: ResumableUploadManifest,
  input: { index: number; bytes: Uint8Array | string; checksumSha256?: string; nowMs: number },
): ResumableUploadManifest {
  assertOpen(manifest, input.nowMs);
  assertNonNegativeInteger(input.index, "index");
  const plan = planUploadChunks(manifest.totalBytes, manifest.chunkSizeBytes).find(
    (chunk) => chunk.index === input.index,
  );
  if (!plan) throw new Error(`invalid chunk index: ${input.index}`);
  const actualSize = byteLength(input.bytes);
  if (actualSize !== plan.sizeBytes) {
    throw new Error(`chunk ${input.index} size mismatch`);
  }
  const checksumSha256 = sha256(input.bytes);
  if (input.checksumSha256 && input.checksumSha256 !== checksumSha256) {
    throw new Error(`chunk ${input.index} checksum mismatch`);
  }
  const record: UploadedChunkRecord = {
    ...plan,
    checksumSha256,
    uploadedAtMs: input.nowMs,
  };
  const chunks = [...manifest.chunks.filter((chunk) => chunk.index !== input.index), record].sort(
    (a, b) => a.index - b.index,
  );
  return { ...manifest, chunks };
}

export function missingUploadChunks(manifest: ResumableUploadManifest): number[] {
  const uploaded = new Set(manifest.chunks.map((chunk) => chunk.index));
  return planUploadChunks(manifest.totalBytes, manifest.chunkSizeBytes)
    .filter((chunk) => !uploaded.has(chunk.index))
    .map((chunk) => chunk.index);
}

export function resumableUploadProgress(
  manifest: ResumableUploadManifest,
): ResumableUploadProgress {
  const missingChunks = missingUploadChunks(manifest);
  const uploadedBytes = manifest.chunks.reduce((total, chunk) => total + chunk.sizeBytes, 0);
  const totalChunks = planUploadChunks(manifest.totalBytes, manifest.chunkSizeBytes).length;
  return {
    id: manifest.id,
    uploadedChunks: manifest.chunks.length,
    totalChunks,
    uploadedBytes,
    totalBytes: manifest.totalBytes,
    missingChunks,
    completeable:
      manifest.status === "open" &&
      missingChunks.length === 0 &&
      uploadedBytes === manifest.totalBytes,
  };
}

export function nextMissingUploadChunk(
  manifest: ResumableUploadManifest,
): UploadChunkPlan | undefined {
  const missing = new Set(missingUploadChunks(manifest));
  return planUploadChunks(manifest.totalBytes, manifest.chunkSizeBytes).find((chunk) =>
    missing.has(chunk.index),
  );
}

export function completeResumableUpload(
  manifest: ResumableUploadManifest,
  nowMs: number,
): CompleteResumableUploadResult {
  assertOpen(manifest, nowMs);
  const missingChunks = missingUploadChunks(manifest);
  if (missingChunks.length > 0) {
    return { completed: false, missingChunks, mergePlan: [], manifest };
  }
  const mergePlan = [...manifest.chunks].sort((a, b) => a.index - b.index);
  return {
    completed: true,
    missingChunks: [],
    mergePlan,
    manifest: { ...manifest, status: "completed", completedAtMs: nowMs },
  };
}

export function abortResumableUpload(
  manifest: ResumableUploadManifest,
  nowMs: number,
): ResumableUploadManifest {
  assertNonNegativeInteger(nowMs, "nowMs");
  if (manifest.status === "completed") throw new Error("cannot abort completed upload");
  if (manifest.status === "aborted") return manifest;
  return { ...manifest, status: "aborted", abortedAtMs: nowMs };
}

export function expireResumableUpload(
  manifest: ResumableUploadManifest,
  nowMs: number,
): ResumableUploadManifest {
  assertNonNegativeInteger(nowMs, "nowMs");
  if (manifest.status !== "open") return manifest;
  return nowMs >= manifest.expiresAtMs ? { ...manifest, status: "expired" } : manifest;
}

export function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function byteLength(bytes: Uint8Array | string): number {
  return typeof bytes === "string" ? Buffer.byteLength(bytes) : bytes.byteLength;
}

function assertOpen(manifest: ResumableUploadManifest, nowMs: number): void {
  assertNonNegativeInteger(nowMs, "nowMs");
  if (manifest.status !== "open") throw new Error(`upload is ${manifest.status}`);
  if (nowMs >= manifest.expiresAtMs) throw new Error("upload manifest expired");
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}

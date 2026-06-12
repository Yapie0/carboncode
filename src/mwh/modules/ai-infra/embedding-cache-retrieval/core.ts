import { createHash } from "node:crypto";

export interface EmbeddingRecord<TMetadata = Record<string, unknown>> {
  id: string;
  model: string;
  textHash: string;
  normalizedText: string;
  vector: readonly number[];
  metadata?: TMetadata;
  createdAtMs: number;
  expiresAtMs?: number;
}

export interface SearchResult<TMetadata = Record<string, unknown>> {
  record: EmbeddingRecord<TMetadata>;
  score: number;
}

export function normalizeEmbeddingText(text: string): string {
  const normalized = text.trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) throw new Error("text is required");
  return normalized;
}

export function embeddingCacheKey(input: { model: string; text: string }): string {
  assertNonEmpty(input.model, "model");
  const normalizedText = normalizeEmbeddingText(input.text);
  return createHash("sha256").update(`${input.model}\n${normalizedText}`, "utf8").digest("hex");
}

export function createEmbeddingRecord<TMetadata>(input: {
  id: string;
  model: string;
  text: string;
  vector: readonly number[];
  metadata?: TMetadata;
  nowMs: number;
  ttlMs?: number;
}): EmbeddingRecord<TMetadata> {
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.model, "model");
  assertVector(input.vector, "vector");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  if (input.ttlMs !== undefined) assertPositiveInteger(input.ttlMs, "ttlMs");
  const normalizedText = normalizeEmbeddingText(input.text);
  return {
    id: input.id,
    model: input.model,
    textHash: embeddingCacheKey({ model: input.model, text: normalizedText }),
    normalizedText,
    vector: [...input.vector],
    metadata: input.metadata,
    createdAtMs: input.nowMs,
    expiresAtMs: input.ttlMs === undefined ? undefined : input.nowMs + input.ttlMs,
  };
}

export function isEmbeddingExpired(
  record: Pick<EmbeddingRecord<unknown>, "expiresAtMs">,
  nowMs: number,
): boolean {
  assertNonNegativeInteger(nowMs, "nowMs");
  return record.expiresAtMs !== undefined && nowMs >= record.expiresAtMs;
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  assertVector(left, "left");
  assertVector(right, "right");
  if (left.length !== right.length) throw new Error("vectors must have the same dimension");
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index]!;
    const rightValue = right[index]!;
    dot += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function searchEmbeddings<TMetadata>(input: {
  records: readonly EmbeddingRecord<TMetadata>[];
  queryVector: readonly number[];
  model: string;
  nowMs: number;
  topK?: number;
  minScore?: number;
}): SearchResult<TMetadata>[] {
  assertVector(input.queryVector, "queryVector");
  assertNonEmpty(input.model, "model");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  const topK = input.topK ?? 5;
  assertPositiveInteger(topK, "topK");
  const minScore = input.minScore ?? -1;
  if (!Number.isFinite(minScore) || minScore < -1 || minScore > 1) {
    throw new Error("minScore must be between -1 and 1");
  }

  return input.records
    .filter((record) => record.model === input.model && !isEmbeddingExpired(record, input.nowMs))
    .map((record) => ({ record, score: cosineSimilarity(input.queryVector, record.vector) }))
    .filter((result) => result.score >= minScore)
    .sort(
      (left, right) =>
        right.score - left.score || left.record.createdAtMs - right.record.createdAtMs,
    )
    .slice(0, topK);
}

function assertNonEmpty(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function assertVector(vector: readonly number[], name: string): void {
  if (!vector.length) throw new Error(`${name} is required`);
  if (vector.some((value) => !Number.isFinite(value))) {
    throw new Error(`${name} must contain only finite numbers`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${name} must be a non-negative integer`);
}

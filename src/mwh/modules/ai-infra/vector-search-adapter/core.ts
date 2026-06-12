export type VectorMetric = "cosine" | "dot" | "euclidean";

export interface VectorDocument<TMetadata = Record<string, unknown>> {
  id: string;
  namespace: string;
  vector: readonly number[];
  metadata?: TMetadata;
  content?: string;
  updatedAtMs: number;
}

export interface VectorSearchFilter {
  namespace?: string;
  metadata?: Record<string, unknown>;
}

export interface VectorSearchResult<TMetadata = Record<string, unknown>> {
  document: VectorDocument<TMetadata>;
  score: number;
}

export function createVectorDocument<TMetadata>(input: {
  id: string;
  namespace: string;
  vector: readonly number[];
  metadata?: TMetadata;
  content?: string;
  nowMs: number;
}): VectorDocument<TMetadata> {
  assertNonEmpty(input.id, "id");
  assertNonEmpty(input.namespace, "namespace");
  assertVector(input.vector, "vector");
  assertNonNegativeInteger(input.nowMs, "nowMs");
  return {
    id: input.id,
    namespace: input.namespace,
    vector: [...input.vector],
    metadata: cloneValue(input.metadata),
    content: input.content,
    updatedAtMs: input.nowMs,
  };
}

export function vectorScore(
  left: readonly number[],
  right: readonly number[],
  metric: VectorMetric = "cosine",
): number {
  assertSameDimension(left, right);
  if (metric === "cosine") return cosineScore(left, right);
  if (metric === "dot") return dotScore(left, right);
  if (metric === "euclidean") return 1 / (1 + euclideanDistance(left, right));
  throw new Error(`unsupported vector metric: ${metric satisfies never}`);
}

export function searchVectorDocuments<TMetadata>(input: {
  documents: readonly VectorDocument<TMetadata>[];
  queryVector: readonly number[];
  topK: number;
  metric?: VectorMetric;
  minScore?: number;
  filter?: VectorSearchFilter;
}): VectorSearchResult<TMetadata>[] {
  assertVector(input.queryVector, "queryVector");
  assertPositiveInteger(input.topK, "topK");
  const metric = input.metric ?? "cosine";
  const minScore = input.minScore ?? Number.NEGATIVE_INFINITY;
  if (!Number.isFinite(minScore) && minScore !== Number.NEGATIVE_INFINITY) {
    throw new Error("minScore must be finite");
  }

  return input.documents
    .filter((document) => matchesVectorFilter(document, input.filter))
    .map((document) => ({
      document,
      score: vectorScore(input.queryVector, document.vector, metric),
    }))
    .filter((result) => result.score >= minScore)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.document.updatedAtMs - left.document.updatedAtMs ||
        left.document.id.localeCompare(right.document.id),
    )
    .slice(0, input.topK)
    .map((result) => ({ score: result.score, document: cloneVectorDocument(result.document) }));
}

export function matchesVectorFilter<TMetadata>(
  document: VectorDocument<TMetadata>,
  filter: VectorSearchFilter | undefined,
): boolean {
  if (!filter) return true;
  if (filter.namespace !== undefined && document.namespace !== filter.namespace) return false;
  if (!filter.metadata) return true;
  const metadata = document.metadata as Record<string, unknown> | undefined;
  if (!metadata) return false;
  return Object.entries(filter.metadata).every(([key, expected]) => metadata[key] === expected);
}

export function cloneVectorDocument<TMetadata>(
  document: VectorDocument<TMetadata>,
): VectorDocument<TMetadata> {
  return {
    ...document,
    vector: [...document.vector],
    metadata: cloneValue(document.metadata),
  };
}

function cosineScore(left: readonly number[], right: readonly number[]): number {
  const dot = dotScore(left, right);
  const leftNorm = Math.sqrt(dotScore(left, left));
  const rightNorm = Math.sqrt(dotScore(right, right));
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (leftNorm * rightNorm);
}

function dotScore(left: readonly number[], right: readonly number[]): number {
  assertSameDimension(left, right);
  let score = 0;
  for (let index = 0; index < left.length; index += 1) {
    score += left[index]! * right[index]!;
  }
  return score;
}

function euclideanDistance(left: readonly number[], right: readonly number[]): number {
  assertSameDimension(left, right);
  let sum = 0;
  for (let index = 0; index < left.length; index += 1) {
    const delta = left[index]! - right[index]!;
    sum += delta * delta;
  }
  return Math.sqrt(sum);
}

function assertSameDimension(left: readonly number[], right: readonly number[]): void {
  assertVector(left, "left");
  assertVector(right, "right");
  if (left.length !== right.length) throw new Error("vectors must have the same dimension");
}

function assertVector(vector: readonly number[], name: string): void {
  if (!vector.length) throw new Error(`${name} is required`);
  if (vector.some((value) => !Number.isFinite(value))) {
    throw new Error(`${name} must contain only finite numbers`);
  }
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

function cloneValue<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

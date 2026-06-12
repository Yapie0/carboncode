import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  createEmbeddingRecord,
  embeddingCacheKey,
  isEmbeddingExpired,
  normalizeEmbeddingText,
  searchEmbeddings,
} from "../src/mwh/modules/ai-infra/embedding-cache-retrieval/core.js";
import { MemoryEmbeddingIndex } from "../src/mwh/modules/ai-infra/embedding-cache-retrieval/memory-index.js";

describe("MWH embedding-cache-retrieval middleware", () => {
  it("normalizes text and creates stable model-aware cache keys", () => {
    expect(normalizeEmbeddingText("  Carbon   Code\nMWH  ")).toBe("carbon code mwh");
    expect(embeddingCacheKey({ model: "m1", text: "Carbon Code" })).toBe(
      embeddingCacheKey({ model: "m1", text: " carbon   code " }),
    );
    expect(embeddingCacheKey({ model: "m1", text: "Carbon Code" })).not.toBe(
      embeddingCacheKey({ model: "m2", text: "Carbon Code" }),
    );
  });

  it("creates records and detects TTL expiry", () => {
    const record = createEmbeddingRecord({
      id: "chunk-1",
      model: "m1",
      text: "Hello world",
      vector: [1, 0, 0],
      metadata: { source: "docs" },
      nowMs: 1_000,
      ttlMs: 500,
    });

    expect(record).toEqual(
      expect.objectContaining({
        id: "chunk-1",
        model: "m1",
        normalizedText: "hello world",
        createdAtMs: 1_000,
        expiresAtMs: 1_500,
      }),
    );
    expect(isEmbeddingExpired(record, 1_499)).toBe(false);
    expect(isEmbeddingExpired(record, 1_500)).toBe(true);
  });

  it("computes cosine similarity and rejects dimension mismatches", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1, 1], [1, 1])).toBeCloseTo(1);
    expect(() => cosineSimilarity([1, 0], [1])).toThrow("same dimension");
  });

  it("searches topK by model, expiry, and score threshold", () => {
    const records = [
      createEmbeddingRecord({
        id: "a",
        model: "m1",
        text: "alpha",
        vector: [1, 0],
        nowMs: 1_000,
      }),
      createEmbeddingRecord({
        id: "b",
        model: "m1",
        text: "beta",
        vector: [0.8, 0.2],
        nowMs: 1_001,
      }),
      createEmbeddingRecord({
        id: "c",
        model: "m2",
        text: "gamma",
        vector: [1, 0],
        nowMs: 1_002,
      }),
      createEmbeddingRecord({
        id: "expired",
        model: "m1",
        text: "old",
        vector: [1, 0],
        nowMs: 1_000,
        ttlMs: 100,
      }),
    ];

    expect(
      searchEmbeddings({
        records,
        model: "m1",
        queryVector: [1, 0],
        nowMs: 1_200,
        topK: 2,
        minScore: 0.9,
      }).map((result) => result.record.id),
    ).toEqual(["a", "b"]);
  });

  it("runs a stateful cache hit, model isolation, search, prune, and clone flow", () => {
    let now = 1_000;
    const index = new MemoryEmbeddingIndex<{ source: string }>({ now: () => now });

    const first = index.upsert({
      id: "chunk-1",
      model: "m1",
      text: "Carbon Code MWH",
      vector: [1, 0],
      metadata: { source: "docs" },
      ttlMs: 500,
    });
    index.upsert({
      id: "chunk-2",
      model: "m1",
      text: "Other text",
      vector: [0, 1],
      metadata: { source: "docs" },
    });
    index.upsert({
      id: "chunk-3",
      model: "m2",
      text: "Carbon Code MWH",
      vector: [1, 0],
      metadata: { source: "docs" },
    });

    expect(index.getByText("m1", " carbon code   mwh ")).toEqual(
      expect.objectContaining({ id: "chunk-1" }),
    );
    expect(index.getByText("m2", "Carbon Code MWH")).toEqual(
      expect.objectContaining({ id: "chunk-3" }),
    );
    expect(index.search({ model: "m1", queryVector: [1, 0], topK: 1 })[0]?.record.id).toBe(
      "chunk-1",
    );

    first.vector[0] = 99;
    expect(index.getByText("m1", "Carbon Code MWH")?.vector[0]).toBe(1);

    now = 1_500;
    expect(index.pruneExpired()).toBe(1);
    expect(index.getByText("m1", "Carbon Code MWH")).toBeUndefined();
    expect(index.size()).toBe(2);
  });
});

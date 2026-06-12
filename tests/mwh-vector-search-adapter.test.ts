import { describe, expect, it } from "vitest";
import {
  createVectorDocument,
  matchesVectorFilter,
  searchVectorDocuments,
  vectorScore,
} from "../src/mwh/modules/ai-infra/vector-search-adapter/core.js";
import { MemoryVectorSearchIndex } from "../src/mwh/modules/ai-infra/vector-search-adapter/memory-index.js";

describe("MWH vector-search-adapter middleware", () => {
  it("creates validated clone-safe vector documents", () => {
    const document = createVectorDocument({
      id: "doc-1",
      namespace: "project-a",
      vector: [1, 0],
      metadata: { tenantId: "t1" },
      content: "hello",
      nowMs: 1_000,
    });

    expect(document).toEqual({
      id: "doc-1",
      namespace: "project-a",
      vector: [1, 0],
      metadata: { tenantId: "t1" },
      content: "hello",
      updatedAtMs: 1_000,
    });
    expect(() =>
      createVectorDocument({
        id: "doc-2",
        namespace: "project-a",
        vector: [Number.NaN],
        nowMs: 1_000,
      }),
    ).toThrow("vector must contain only finite numbers");
  });

  it("scores vectors with cosine, dot, and euclidean metrics", () => {
    expect(vectorScore([1, 0], [1, 0], "cosine")).toBe(1);
    expect(vectorScore([1, 0], [0, 1], "cosine")).toBe(0);
    expect(vectorScore([2, 0], [3, 0], "dot")).toBe(6);
    expect(vectorScore([1, 0], [1, 0], "euclidean")).toBe(1);
    expect(vectorScore([1, 0], [2, 0], "euclidean")).toBe(0.5);
    expect(() => vectorScore([1, 0], [1], "cosine")).toThrow("same dimension");
  });

  it("filters and ranks topK vector documents deterministically", () => {
    const documents = [
      createVectorDocument({
        id: "old",
        namespace: "project-a",
        vector: [1, 0],
        metadata: { tenantId: "t1", visibility: "public" },
        nowMs: 1_000,
      }),
      createVectorDocument({
        id: "new",
        namespace: "project-a",
        vector: [1, 0],
        metadata: { tenantId: "t1", visibility: "public" },
        nowMs: 1_100,
      }),
      createVectorDocument({
        id: "other-tenant",
        namespace: "project-a",
        vector: [1, 0],
        metadata: { tenantId: "t2", visibility: "public" },
        nowMs: 1_200,
      }),
      createVectorDocument({
        id: "other-namespace",
        namespace: "project-b",
        vector: [1, 0],
        metadata: { tenantId: "t1", visibility: "public" },
        nowMs: 1_300,
      }),
    ];

    expect(matchesVectorFilter(documents[0]!, { metadata: { tenantId: "t1" } })).toBe(true);
    expect(
      searchVectorDocuments({
        documents,
        queryVector: [1, 0],
        topK: 2,
        minScore: 0.9,
        filter: { namespace: "project-a", metadata: { tenantId: "t1" } },
      }).map((result) => result.document.id),
    ).toEqual(["new", "old"]);
  });

  it("runs stateful upsert, get, delete, namespace list, search filter, update, and clone-safe flows", () => {
    let now = 1_000;
    const index = new MemoryVectorSearchIndex<{ tenantId: string; visibility: string }>({
      now: () => now,
    });
    index.upsert({
      id: "doc-1",
      namespace: "project-a",
      vector: [1, 0],
      metadata: { tenantId: "t1", visibility: "public" },
      content: "alpha",
    });
    index.upsert({
      id: "doc-2",
      namespace: "project-b",
      vector: [0, 1],
      metadata: { tenantId: "t1", visibility: "public" },
      content: "beta",
    });
    now = 1_100;
    index.upsert({
      id: "doc-1",
      namespace: "project-a",
      vector: [0.9, 0.1],
      metadata: { tenantId: "t1", visibility: "private" },
      content: "alpha updated",
    });

    expect(index.size()).toBe(2);
    expect(index.get("doc-1")).toEqual(
      expect.objectContaining({
        namespace: "project-a",
        content: "alpha updated",
        updatedAtMs: 1_100,
      }),
    );
    expect(index.list({ namespace: "project-a" }).map((document) => document.id)).toEqual([
      "doc-1",
    ]);
    expect(
      index
        .search({
          queryVector: [1, 0],
          topK: 10,
          filter: { namespace: "project-a", metadata: { visibility: "private" } },
        })
        .map((result) => result.document.id),
    ).toEqual(["doc-1"]);

    const read = index.get("doc-1")!;
    (read.vector as number[])[0] = 99;
    expect(index.get("doc-1")?.vector).toEqual([0.9, 0.1]);
    expect(index.delete("doc-1")).toBe(true);
    expect(index.get("doc-1")).toBeUndefined();
  });
});

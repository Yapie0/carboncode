import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Embedding Cache Retrieval Middleware

## Purpose

Use this module as a reusable reference when adding embedding caches, small vector retrieval, semantic search prefilters, prompt context lookup, or model-aware embedding reuse.

The module contains pure text normalization, cache-key generation, cosine similarity, TTL filtering, and topK ranking plus a deterministic memory index for tests. Production adapters can replace memory storage with pgvector, Redis Vector, Qdrant, Milvus, Chroma, Elasticsearch vector fields, or provider-native vector stores.

## When To Use

- Avoid recomputing embeddings for repeated text.
- Retrieve nearest chunks before building an LLM prompt.
- Keep embedding cache entries separated by model.
- Add deterministic retrieval tests before adopting a vector database.

## When Not To Use

- Do not use memory storage for large corpora or production retrieval.
- Do not compare vectors from different embedding models or dimensions.
- Do not store sensitive raw text unless the product has a retention policy.

## Recommended Architecture

- core.ts: pure text normalization, cache keys, embedding records, expiry checks, cosine similarity, and topK search.
- memory-index.ts: deterministic stateful index for tests and local demos.
- adapters/pgvector.ts: SQL-backed vector store with metadata filters.
- adapters/redis-vector.ts: cache-first vector adapter for low-latency lookup.
- retriever.ts: chunk selection, score thresholds, and context-window budgeting.

## Public API Sketch

\`\`\`ts
const index = new MemoryEmbeddingIndex();
index.upsert({
  id: "chunk-1",
  model: "text-embedding-3-small",
  text: "Carbon Code supports middleware modules.",
  vector: [1, 0, 0],
  metadata: { source: "docs" },
  ttlMs: 86_400_000,
});

const cached = index.getByText("text-embedding-3-small", "carbon code supports middleware modules");
const results = index.search({
  model: "text-embedding-3-small",
  queryVector: [0.9, 0.1, 0],
  topK: 3,
  minScore: 0.7,
});
\`\`\`

## Integration Rules

1. Normalize text before cache-key generation.
2. Include embedding model in cache keys and retrieval filters.
3. Reject vectors with mismatched dimensions.
4. Apply TTL or invalidation when source documents change.
5. Use score thresholds and context budgets before prompt assembly.
6. Store metadata needed for citation, permission, and freshness checks.

## Failure Modes

- Wrong results when embeddings from different models are mixed.
- Stale retrieval after source content changes without invalidation.
- High memory use from unbounded in-process vector storage.
- Prompt leakage when metadata permissions are ignored.
- Poor ranking when cosine similarity is applied to malformed vectors.

## Security Notes

- Treat retrieved chunks as data that may require authorization filtering.
- Avoid storing secrets or sensitive raw text in embedding caches.
- Keep source ids and permission metadata with each vector record.

## Verification Checklist

- Stateless tests cover normalization, cache key stability, record creation, expiry, cosine similarity, dimension mismatch, and topK ranking.
- Stateful tests cover upsert, getByText cache hit, model isolation, TTL pruning, search threshold, and vector cloning.
- Adapter tests should verify metadata filtering and persistence across restarts.
- Retriever tests should verify context budget limits and citation metadata.

## Source References

- pgvector retrieval patterns: model-aware vector columns and cosine distance.
- Qdrant/Milvus vector database concepts: topK search, payload filters, and TTL-like cleanup.
- LangChain retriever pattern: embedding cache, vector store, and context assembly.
`;

export const EMBEDDING_CACHE_RETRIEVAL_MODULE: MwhModule = {
  id: "embedding-cache-retrieval",
  title: "Embedding Cache Retrieval Middleware",
  summary:
    "Reusable AI retrieval reference with embedding cache keys, cosine ranking, TTL filtering, and stateful memory-index tests.",
  version: "0.1.0",
  tags: ["ai-infra", "embedding", "vector-search", "retrieval", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};

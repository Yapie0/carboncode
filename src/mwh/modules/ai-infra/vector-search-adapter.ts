import type { MwhModule } from "../../types.js";

const CONTENT = `# MWH Module: Vector Search Adapter

## Purpose

Use this module as a reusable reference for adding provider-neutral vector search to an application: normalize vector documents, score queries, filter by namespace/metadata, and expose an adapter contract that can later be backed by pgvector, Qdrant, Milvus, Chroma, Redis Vector, Elasticsearch, or a model-provider vector store.

This module is separate from embedding-cache-retrieval. Embedding cache decides whether an embedding already exists; vector-search-adapter decides how stored vectors are queried and filtered.

## When To Use

- Need semantic search, RAG document lookup, memory retrieval, or recommendation candidates.
- Need a stable adapter contract before choosing a vector database.
- Need deterministic unit tests for topK ranking and metadata filters.
- Need namespace isolation for tenants, projects, indexes, or embedding models.

## When Not To Use

- Do not use the memory index for large corpora or production persistence.
- Do not mix embeddings from different models or dimensions in the same namespace without explicit filtering.
- Do not return retrieved content without applying authorization metadata filters.
- Do not treat approximate vector search as deterministic unless the adapter documents tie-breaking and recall behavior.

## Implementation Variants

- Memory index for tests and local prototypes.
- pgvector adapter using SQL metadata filters.
- Qdrant/Milvus/Chroma adapter using payload filters.
- Redis Vector adapter for low-latency cache-like search.
- Elasticsearch/OpenSearch vector field adapter for hybrid keyword + vector retrieval.

## Recommended Architecture

- core.ts: pure vector document creation, metric scoring, metadata filtering, topK sorting, and clone helpers.
- memory-index.ts: stateful upsert, get, delete, list, and search behavior for tests.
- adapters/pgvector.ts: map VectorSearchFilter to SQL predicates and vector operators.
- adapters/qdrant.ts: map namespaces and metadata to collection/payload filters.
- retriever.ts: combine embedding-cache-retrieval, vector-search-adapter, permission filters, and context budgeting.

## Public API Sketch

\`\`\`ts
const index = new MemoryVectorSearchIndex();
index.upsert({
  id: "doc-1",
  namespace: "project-a",
  vector: [1, 0, 0],
  metadata: { tenantId: "t1", visibility: "public" },
  content: "Carbon Code has reusable middleware modules.",
});

const results = index.search({
  queryVector: [0.9, 0.1, 0],
  topK: 5,
  filter: { namespace: "project-a", metadata: { tenantId: "t1" } },
});
\`\`\`

## Integration Rules

1. Keep namespace boundaries explicit.
2. Keep vector dimensions and embedding model metadata together.
3. Apply permission filters before returning content.
4. Prefer stable tie-breaking in tests.
5. Keep provider-specific approximate-search behavior behind adapters.
6. Store enough metadata to refresh or delete stale vectors.

## Failure Modes

- Dimension mismatch between query and stored vectors.
- Metadata filters omitted, causing cross-tenant retrieval.
- Approximate search recall differs from exact in-memory tests.
- Large in-process indexes increase memory use.
- Stale vectors remain after source documents are deleted.

## Security Notes

- Treat metadata filters as part of authorization, not just ranking.
- Avoid storing secrets in vector content or metadata.
- Log search requests without raw sensitive text where possible.
- Delete vectors when source documents are revoked.

## Verification Checklist

- Stateless tests cover document validation, clone safety, cosine/dot/euclidean scores, metadata filters, topK sorting, minScore, and dimension mismatch rejection.
- Stateful tests cover upsert, get, delete, list by namespace, search filters, update replacement, and clone-safe returns.
- Adapter tests should compare exact memory results with provider result shape for a small fixture.
- Permission tests should prove unauthorized namespaces or metadata are not returned.

## Source References

- pgvector exact and approximate nearest-neighbor search patterns.
- Qdrant/Milvus payload filter and collection concepts.
- Redis Vector and Elasticsearch/OpenSearch vector field adapter patterns.
- RAG retriever patterns for metadata filters, topK ranking, and context assembly.
`;

export const VECTOR_SEARCH_ADAPTER_MODULE: MwhModule = {
  id: "vector-search-adapter",
  title: "Vector Search Adapter",
  summary:
    "Reusable AI infrastructure reference for provider-neutral vector documents, metric scoring, metadata filters, topK search, and stateful memory-index tests.",
  version: "0.1.0",
  tags: ["ai-infra", "vector-search", "retrieval", "rag", "adapter", "middleware"],
  source: { kind: "builtin", label: "Carbon Code built-in" },
  content: CONTENT,
};
